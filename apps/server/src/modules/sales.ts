import { Prisma, type PrismaClient } from "@prisma/client";
import { discountApprovalPercent, type CheckoutInput, type POSLookupInput } from "@thepos/contracts";
import { ApiError } from "../errors";
import { digest } from "../security";
import { audit } from "./auth";
import { lockProducts, type StoreActor } from "./catalog";
import { baseQuantity, deductStock } from "./inventory";
import { consumeHeld, productForRegister, productSelection } from "./pos-drafts";
import { lockSaleRequest, managerApproval } from "./sales-approval";
import { lockFinance } from "./finance-lock";
import { pageMeta, resolveOrder } from "./pagination";
import { shiftForPosting } from "./shifts";

const Decimal = Prisma.Decimal.clone({ precision: 40 });
const maxMoney = new Decimal("9999999999.99");
const bangkokDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok" });
const details = {
  store: { select: { name: true, receiptHeader: true, receiptFooter: true, receiptLogo: true } },
  cashier: { select: { name: true } },
  items: { orderBy: { lineNumber: "asc" }, include: { returns: { select: { quantity: true } } } },
  payments: { orderBy: { lineNumber: "asc" } },
  returns: { select: { netTotal: true } },
} satisfies Prisma.SaleInclude;

function receipt(sale: Prisma.SaleGetPayload<{ include: typeof details }>) {
  return {
    id: sale.id, invoiceNumber: sale.invoiceNumber, completedAt: sale.completedAt.toISOString(),
    subtotal: sale.subtotal.toFixed(2), netTotal: sale.netTotal.toFixed(2),
    storeName: sale.storeName ?? sale.store.name, cashierName: sale.cashierName ?? sale.cashier.name,
    receiptHeader: sale.store.receiptHeader, receiptFooter: sale.store.receiptFooter, receiptLogo: sale.store.receiptLogo,
    memberName: sale.memberName, discountTotal: sale.discountTotal.toFixed(2), billDiscount: sale.billDiscount.toFixed(2),
    items: sale.items.map((item) => ({
      id: item.id, productId: item.productId, sku: item.sku, name: item.name, unit: item.unit,
      quantity: item.quantity.toFixed(3), baseQuantity: item.baseQuantity.toFixed(3),
      baseUnit: item.baseUnit, basePrice: item.basePrice.toFixed(2), lineTotal: item.lineTotal.toFixed(2),
      lineDiscount: item.lineDiscount.toFixed(2), billDiscountShare: item.billDiscountShare.toFixed(2),
    })),
    payments: sale.payments.map(({ method, amount, tendered, change, reference }) => ({
      method, amount: amount.toFixed(2), tendered: tendered?.toFixed(2) ?? null,
      change: change?.toFixed(2) ?? null, reference,
    })),
  };
}

export const roundMoney = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const sumMoney = (values: Prisma.Decimal[]) => values.reduce((sum, value) => sum.plus(value), new Decimal(0));

function paymentRows(inputs: CheckoutInput["payments"], total: Prisma.Decimal) {
  const payments = inputs.map((payment, index) => {
    const amount = new Decimal(payment.amount);
    if (amount.lte(0)) throw new ApiError(400, "PAYMENT_MISMATCH");
    const base = { lineNumber: index + 1, method: payment.method, amount };
    if (payment.method !== "CASH") return { ...base, reference: payment.reference };
    const tendered = new Decimal(payment.tendered);
    if (tendered.lt(amount)) throw new ApiError(400, "PAYMENT_MISMATCH");
    return { ...base, tendered, change: tendered.minus(amount) };
  });
  const paid = payments.reduce((sum, payment) => sum.plus(payment.amount), new Decimal(0));
  if (!paid.eq(total)) throw new ApiError(400, "PAYMENT_MISMATCH");
  return payments;
}

export function createSales(db: PrismaClient, now: () => number) {
  return {
    async history(storeId: string, { q, after, limit, page: pageNum, sortBy, sortDir }: { q: string; after?: string; limit: number; page?: number; sortBy?: string; sortDir?: "asc" | "desc" }) {
      const where: Prisma.SaleWhereInput = { storeId, ...(q && { invoiceNumber: { contains: q.toUpperCase() } }) };
      const orderBy = resolveOrder<Prisma.SaleOrderByWithRelationInput>(
        {
          invoiceNumber: (dir) => [{ invoiceNumber: dir }, { id: "asc" }],
          completedAt: (dir) => [{ completedAt: dir }, { id: dir }],
          netTotal: (dir) => [{ netTotal: dir }, { completedAt: "desc" }, { id: "desc" }],
        },
        [{ completedAt: "desc" }, { id: "desc" }],
        sortBy,
        sortDir,
      );
      const select = { id: true, invoiceNumber: true, completedAt: true, netTotal: true, returns: { select: { netTotal: true } } };
      const mapRow = ({ id, invoiceNumber, completedAt, netTotal, returns }: { id: string; invoiceNumber: string; completedAt: Date; netTotal: Prisma.Decimal; returns: { netTotal: Prisma.Decimal }[] }) => ({
        id, invoiceNumber, completedAt: completedAt.toISOString(), netTotal: netTotal.toFixed(2),
        returnedTotal: sumMoney(returns.map((row) => row.netTotal)).toFixed(2),
      });
      if (pageNum) {
        const [rows, total] = await Promise.all([
          db.sale.findMany({ where, select, orderBy, skip: (pageNum - 1) * limit, take: limit }),
          db.sale.count({ where }),
        ]);
        return { items: rows.map(mapRow), ...pageMeta(total, pageNum, limit) };
      }
      const rows = await db.sale.findMany({
        where, select, orderBy, take: limit + 1,
        ...(after && { cursor: { id: after }, skip: 1 }),
      });
      return {
        items: rows.slice(0, limit).map(mapRow),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    },
    async detail(storeId: string, id: string) {
      const sale = await db.sale.findFirst({ where: { id, storeId }, include: details });
      if (!sale) throw new ApiError(404, "NOT_FOUND");
      const result = receipt(sale);
      return {
        ...result, returnedTotal: sumMoney(sale.returns.map((row) => row.netTotal)).toFixed(2),
        items: result.items.map((item, index) => ({
          ...item, returnable: sale.items[index].quantity.minus(sumMoney(
            sale.items[index].returns.map(({ quantity }) => quantity),
          )).toFixed(3),
        })),
      };
    },
    async lookup(storeId: string, { q, mode, limit, categoryId }: POSLookupInput) {
      if (mode === "browse") {
        const rows = await db.product.findMany({
          where: { storeId, isActive: true, categoryId },
          select: { ...productSelection, barcodes: { select: { code: true } } },
          orderBy: { sku: "asc" }, take: limit,
        });
        return { items: rows.map(({ barcodes, ...product }) => ({ ...productForRegister(product), barcodes: barcodes.map(({ code }) => code) })) };
      }
      const exact = { barcodes: { some: { code: q } } };
      const items = await db.product.findMany({
        where: {
          storeId, isActive: true,
          ...(categoryId && { categoryId }),
          ...(mode === "barcode" ? exact : { OR: [
            exact, { sku: { contains: q.toUpperCase() } }, { name: { contains: q, mode: "insensitive" } },
          ] }),
        },
        select: productSelection,
        orderBy: { sku: "asc" }, take: limit,
      });
      return { items: items.map(productForRegister) };
    },
    async checkout(actor: StoreActor, key: string, input: CheckoutInput) {
      const { approval, ...payload } = input;
      const payloadHash = digest(JSON.stringify(payload));
      const result = await db.$transaction(async (tx) => {
        const storeKey = { storeId: actor.storeId, idempotencyKey: key };
        // Acquire the request lock before stock locks so concurrent retries can replay a committed sale.
        await lockSaleRequest(tx, "checkout", actor, key);
        const previous = await tx.saleRequest.findUnique({
          where: { storeId_idempotencyKey: storeKey },
          include: { sale: { include: details } },
        });
        if (previous) {
          if (previous.sale.cashierId !== actor.userId || previous.payloadHash !== payloadHash) {
            throw new ApiError(409, "IDEMPOTENCY_CONFLICT");
          }
          return { sale: receipt(previous.sale), replayed: true };
        }

        const productsIds = [...new Set(input.lines.map(({ productId }) => productId.toLowerCase()))];

        function priceAndValidateLines(
          productsMap: Map<string, Prisma.ProductGetPayload<{ include: { units: true; category: { select: { name: true } } } }>>,
          memberRecord: { id: string; name: string } | null,
        ) {
          const lines = input.lines.map((entry, index) => {
            const product = productsMap.get(entry.productId.toLowerCase());
            if (!product?.isActive) throw new ApiError(400, "INVALID_REFERENCE");
            const price = memberRecord ? product.memberPrice : product.regularPrice;
            if (!price.eq(entry.expectedBasePrice)) throw new ApiError(409, "PRICE_CHANGED");
            const multiplier = entry.unit === product.baseUnit
              ? new Decimal(1)
              : product.units.find(({ name }) => name === entry.unit)?.multiplier;
            if (!multiplier) throw new ApiError(400, "INVALID_REFERENCE");
            const quantity = baseQuantity(entry.quantity, multiplier);
            const gross = roundMoney(new Decimal(quantity).times(price));
            const lineDiscount = new Decimal(entry.discount ?? "0");
            if (lineDiscount.gt(gross)) throw new ApiError(400, "INVALID_DISCOUNT");
            return {
              product, gross,
              data: {
                lineNumber: index + 1, productId: product.id, sku: product.sku, name: product.name,
                categoryName: product.category.name,
                unit: entry.unit, baseUnit: product.baseUnit, quantity: entry.quantity, baseQuantity: quantity,
                basePrice: price, lineDiscount,
                lineTotal: gross.minus(lineDiscount),
                untrackedUnitCost: product.trackStock ? null : product.costPrice,
              },
            };
          });

          const subtotal = sumMoney(lines.map(({ gross }) => gross));
          if (subtotal.gt(maxMoney)) throw new ApiError(400, "INVALID_INPUT");
          const beforeBillDiscount = sumMoney(lines.map(({ data }) => data.lineTotal));
          const billDiscount = new Decimal(input.billDiscount ?? "0");
          if (billDiscount.gt(beforeBillDiscount)) throw new ApiError(400, "INVALID_DISCOUNT");
          const netTotal = beforeBillDiscount.minus(billDiscount);
          const discountTotal = subtotal.minus(netTotal);
          const threshold = new Decimal(discountApprovalPercent);
          const overThreshold = (discount: Prisma.Decimal, base: Prisma.Decimal) => discount.times(100).gt(base.times(threshold));
          const needsApproval = overThreshold(discountTotal, subtotal)
            || lines.some(({ data, gross }) => overThreshold(data.lineDiscount, gross));
          const payments = paymentRows(input.payments, netTotal);
          return { lines, subtotal, beforeBillDiscount, billDiscount, netTotal, discountTotal, needsApproval, payments };
        }

        // Validate prices/totals and run Argon2id manager PIN verification BEFORE locking products or cash drawer.
        const initialProducts = new Map((await tx.product.findMany({
          where: { storeId: actor.storeId, id: { in: productsIds } }, include: { units: true, category: { select: { name: true } } },
        })).map((product) => [product.id, product]));
        if (initialProducts.size !== productsIds.length) throw new ApiError(400, "INVALID_REFERENCE");
        const initialMember = input.memberId
          ? await tx.member.findFirst({ where: { id: input.memberId, storeId: actor.storeId, isActive: true }, select: { id: true, name: true } })
          : null;
        if (input.memberId && !initialMember) throw new ApiError(400, "INVALID_REFERENCE");
        const precheck = priceAndValidateLines(initialProducts, initialMember);
        const manager = precheck.needsApproval ? await managerApproval(tx, actor, approval, now()) : undefined;
        if (manager instanceof ApiError) return manager;

        if (input.memberId) await lockFinance(tx, actor.storeId, "posting");
        const shift = input.payments.some(({ method }) => method === "CASH") ? await shiftForPosting(tx, actor, true) : null;
        await lockProducts(tx, actor.storeId, productsIds);
        const products = new Map((await tx.product.findMany({
          where: { storeId: actor.storeId, id: { in: productsIds } }, include: { units: true, category: { select: { name: true } } },
        })).map((product) => [product.id, product]));
        if (input.memberId) await tx.$queryRaw`SELECT id FROM members
          WHERE id = ${input.memberId}::uuid AND store_id = ${actor.storeId}::uuid FOR SHARE`;
        const member = input.memberId
          ? await tx.member.findFirst({ where: { id: input.memberId, storeId: actor.storeId, isActive: true }, select: { id: true, name: true } })
          : null;
        if (input.memberId && !member) throw new ApiError(400, "INVALID_REFERENCE");

        const { lines, subtotal, beforeBillDiscount, billDiscount, netTotal, discountTotal, payments } = priceAndValidateLines(products, member);
        if (input.hold) await consumeHeld(tx, actor, input.hold);
        let cumulative = new Decimal(0);
        let allocated = new Decimal(0);
        const items = lines.map(({ data }) => {
          cumulative = cumulative.plus(data.lineTotal);
          const throughLine = beforeBillDiscount.isZero()
            ? new Decimal(0) : roundMoney(billDiscount.times(cumulative).div(beforeBillDiscount));
          const billDiscountShare = throughLine.minus(allocated);
          allocated = throughLine;
          return { ...data, billDiscountShare };
        });
        const completedAt = new Date(now());
        const [store, cashier] = await Promise.all([
          tx.store.findUniqueOrThrow({ where: { id: actor.storeId }, select: { name: true } }),
          tx.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true } }),
        ]);
        const [{ nextval }] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('sale_invoice_sequence')`;
        const invoiceNumber = "INV-" + bangkokDate.format(completedAt).replaceAll("-", "") + "-" + nextval.toString().padStart(4, "0");
        const sale = await tx.sale.create({
          data: {
            storeId: actor.storeId, cashierId: actor.userId, terminalId: actor.deviceId,
            invoiceNumber, completedAt, subtotal, netTotal, discountTotal, billDiscount,
            storeName: store.name, cashierName: cashier.name, memberId: member?.id, memberName: member?.name,
            items: { create: items },
            payments: { create: payments },
            request: { create: { ...storeKey, payloadHash } },
            ...(manager && { approval: { create: { managerId: manager } } }),
            ...(member && { purchaseEntry: { create: {
              memberId: member.id, transactionType: "SALE", grossAmount: subtotal, netEligibleAmount: netTotal, recordedAt: completedAt,
            } } }),
          },
          include: details,
        });
        const cash = sumMoney(payments.filter(({ method }) => method === "CASH").map(({ amount }) => amount));
        if (shift && cash.gt(0)) await tx.cashMovement.create({ data: {
          shiftId: shift.id, saleId: sale.id, kind: "SALE", amount: cash, actorId: actor.userId, recordedAt: completedAt,
        } });
        const allAllocations: { saleItemId: string; lotId: string; quantityAllocated: Prisma.Decimal; unitCostSnapshot: Prisma.Decimal; position: number }[] = [];
        for (const item of sale.items) {
          const lineProduct = lines[item.lineNumber - 1].product;
          if (!lineProduct.trackStock) continue;
          const allocations = await deductStock(
            tx, actor.storeId, item.productId, item.baseQuantity.toFixed(3), completedAt, item.id, lineProduct,
          );
          allocations.forEach(({ lotId, quantity, unitCost }, position) => {
            allAllocations.push({ saleItemId: item.id, lotId, quantityAllocated: quantity, unitCostSnapshot: unitCost, position });
          });
        }
        if (allAllocations.length) {
          await tx.saleItemLotAllocation.createMany({ data: allAllocations });
        }
        await audit(tx, actor, "SALE_COMPLETED", sale.id);
        return { sale: receipt(sale), replayed: false };
      }, { timeout: 15_000 });
      if (result instanceof ApiError) throw result;
      return result;
    },
  };
}
