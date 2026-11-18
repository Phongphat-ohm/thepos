import { Prisma, type PrismaClient } from "@prisma/client";
import type { CashMovementInput, CashShift, CatalogQuery, ShiftCloseInput, ShiftMovement } from "@thepos/contracts";
import { ApiError } from "../errors";
import { audit } from "./auth";
import type { StoreActor } from "./catalog";
import { pageMeta, resolveOrder } from "./pagination";
import { managerApproval } from "./sales-approval";

const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const maximum = money("9999999999.99");
const fields = { cashier: { select: { name: true } }, device: { select: { name: true } }, approver: { select: { name: true } } } satisfies Prisma.CashShiftInclude;
type Row = Prisma.CashShiftGetPayload<{ include: typeof fields }>;
type Tx = Prisma.TransactionClient;

async function lockDrawer(tx: Tx, deviceId: string) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'drawer:' + deviceId}, 0))`;
}

export async function shiftForPosting(tx: Tx, actor: StoreActor, required: boolean) {
  await lockDrawer(tx, actor.deviceId);
  const row = await tx.cashShift.findFirst({ where: { storeId: actor.storeId, deviceId: actor.deviceId, closedAt: null } });
  if (row && row.cashierId !== actor.userId) {
    if (required) throw new ApiError(409, "SHIFT_CONFLICT");
    return null;
  }
  if (!row && required) throw new ApiError(409, "SHIFT_REQUIRED");
  return row;
}

async function balances(tx: Tx, shiftId: string, opening: Prisma.Decimal) {
  const rows = await tx.cashMovement.groupBy({ by: ["kind"], where: { shiftId }, _sum: { amount: true } });
  const values = new Map(rows.map(({ kind, _sum }) => [kind, _sum.amount]));
  const get = (kind: string) => money(values.get(kind) ?? 0);
  const cashSales = get("SALE"), cashRefunds = get("REFUND"), cashIn = get("CASH_IN");
  const cashOut = get("CASH_DROP").plus(get("PETTY_CASH")).plus(get("PAYOUT_OUT"));
  return { cashSales, cashRefunds, cashIn, cashOut, expected: opening.plus(cashSales).minus(cashRefunds).plus(cashIn).minus(cashOut) };
}

export async function drawerForPayout(tx: Tx, actor: StoreActor, amount: Prisma.Decimal) {
  await lockDrawer(tx, actor.deviceId);
  const shift = await tx.cashShift.findFirst({ where: { storeId: actor.storeId, deviceId: actor.deviceId, closedAt: null } });
  if (!shift) throw new ApiError(409, "SHIFT_REQUIRED");
  const { expected } = await balances(tx, shift.id, shift.openingFloat);
  if (amount.gt(expected)) throw new ApiError(409, "CASH_LIMIT");
  return shift.id;
}

async function dto(tx: Tx, actor: StoreActor, row: Row, limit: string, review = false): Promise<CashShift> {
  const { cashSales, cashRefunds, cashIn, cashOut, expected } = await balances(tx, row.id, row.openingFloat);
  const isOwner = row.deviceId === actor.deviceId && row.cashierId === actor.userId;
  return {
    id: row.id, cashier: row.cashier.name, device: row.device.name, openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null, openingFloat: row.openingFloat.toFixed(2), cashSales: cashSales.toFixed(2),
    cashRefunds: cashRefunds.toFixed(2), cashIn: cashIn.toFixed(2), cashOut: cashOut.toFixed(2),
    expectedCash: (row.expectedCash ?? expected).toFixed(2), countedCash: row.countedCash?.toFixed(2) ?? null,
    variance: row.variance?.toFixed(2) ?? null, varianceLimit: money(row.varianceLimit ?? limit).toFixed(2),
    approver: row.approver?.name ?? null,
    editable: !row.closedAt && isOwner,
    canForceClose: !row.closedAt && review && !isOwner,
  };
}

export function createShifts(db: PrismaClient, now: () => number, varianceLimit: string) {
  return {
    async list(actor: StoreActor, review: boolean, query?: CatalogQuery) {
      const q = query?.q ?? "";
      const limit = query?.limit ?? 30;
      const after = query?.after;
      const pageNum = query?.page;
      const where: Prisma.CashShiftWhereInput = {
        storeId: actor.storeId,
        ...(!review && { cashierId: actor.userId }),
        ...(q && { OR: [{ cashier: { name: { contains: q, mode: "insensitive" } } }, { device: { name: { contains: q, mode: "insensitive" } } }] }),
      };
      const orderBy = resolveOrder<Prisma.CashShiftOrderByWithRelationInput>(
        {
          openedAt: (dir) => [{ openedAt: dir }, { id: dir }],
          closedAt: (dir) => [{ closedAt: dir }, { openedAt: "desc" }, { id: "asc" }],
          variance: (dir) => [{ variance: dir }, { openedAt: "desc" }, { id: "asc" }],
        },
        [{ openedAt: "desc" }, { id: "desc" }],
        query?.sortBy,
        query?.sortDir,
      );
      if (pageNum) {
        const [open, rows, total] = await Promise.all([
          db.cashShift.findFirst({ where: { storeId: actor.storeId, deviceId: actor.deviceId, closedAt: null }, include: fields }),
          db.cashShift.findMany({ where, include: fields, orderBy, skip: (pageNum - 1) * limit, take: limit }),
          db.cashShift.count({ where }),
        ]);
        const items = rows.map((row) => ({
          id: row.id, cashier: row.cashier.name, device: row.device.name,
          openedAt: row.openedAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null, variance: row.variance?.toFixed(2) ?? null,
        }));
        return { current: open ? await dto(db, actor, open, varianceLimit, review) : null, items, ...pageMeta(total, pageNum, limit) };
      }
      if (after && !await db.cashShift.findFirst({ where: { ...where, id: after }, select: { id: true } })) throw new ApiError(404, "NOT_FOUND");
      const [open, rows] = await Promise.all([
        db.cashShift.findFirst({ where: { storeId: actor.storeId, deviceId: actor.deviceId, closedAt: null }, include: fields }),
        db.cashShift.findMany({ where, include: fields, orderBy, take: limit + 1,
          ...(after && { cursor: { id: after }, skip: 1 }) }),
      ]);
      const items = rows.slice(0, limit).map((row) => ({ id: row.id, cashier: row.cashier.name, device: row.device.name,
        openedAt: row.openedAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null, variance: row.variance?.toFixed(2) ?? null }));
      return { current: open ? await dto(db, actor, open, varianceLimit, review) : null, items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
    },
    async read(actor: StoreActor, id: string, review: boolean, query?: CatalogQuery) {
      const limit = query?.limit ?? 50;
      const after = query?.after;
      const pageNum = query?.page;
      return db.$transaction(async (tx) => {
        const row = await tx.cashShift.findFirst({ where: { id, storeId: actor.storeId, ...(!review && { cashierId: actor.userId }) }, include: fields });
        if (!row) throw new ApiError(404, "NOT_FOUND");
        const where: Prisma.CashMovementWhereInput = { shiftId: id };
        const orderBy = resolveOrder<Prisma.CashMovementOrderByWithRelationInput>(
          {
            recordedAt: (dir) => [{ recordedAt: dir }, { id: dir }],
            kind: (dir) => [{ kind: dir }, { recordedAt: "desc" }, { id: "asc" }],
            amount: (dir) => [{ amount: dir }, { recordedAt: "desc" }, { id: "asc" }],
          },
          [{ recordedAt: "desc" }, { id: "desc" }],
          query?.sortBy,
          query?.sortDir,
        );
        const mapItem = (item: Prisma.CashMovementGetPayload<{ include: { sale: { select: { invoiceNumber: true } }; returned: { select: { id: true } }; payout: { select: { receiptNumber: true } } } }>): ShiftMovement => ({
          id: item.id, amount: item.amount.toFixed(2), kind: item.kind as ShiftMovement["kind"], reason: item.reason,
          recordedAt: item.recordedAt.toISOString(), reference: item.sale?.invoiceNumber ?? item.returned?.id ?? item.payout?.receiptNumber ?? null,
        });
        if (pageNum) {
          const [movements, total] = await Promise.all([
            tx.cashMovement.findMany({
              where, skip: (pageNum - 1) * limit, take: limit, orderBy,
              include: { sale: { select: { invoiceNumber: true } }, returned: { select: { id: true } }, payout: { select: { receiptNumber: true } } },
            }),
            tx.cashMovement.count({ where }),
          ]);
          return { shift: await dto(tx, actor, row, varianceLimit, review), items: movements.map(mapItem), ...pageMeta(total, pageNum, limit) };
        }
        if (after && !await tx.cashMovement.findFirst({ where: { id: after, shiftId: id }, select: { id: true } })) throw new ApiError(404, "NOT_FOUND");
        const movements = await tx.cashMovement.findMany({ where, take: limit + 1,
          orderBy, ...(after && { cursor: { id: after }, skip: 1 }),
          include: { sale: { select: { invoiceNumber: true } }, returned: { select: { id: true } }, payout: { select: { receiptNumber: true } } },
        });
        return { shift: await dto(tx, actor, row, varianceLimit, review), items: movements.slice(0, limit).map(mapItem), nextCursor: movements.length > limit ? movements[limit - 1]!.id : null };
      }, { isolationLevel: "RepeatableRead" });
    },
    async open(actor: StoreActor, id: string, openingFloat: string) {
      return db.$transaction(async (tx) => {
        await lockDrawer(tx, actor.deviceId);
        const existing = await tx.cashShift.findUnique({ where: { id }, include: fields });
        if (existing) {
          if (existing.cashierId !== actor.userId || existing.deviceId !== actor.deviceId || !existing.openingFloat.eq(openingFloat)) throw new ApiError(409, "IDEMPOTENCY_CONFLICT");
          return dto(tx, actor, existing, varianceLimit);
        }
        if (await tx.cashShift.findFirst({ where: { deviceId: actor.deviceId, closedAt: null }, select: { id: true } })) throw new ApiError(409, "SHIFT_CONFLICT");
        const row = await tx.cashShift.create({ data: { id, storeId: actor.storeId, deviceId: actor.deviceId,
          cashierId: actor.userId, openingFloat, openedAt: new Date(now()) }, include: fields });
        await audit(tx, actor, "SHIFT_OPENED", id);
        return dto(tx, actor, row, varianceLimit);
      });
    },
    async move(actor: StoreActor, id: string, key: string, input: CashMovementInput) {
      return db.$transaction(async (tx) => {
        await lockDrawer(tx, actor.deviceId);
        const prior = await tx.cashMovement.findUnique({ where: { requestKey: key } });
        if (prior) {
          if (prior.shiftId !== id || prior.actorId !== actor.userId || prior.kind !== input.kind || !prior.amount.eq(input.amount) || prior.reason !== input.reason) {
            throw new ApiError(409, "IDEMPOTENCY_CONFLICT");
          }
          return { id: prior.id };
        }
        const row = await tx.cashShift.findFirst({ where: { id, storeId: actor.storeId, cashierId: actor.userId, deviceId: actor.deviceId, closedAt: null } });
        if (!row) throw new ApiError(409, "SHIFT_REQUIRED");
        const { expected } = await balances(tx, id, row.openingFloat);
        const amount = money(input.amount);
        if (input.kind === "CASH_IN" ? expected.plus(amount).gt(maximum) : amount.gt(expected)) throw new ApiError(409, "CASH_LIMIT");
        const movement = await tx.cashMovement.create({ data: { ...input, shiftId: id, requestKey: key, actorId: actor.userId, recordedAt: new Date(now()) } });
        await audit(tx, actor, "SHIFT_CASH_MOVEMENT", movement.id);
        return { id: movement.id };
      });
    },
    async close(actor: StoreActor, id: string, input: ShiftCloseInput, canReview = false) {
      const target = await db.cashShift.findFirst({ where: { id, storeId: actor.storeId }, select: { deviceId: true, cashierId: true } });
      if (!target) throw new ApiError(404, "NOT_FOUND");
      const isOwner = target.cashierId === actor.userId && target.deviceId === actor.deviceId;
      if (!isOwner && !canReview) throw new ApiError(403, "FORBIDDEN");

      const result = await db.$transaction(async (tx) => {
        await lockDrawer(tx, target.deviceId);
        const row = await tx.cashShift.findFirst({ where: { id, storeId: actor.storeId }, include: fields });
        if (!row) throw new ApiError(404, "NOT_FOUND");
        if (row.closedAt) {
          if (row.countedCash?.eq(input.countedCash) && row.expectedCash?.eq(input.expectedCash)) return dto(tx, actor, row, varianceLimit, canReview);
          throw new ApiError(409, "SHIFT_CONFLICT");
        }
        const { expected } = await balances(tx, id, row.openingFloat);
        if (!expected.eq(input.expectedCash)) throw new ApiError(409, "SHIFT_STALE");
        const variance = money(input.countedCash).minus(expected);
        if (variance.abs().gt(maximum) || expected.abs().gt(maximum)) throw new ApiError(409, "FINANCIAL_LIMIT");
        const isForceClose = row.cashierId !== actor.userId || row.deviceId !== actor.deviceId;
        let approver: string | null = null;
        if (isForceClose) {
          // A manager with shift:review force-closing an abandoned shift serves as the closing approver.
          approver = actor.userId;
        } else if (variance.abs().gt(varianceLimit)) {
          const decision = await managerApproval(tx, actor, input.approval, now(), "shifts");
          if (decision instanceof ApiError) return decision;
          approver = decision;
        }
        const closed = await tx.cashShift.update({ where: { id }, include: fields, data: {
          expectedCash: expected, countedCash: input.countedCash, variance, varianceLimit, approvedBy: approver, closedAt: new Date(now()),
        } });
        await audit(tx, actor, isForceClose ? "SHIFT_FORCE_CLOSED" : "SHIFT_CLOSED", id);
        return dto(tx, actor, closed, varianceLimit, canReview);
      });
      if (result instanceof ApiError) throw result;
      return result;
    },
  };
}
