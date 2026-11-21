import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ReturnInput, ReturnQuoteInput } from "@thepos/contracts";
import { lockSaleRequest, managerApproval } from "../../core/approval";
import { audit, type StoreActor } from "../../core/audit";
import { ApiError } from "../../core/errors";
import { lockFinance } from "../../core/finance-lock";
import { digest } from "../../core/security";
import { lockProducts } from "../catalog/service";
import { shiftForPosting } from "../shifts/service";
import { roundMoney } from "./sales.service";

const Decimal = Prisma.Decimal.clone({ precision: 40 });
const sum = (values: Prisma.Decimal[]) => values.reduce((total, value) => total.plus(value), new Decimal(0));
const returnDetails = {
  sale: { select: { invoiceNumber: true } },
  items: { orderBy: { saleItemId: "asc" }, include: { saleItem: { select: { name: true, unit: true } } } },
  refunds: { orderBy: { salePayment: { lineNumber: "asc" } }, include: { salePayment: true } },
} satisfies Prisma.SaleReturnInclude;

function completed(row: Prisma.SaleReturnGetPayload<{ include: typeof returnDetails }>) {
  return {
    id: row.id, invoiceNumber: row.sale.invoiceNumber, netTotal: row.netTotal.toFixed(2),
    reason: row.reason, createdAt: row.createdAt.toISOString(),
    items: row.items.map(({ saleItem, quantity, disposition, refund }) =>
      ({ ...saleItem, quantity: quantity.toFixed(3), disposition, refund: refund.toFixed(2) })),
    refunds: row.refunds.map(({ salePayment, amount }) => ({
      method: salePayment.method, reference: salePayment.reference, amount: amount.toFixed(2),
    })),
  };
}

async function plan(tx: Prisma.TransactionClient, storeId: string, saleId: string, input: ReturnQuoteInput) {
  const sale = await tx.sale.findFirst({
    where: { id: saleId, storeId },
    include: {
      items: { include: {
        returns: { select: { quantity: true, refund: true, grossRefund: true } },
        allocations: {
          orderBy: [{ position: "asc" }, { id: "asc" }],
          include: { returns: { select: { quantity: true } } },
        },
      } },
      payments: { orderBy: { lineNumber: "asc" }, include: { refunds: { select: { amount: true } } } },
    },
  });
  if (!sale) throw new ApiError(404, "NOT_FOUND");
  const items = input.lines.map(({ saleItemId, quantity, disposition }) => {
    const item = sale.items.find(({ id }) => id === saleItemId.toLowerCase());
    if (!item) throw new ApiError(400, "INVALID_REFERENCE");
    const requested = new Decimal(quantity);
    const previouslyReturned = sum(item.returns.map((row) => row.quantity));
    const through = previouslyReturned.plus(requested);
    if (through.gt(item.quantity)) throw new ApiError(409, "RETURN_LIMIT");
    const baseQuantity = requested.times(item.baseQuantity).div(item.quantity);
    if (baseQuantity.decimalPlaces() > 3) throw new ApiError(400, "INVALID_QUANTITY");
    const net = item.lineTotal.minus(item.billDiscountShare);
    const gross = item.lineTotal.plus(item.lineDiscount);
    const cumulative = (amount: Prisma.Decimal) => roundMoney(new Decimal(amount).times(through).div(item.quantity));
    const refund = cumulative(net).minus(sum(item.returns.map((row) => row.refund)));
    const grossRefund = cumulative(gross).minus(sum(item.returns.map((row) => row.grossRefund)));
    let left = baseQuantity;
    const allocations: { saleAllocationId: string; lotId: string; quantity: Prisma.Decimal }[] = [];
    for (const original of item.allocations) {
      if (left.isZero()) break;
      const available = original.quantityAllocated.minus(sum(original.returns.map((row) => row.quantity)));
      const allocated = Decimal.min(left, available);
      if (allocated.gt(0)) {
        allocations.push({ saleAllocationId: original.id, lotId: original.lotId, quantity: allocated });
        left = left.minus(allocated);
      }
    }
    if (item.allocations.length && !left.isZero()) throw new ApiError(409, "RETURN_LIMIT");
    return { saleItemId: item.id, productId: item.productId, quantity: requested, baseQuantity, refund, grossRefund, disposition, allocations };
  });
  const total = sum(items.map(({ refund }) => refund));
  let unallocated = total;
  const refunds: { salePaymentId: string; method: string; reference: string | null; amount: Prisma.Decimal }[] = [];
  for (const payment of sale.payments) {
    if (unallocated.isZero()) break;
    const available = payment.amount.minus(sum(payment.refunds.map(({ amount }) => amount)));
    const amount = Decimal.min(available, unallocated);
    if (amount.gt(0)) {
      refunds.push({ salePaymentId: payment.id, method: payment.method, reference: payment.reference, amount });
      unallocated = unallocated.minus(amount);
    }
  }
  if (!unallocated.isZero()) throw new ApiError(409, "RETURN_LIMIT");
  const quote = digest(JSON.stringify({ saleId, items, refunds }));
  return { sale, items, total, refunds, quote };
}

export function createReturns(db: PrismaClient, now: () => number) {
  return {
    async quote(storeId: string, saleId: string, input: ReturnQuoteInput) {
      return db.$transaction(async (tx) => {
        const { quote, total, refunds } = await plan(tx, storeId, saleId, input);
        return {
          quote, total: total.toFixed(2),
          refunds: refunds.map(({ amount, method, reference }) => ({ method, reference, amount: amount.toFixed(2) })),
        };
      }, { isolationLevel: "RepeatableRead" });
    },
    async record(actor: StoreActor, saleId: string, key: string, input: ReturnInput) {
      const { approval, ...payload } = input;
      const payloadHash = digest(JSON.stringify({ saleId, ...payload }));
      const result = await db.$transaction(async (tx) => {
        await lockSaleRequest(tx, "return", actor, key);
        const previous = await tx.saleReturn.findUnique({
          where: { storeId_idempotencyKey: { storeId: actor.storeId, idempotencyKey: key } },
          include: returnDetails,
        });
        if (previous) {
          if (previous.cashierId !== actor.userId || previous.payloadHash !== payloadHash) {
            throw new ApiError(409, "IDEMPOTENCY_CONFLICT");
          }
          return { result: completed(previous), replayed: true };
        }

        // Precheck quote and verify manager PIN with Argon2id before taking sale, drawer, and product locks.
        const initialPlan = await plan(tx, actor.storeId, saleId, input);
        if (initialPlan.quote !== input.expectedQuote) throw new ApiError(409, "RETURN_LIMIT");
        const manager = await managerApproval(tx, actor, approval, now());
        if (manager instanceof ApiError) return manager;

        await lockFinance(tx, actor.storeId, "posting");
        await tx.$queryRaw`SELECT id FROM sales WHERE id = CAST(${saleId} AS uuid)
          AND store_id = CAST(${actor.storeId} AS uuid) FOR UPDATE`;
        const { quote, sale, items, total, refunds } = await plan(tx, actor.storeId, saleId, input);
        if (quote !== input.expectedQuote) throw new ApiError(409, "RETURN_LIMIT");
        const cash = sum(refunds.filter(({ method }) => method === "CASH").map(({ amount }) => amount));
        const shift = cash.gt(0) ? await shiftForPosting(tx, actor, true) : null;
        const ids = [...new Set(items.filter(({ allocations }) => allocations.length).map(({ productId }) => productId))];
        if (ids.length) await lockProducts(tx, actor.storeId, ids);
        const createdAt = new Date(now());
        const returned = await tx.saleReturn.create({
          data: {
            storeId: actor.storeId, saleId: sale.id, cashierId: actor.userId, terminalId: actor.deviceId,
            idempotencyKey: key, payloadHash, reason: input.reason, netTotal: total, createdAt,
            approval: { create: { managerId: manager } },
            refunds: { create: refunds.map(({ salePaymentId, amount }) => ({ salePaymentId, amount })) },
            ...(sale.memberId && { purchaseEntry: { create: {
              memberId: sale.memberId, transactionType: "RETURN",
              grossAmount: sum(items.map(({ grossRefund }) => grossRefund)).negated(), netEligibleAmount: total.negated(),
              recordedAt: createdAt,
            } } }),
          },
        });
        if (shift) await tx.cashMovement.create({ data: {
          shiftId: shift.id, returnId: returned.id, kind: "REFUND", amount: cash, actorId: actor.userId, recordedAt: createdAt,
        } });

        const itemRows: Prisma.SaleReturnItemCreateManyInput[] = [];
        const allocationRows: Prisma.SaleReturnAllocationCreateManyInput[] = [];
        const movementRows: Prisma.StockMovementCreateManyInput[] = [];
        const lotIncrements = new Map<string, Prisma.Decimal>();

        for (const { allocations, productId: _productId, ...item } of items) {
          const returnItemId = randomUUID();
          itemRows.push({ ...item, id: returnItemId, saleReturnId: returned.id });
          for (const allocation of allocations) {
            const returnAllocationId = randomUUID();
            allocationRows.push({
              id: returnAllocationId,
              saleReturnItemId: returnItemId,
              saleAllocationId: allocation.saleAllocationId,
              quantity: allocation.quantity,
            });
            if (item.disposition === "SELLABLE") {
              lotIncrements.set(allocation.lotId, (lotIncrements.get(allocation.lotId) ?? new Decimal(0)).plus(allocation.quantity));
            }
            movementRows.push({
              lotId: allocation.lotId,
              quantity: allocation.quantity,
              kind: item.disposition === "SELLABLE" ? "RETURN" : "RETURN_DAMAGED",
              returnAllocationId,
            });
          }
        }

        if (itemRows.length) await tx.saleReturnItem.createMany({ data: itemRows });
        if (allocationRows.length) await tx.saleReturnAllocation.createMany({ data: allocationRows });
        if (lotIncrements.size) {
          const updates = Prisma.join(
            [...lotIncrements.entries()].map(([lotId, qty]) =>
              Prisma.sql`(CAST(${lotId} AS uuid), CAST(${qty.toFixed(3)} AS numeric(12,3)))`,
            ),
          );
          await tx.$executeRaw`
            UPDATE stock_lots AS l
            SET remaining_quantity = l.remaining_quantity + v.qty
            FROM (VALUES ${updates}) AS v(id, qty)
            WHERE l.id = v.id
          `;
        }
        if (movementRows.length) await tx.stockMovement.createMany({ data: movementRows });

        await audit(tx, actor, "SALE_RETURNED", returned.id);
        return {
          result: completed(await tx.saleReturn.findUniqueOrThrow({ where: { id: returned.id }, include: returnDetails })),
          replayed: false,
        };
      }, { timeout: 15_000 });
      if (result instanceof ApiError) throw result;
      return result;
    },
  };
}
