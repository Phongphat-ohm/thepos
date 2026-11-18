import { Prisma, type PrismaClient } from "@prisma/client";
import type { StockCountInput, StockDecisionInput } from "@thepos/contracts";
import { ApiError } from "../errors";
import { digest } from "../security";
import { audit } from "./auth";
import { lockProducts, type StoreActor } from "./catalog";
import { pageMeta, resolveOrder } from "./pagination";

const details = {
  submittedBy: { select: { name: true } }, reviewedBy: { select: { name: true } },
  adjustments: { orderBy: { lotId: "asc" }, include: { lot: { include: { product: true } } } },
} satisfies Prisma.StockCountInclude;

function dto(count: Prisma.StockCountGetPayload<{ include: typeof details }>) {
  return {
    id: count.id, reason: count.reason, status: count.status,
    submittedBy: count.submittedBy.name, reviewedBy: count.reviewedBy?.name ?? null,
    createdAt: count.createdAt.toISOString(),
    adjustments: count.adjustments.map(({ lot, expectedQuantity, countedQuantity }) => ({
      lotId: lot.id, lotNumber: lot.lotNumber, sku: lot.product.sku, productName: lot.product.name,
      baseUnit: lot.product.baseUnit, expected: expectedQuantity.toFixed(3), counted: countedQuantity.toFixed(3),
      variance: countedQuantity.minus(expectedQuantity).toFixed(3),
    })),
  };
}

async function lockLots(tx: Prisma.TransactionClient, storeId: string, ids: string[]) {
  const scope = { id: { in: ids }, product: { storeId } };
  const links = await tx.stockLot.findMany({ where: scope, select: { productId: true } });
  if (links.length !== ids.length) throw new ApiError(400, "INVALID_REFERENCE");
  await lockProducts(tx, storeId, [...new Set(links.map(({ productId }) => productId))]);
  const values = Prisma.join(ids.map((id) => Prisma.sql`CAST(${id} AS uuid)`));
  await tx.$queryRaw`SELECT id FROM stock_lots WHERE id IN (${values}) ORDER BY id FOR UPDATE`;
  return new Map((await tx.stockLot.findMany({ where: scope })).map((lot) => [lot.id, lot]));
}

export function createStockCounts(db: PrismaClient) {
  return {
    async list(storeId: string, query: { q?: string; status?: string; limit: number; after?: string; page?: number; sortBy?: string; sortDir?: "asc" | "desc" }) {
      const { q, status, limit, after, page: pageNum, sortBy, sortDir } = query;
      const where: Prisma.StockCountWhereInput = {
        storeId,
        ...(status && status !== "all" && { status }),
        ...(q && { OR: [{ reason: { contains: q, mode: "insensitive" } }, { submittedBy: { name: { contains: q, mode: "insensitive" } } }] }),
      };
      const orderBy = resolveOrder<Prisma.StockCountOrderByWithRelationInput>(
        {
          createdAt: (dir) => [{ createdAt: dir }, { id: dir }],
          status: (dir) => [{ status: dir }, { createdAt: "desc" }],
        },
        [{ createdAt: "desc" }, { id: "desc" }],
        sortBy,
        sortDir,
      );
      if (pageNum) {
        const [rows, total] = await Promise.all([
          db.stockCount.findMany({ where, include: details, orderBy, skip: (pageNum - 1) * limit, take: limit }),
          db.stockCount.count({ where }),
        ]);
        return { items: rows.map(dto), ...pageMeta(total, pageNum, limit) };
      }
      const rows = await db.stockCount.findMany({
        where, include: details, orderBy,
        take: limit + 1, ...(after && { cursor: { id: after }, skip: 1 }),
      });
      return { items: rows.slice(0, limit).map(dto), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
    },
    async submit(actor: StoreActor, key: string, input: StockCountInput) {
      const payloadHash = digest(JSON.stringify(input));
      const where = { storeId_idempotencyKey: { storeId: actor.storeId, idempotencyKey: key } };
      function replay(count: Prisma.StockCountGetPayload<{ include: typeof details }>) {
        if (count.payloadHash !== payloadHash || count.submittedById !== actor.userId) {
          throw new ApiError(409, "IDEMPOTENCY_CONFLICT");
        }
        return dto(count);
      }
      try {
        return await db.$transaction(async (tx) => {
          const previous = await tx.stockCount.findUnique({ where, include: details });
          if (previous) return replay(previous);
          const lots = await lockLots(tx, actor.storeId, input.lines.map(({ lotId }) => lotId));
          const raced = await tx.stockCount.findUnique({ where, include: details });
          if (raced) return replay(raced);
          const create = input.lines.map(({ lotId, expected, counted }) => {
            const lot = lots.get(lotId);
            if (!lot?.remainingQuantity.eq(expected)) throw new ApiError(409, "STOCK_COUNT_STALE");
            return { lotId, expectedQuantity: lot.remainingQuantity, countedQuantity: counted };
          });
          const count = await tx.stockCount.create({
            data: {
              ...where.storeId_idempotencyKey, payloadHash, submittedById: actor.userId,
              reason: input.reason, adjustments: { create },
            },
            include: details,
          });
          await audit(tx, actor, "STOCK_COUNT_SUBMITTED", count.id);
          return dto(count);
        }, { timeout: 15_000 });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const previous = await db.stockCount.findUnique({ where, include: details });
          if (previous) return replay(previous);
        }
        throw error;
      }
    },
    async review(actor: StoreActor, id: string, { decision }: StockDecisionInput) {
      return db.$transaction(async (tx) => {
        const selected = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM stock_counts WHERE store_id = CAST(${actor.storeId} AS uuid)
          AND id = CAST(${id} AS uuid) FOR UPDATE
        `;
        if (!selected.length) throw new ApiError(404, "NOT_FOUND");
        const count = await tx.stockCount.findUniqueOrThrow({ where: { id }, include: details });
        if (count.status === decision) return dto(count);
        if (count.status !== "PENDING") throw new ApiError(409, "STOCK_COUNT_CONFLICT");
        if (count.submittedById === actor.userId) throw new ApiError(403, "FORBIDDEN");
        if (decision === "APPROVED") {
          const lots = await lockLots(tx, actor.storeId, count.adjustments.map(({ lotId }) => lotId));
          const changed: { adjustmentId: string; lotId: string; countedQuantity: Prisma.Decimal; variance: Prisma.Decimal }[] = [];
          for (const adjustment of count.adjustments) {
            const { id: adjustmentId, lotId, expectedQuantity, countedQuantity } = adjustment;
            if (!lots.get(lotId)?.remainingQuantity.eq(expectedQuantity)) throw new ApiError(409, "STOCK_COUNT_STALE");
            const variance = countedQuantity.minus(expectedQuantity);
            if (!variance.isZero()) changed.push({ adjustmentId, lotId, countedQuantity, variance });
          }
          if (changed.length) {
            const updates = Prisma.join(
              changed.map(({ lotId, countedQuantity }) =>
                Prisma.sql`(CAST(${lotId} AS uuid), CAST(${countedQuantity.toFixed(3)} AS numeric(12,3)))`,
              ),
            );
            await tx.$executeRaw`
              UPDATE stock_lots AS l
              SET remaining_quantity = v.qty
              FROM (VALUES ${updates}) AS v(id, qty)
              WHERE l.id = v.id
            `;
            await tx.stockMovement.createMany({
              data: changed.map(({ adjustmentId, lotId, variance }) => ({
                lotId,
                kind: "ADJUSTMENT",
                quantity: variance,
                adjustmentId,
              })),
            });
          }
        }
        const reviewed = await tx.stockCount.update({
          where: { id }, include: details,
          data: { status: decision, reviewedById: actor.userId, reviewedAt: new Date() },
        });
        await audit(tx, actor, "STOCK_COUNT_" + decision, id);
        return dto(reviewed);
      }, { timeout: 15_000 });
    },
  };
}
