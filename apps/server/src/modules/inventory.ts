import { Prisma, type PrismaClient, type StockLot } from "@prisma/client";
import type { ReceiptInput } from "@thepos/contracts";
import { ApiError } from "../errors";
import { digest } from "../security";
import { audit } from "./auth";
import { lockProducts, type StoreActor } from "./catalog";
import { pageMeta, resolveOrder } from "./pagination";

const maximumQuantity = new Prisma.Decimal("999999999.999");
const bangkokDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok" });

export function baseQuantity(input: string, multiplier: Prisma.Decimal) {
  const quantity = new Prisma.Decimal(input).times(multiplier);
  if (!quantity.gt(0) || quantity.gt(maximumQuantity) || quantity.decimalPlaces() > 3) {
    throw new ApiError(400, "INVALID_QUANTITY");
  }
  return quantity;
}

function lotDto(lot: StockLot) {
  return {
    id: lot.id, productId: lot.productId, supplierId: lot.supplierId, goodsReceiptId: lot.goodsReceiptId,
    lotNumber: lot.lotNumber, initialQuantity: lot.initialQuantity.toFixed(3),
    remainingQuantity: lot.remainingQuantity.toFixed(3), unitCost: lot.unitCost.toFixed(4),
    expirationDate: lot.expirationDate?.toISOString().slice(0, 10) ?? null,
    receivedAt: lot.receivedAt.toISOString(),
  };
}

export function createInventory(db: PrismaClient) {
  return {
    async receive(actor: StoreActor, key: string, input: ReceiptInput) {
      const payloadHash = digest(JSON.stringify(input));
      const where = { storeId_idempotencyKey: { storeId: actor.storeId, idempotencyKey: key } };
      const include = { lots: { orderBy: { id: "asc" as const } } };
      type Receipt = Prisma.GoodsReceiptGetPayload<{ include: typeof include }>;
      function result(receipt: Receipt, replayed: boolean) {
        if (receipt.payloadHash !== payloadHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT");
        return { replayed, id: receipt.id, receivedAt: receipt.receivedAt.toISOString(), lots: receipt.lots.map(lotDto) };
      }

      try {
        return await db.$transaction(async (tx) => {
          const previous = await tx.goodsReceipt.findUnique({ where, include });
          if (previous) return result(previous, true);
          // Hold a shared lock so supplier deactivation and a new receipt cannot cross.
          const [supplier] = await tx.$queryRaw<{ id: string; isActive: boolean }[]>`
            SELECT id, is_active AS "isActive" FROM suppliers
            WHERE id = ${input.supplierId}::uuid AND store_id = ${actor.storeId}::uuid FOR SHARE
          `;
          if (!supplier) throw new ApiError(400, "INVALID_REFERENCE");
          if (!supplier.isActive) {
            const committed = await tx.goodsReceipt.findUnique({ where, include });
            if (committed) return result(committed, true);
            throw new ApiError(409, "SUPPLIER_INACTIVE");
          }

          const ids = [...new Set(input.lines.map(({ productId }) => productId))];
          await lockProducts(tx, actor.storeId, ids);
          const products = new Map((await tx.product.findMany({
            where: { id: { in: ids }, storeId: actor.storeId }, include: { units: true },
          })).map((product) => [product.id, product]));
          const lots = input.lines.map((line) => {
            const product = products.get(line.productId);
            if (!product?.isActive || !product.trackStock) throw new ApiError(400, "INVALID_REFERENCE");
            const multiplier = line.unit === product.baseUnit
              ? new Prisma.Decimal(1)
              : product.units.find(({ name }) => name === line.unit)?.multiplier;
            if (!multiplier) throw new ApiError(400, "INVALID_REFERENCE");
            if (product.trackExpiration && !line.expirationDate) throw new ApiError(400, "EXPIRATION_REQUIRED");
            const quantity = baseQuantity(line.quantity, multiplier);
            return {
              productId: line.productId, supplierId: supplier.id, lotNumber: line.lotNumber,
              initialQuantity: quantity, remainingQuantity: quantity, unitCost: line.unitCostPerBaseUnit,
              expirationDate: product.trackExpiration && line.expirationDate ? new Date(line.expirationDate) : null,
            };
          });
          const receivedAt = new Date();
          const receipt = await tx.goodsReceipt.create({
            data: {
              storeId: actor.storeId, supplierId: supplier.id, idempotencyKey: key, payloadHash, receivedAt,
              lots: { create: lots.map((lot) => ({
                ...lot, receivedAt, movements: { create: { kind: "RECEIPT", quantity: lot.initialQuantity } },
              })) },
            },
            include,
          });
          await audit(tx, actor, "GOODS_RECEIVED", receipt.id);
          return result(receipt, false);
        }, { timeout: 15_000 });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const previous = await db.goodsReceipt.findUnique({ where, include });
          if (previous) return result(previous, true);
        }
        throw error;
      }
    },
    async lots(storeId: string, query: { productId: string; q?: string; limit: number; after?: string; page?: number; sortBy?: string; sortDir?: "asc" | "desc" }) {
      const { productId, q, limit, after, page: pageNum, sortBy, sortDir } = query;
      const where: Prisma.StockLotWhereInput = {
        productId,
        product: { storeId },
        ...(q && { OR: [{ lotNumber: { contains: q, mode: "insensitive" } }, { supplier: { name: { contains: q, mode: "insensitive" } } }] }),
      };
      const orderBy = resolveOrder<Prisma.StockLotOrderByWithRelationInput>(
        {
          lotNumber: (dir) => [{ lotNumber: dir }, { id: "asc" }],
          receivedAt: (dir) => [{ receivedAt: dir }, { id: "asc" }],
          expirationDate: (dir) => [{ expirationDate: dir }, { receivedAt: "asc" }, { id: "asc" }],
          remainingQuantity: (dir) => [{ remainingQuantity: dir }, { receivedAt: "asc" }, { id: "asc" }],
          unitCost: (dir) => [{ unitCost: dir }, { receivedAt: "asc" }, { id: "asc" }],
        },
        [{ receivedAt: "asc" }, { id: "asc" }],
        sortBy,
        sortDir,
      );
      if (pageNum) {
        const [rows, total] = await Promise.all([
          db.stockLot.findMany({ where, include: { supplier: { select: { name: true } } }, orderBy, skip: (pageNum - 1) * limit, take: limit }),
          db.stockLot.count({ where }),
        ]);
        return {
          items: rows.map((lot) => ({ ...lotDto(lot), supplierName: lot.supplier?.name ?? null })),
          ...pageMeta(total, pageNum, limit),
        };
      }
      const rows = await db.stockLot.findMany({
        where,
        include: { supplier: { select: { name: true } } },
        orderBy, take: limit + 1,
        ...(after && { cursor: { id: after }, skip: 1 }),
      });
      return {
        items: rows.slice(0, limit).map((lot) => ({ ...lotDto(lot), supplierName: lot.supplier?.name ?? null })),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    },
    async movements(storeId: string, query: { productId: string; q?: string; kind?: string; limit: number; after?: string; page?: number; sortBy?: string; sortDir?: "asc" | "desc" }) {
      const { productId, q, kind, limit, after, page: pageNum, sortBy, sortDir } = query;
      const where: Prisma.StockMovementWhereInput = {
        lot: { productId, product: { storeId }, ...(q && { lotNumber: { contains: q, mode: "insensitive" } }) },
        ...(kind && kind !== "all" && { kind }),
      };
      const orderBy = resolveOrder<Prisma.StockMovementOrderByWithRelationInput>(
        {
          createdAt: (dir) => [{ createdAt: dir }, { id: "asc" }],
          kind: (dir) => [{ kind: dir }, { createdAt: "desc" }],
          quantity: (dir) => [{ quantity: dir }, { createdAt: "desc" }],
        },
        [{ createdAt: "desc" }, { id: "asc" }],
        sortBy,
        sortDir,
      );
      if (pageNum) {
        const [rows, total] = await Promise.all([
          db.stockMovement.findMany({ where, include: { lot: { select: { lotNumber: true } } }, orderBy, skip: (pageNum - 1) * limit, take: limit }),
          db.stockMovement.count({ where }),
        ]);
        return {
          items: rows.map(({ id, lotId, lot, kind, quantity, createdAt }) =>
            ({ id, lotId, lotNumber: lot.lotNumber, kind, quantity: quantity.toFixed(3), createdAt: createdAt.toISOString() })),
          ...pageMeta(total, pageNum, limit),
        };
      }
      const rows = await db.stockMovement.findMany({
        where,
        include: { lot: { select: { lotNumber: true } } },
        orderBy, take: limit + 1,
        ...(after && { cursor: { id: after }, skip: 1 }),
      });
      return {
        items: rows.slice(0, limit).map(({ id, lotId, lot, kind, quantity, createdAt }) =>
          ({ id, lotId, lotNumber: lot.lotNumber, kind, quantity: quantity.toFixed(3), createdAt: createdAt.toISOString() })),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    },
  };
}

// Called inside the caller's transaction so deductions and the future sale commit together.
export async function deductStock(
  tx: Prisma.TransactionClient,
  storeId: string,
  productId: string,
  quantity: string,
  now = new Date(),
  saleItemId?: string,
  prelockedProduct?: { isActive: boolean; trackStock: boolean; trackExpiration: boolean },
) {
  let needed = baseQuantity(quantity, new Prisma.Decimal(1));
  let product = prelockedProduct;
  if (!product) {
    await lockProducts(tx, storeId, [productId]);
    product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { isActive: true, trackStock: true, trackExpiration: true },
    });
  }
  if (!product.isActive || !product.trackStock) throw new ApiError(400, "INVALID_REFERENCE");
  const expiration = product.trackExpiration
    ? Prisma.sql`AND expiration_date >= CAST(${bangkokDate.format(now)} AS date)`
    : Prisma.empty;
  const order = product.trackExpiration ? Prisma.sql`expiration_date ASC,` : Prisma.empty;
  const lots = await tx.$queryRaw<{ id: string; remaining_quantity: Prisma.Decimal; unit_cost: Prisma.Decimal }[]>`
    SELECT id, remaining_quantity, unit_cost FROM stock_lots
    WHERE product_id = CAST(${productId} AS uuid) AND remaining_quantity > 0 ${expiration}
    ORDER BY ${order} received_at ASC, id ASC FOR UPDATE
  `;
  const allocations: { lotId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal }[] = [];
  for (const lot of lots) {
    const taken = Prisma.Decimal.min(needed, lot.remaining_quantity);
    allocations.push({ lotId: lot.id, quantity: taken, unitCost: lot.unit_cost });
    needed = needed.minus(taken);
    if (needed.eq(0)) break;
  }
  if (needed.gt(0)) throw new ApiError(409, "INSUFFICIENT_STOCK");

  if (allocations.length) {
    const updates = Prisma.join(
      allocations.map((allocation) =>
        Prisma.sql`(CAST(${allocation.lotId} AS uuid), CAST(${allocation.quantity.toFixed(3)} AS numeric(12,3)))`,
      ),
    );
    await tx.$executeRaw`
      UPDATE stock_lots AS l
      SET remaining_quantity = l.remaining_quantity - v.qty
      FROM (VALUES ${updates}) AS v(id, qty)
      WHERE l.id = v.id
    `;
    await tx.stockMovement.createMany({
      data: allocations.map((allocation) => ({
        lotId: allocation.lotId,
        kind: "SALE",
        quantity: allocation.quantity.negated(),
        saleItemId,
      })),
    });
  }
  return allocations;
}
