import { Prisma, type AccountingPeriod as PeriodRecord, type DividendRule as RuleRecord, type PrismaClient } from "@prisma/client";
import type { AccountingPeriod, AccountingPeriodInput, CatalogQuery, DividendPreview, DividendRule, DividendRuleInput, DividendSnapshot, PurchaseAdjustmentInput } from "@thepos/contracts";
import { ApiError } from "../errors";
import { digest } from "../security";
import { audit } from "./auth";
import type { StoreActor } from "./catalog";
import { bangkokDay, calculateDividend, dateText, dayDate, Decimal, monthBoundaries } from "./dividend-calculation";
import { lockFinance } from "./finance-lock";
import { pageMeta, resolveOrder } from "./pagination";

const periodFields = { rule: true, approver: { select: { name: true } } } satisfies Prisma.AccountingPeriodInclude;
const txOptions = { timeout: 60_000 };
const isLocked = (status: string) => status === "APPROVED_LOCKED" || status === "CLOSED";

function filterAndSortSnapshotRows(
  rows: DividendPreview["items"],
  q: string,
  sortBy?: string,
  sortDir?: "asc" | "desc",
) {
  const term = q.trim().toLowerCase();
  const filtered = term
    ? rows.filter((row) => row.number.toLowerCase().includes(term) || row.name.toLowerCase().includes(term))
    : rows;
  if (!sortBy) return filtered;
  const dir = sortDir === "desc" ? -1 : 1;
  return [...filtered].sort((a, b) => {
    if (sortBy === "name") return dir * a.name.localeCompare(b.name) || a.memberId.localeCompare(b.memberId);
    if (sortBy === "shareBasis" || sortBy === "eligiblePurchases" || sortBy === "dividendAmount" || sortBy === "rebateAmount" || sortBy === "total") {
      return dir * (Number(a[sortBy]) - Number(b[sortBy])) || a.memberId.localeCompare(b.memberId);
    }
    return dir * a.number.localeCompare(b.number) || a.memberId.localeCompare(b.memberId);
  });
}

export async function getPeriod(tx: Prisma.TransactionClient, storeId: string, id: string) {
  const period = await tx.accountingPeriod.findFirst({ where: { id, storeId }, include: periodFields });
  if (!period) throw new ApiError(404, "NOT_FOUND");
  return period;
}

function ruleDto(rule: RuleRecord): DividendRule {
  return { id: rule.id, name: rule.name, version: rule.version, formula: rule.formula as DividendRule["formula"],
    dividendRate: rule.dividendRate.toFixed(4), rebateRate: rule.rebateRate.toFixed(4) };
}

function periodDto(period: PeriodRecord & { rule: RuleRecord; approver: { name: string } | null }): AccountingPeriod {
  return { id: period.id, name: period.name, startDate: dateText(period.startDate), endDate: dateText(period.endDate),
    status: period.status as AccountingPeriod["status"], rule: ruleDto(period.rule), currentRunId: period.currentRunId,
    lockedAt: period.lockedAt?.toISOString() ?? null, approver: period.approver?.name ?? null };
}

function editable(period: PeriodRecord) {
  if (isLocked(period.status)) throw new ApiError(409, "PERIOD_LOCKED");
}

export function createDividends(db: PrismaClient, now: () => number) {
  return {
    async rules(storeId: string, query?: CatalogQuery) {
      const q = query?.q ?? "";
      const where: Prisma.DividendRuleWhereInput = {
        storeId,
        ...(q && { name: { contains: q, mode: "insensitive" } }),
      };
      const orderBy = resolveOrder<Prisma.DividendRuleOrderByWithRelationInput>(
        {
          name: (dir) => [{ name: dir }, { version: "desc" }],
          version: (dir) => [{ version: dir }, { name: "asc" }],
          dividendRate: (dir) => [{ dividendRate: dir }, { name: "asc" }],
          rebateRate: (dir) => [{ rebateRate: dir }, { name: "asc" }],
        },
        [{ name: "asc" }, { version: "desc" }],
        query?.sortBy,
        query?.sortDir,
      );
      if (query?.page) {
        const [rows, total] = await Promise.all([
          db.dividendRule.findMany({ where, orderBy, skip: (query.page - 1) * query.limit, take: query.limit }),
          db.dividendRule.count({ where }),
        ]);
        return { items: rows.map(ruleDto), ...pageMeta(total, query.page, query.limit) };
      }
      const rows = await db.dividendRule.findMany({ where, orderBy });
      return { items: rows.map(ruleDto), nextCursor: null };
    },
    async saveRule(actor: StoreActor, input: DividendRuleInput) {
      return db.$transaction(async (tx) => {
        await lockFinance(tx, actor.storeId);
        const latest = await tx.dividendRule.findFirst({ where: { storeId: actor.storeId, name: input.name }, orderBy: { version: "desc" } });
        if (latest?.formula === input.formula && latest.dividendRate.eq(input.dividendRate) && latest.rebateRate.eq(input.rebateRate)) {
          return ruleDto(latest);
        }
        const rule = await tx.dividendRule.create({ data: { ...input, storeId: actor.storeId, version: (latest?.version ?? 0) + 1 } });
        await audit(tx, actor, "DIVIDEND_RULE_VERSION_CREATED", rule.id);
        return ruleDto(rule);
      }, txOptions);
    },
    async periods(storeId: string, query?: CatalogQuery & { status?: string }) {
      const q = query?.q ?? "";
      const status = query?.status ?? "all";
      const where: Prisma.AccountingPeriodWhereInput = {
        storeId,
        ...(status !== "all" && { status }),
        ...(q && { name: { contains: q, mode: "insensitive" } }),
      };
      const orderBy = resolveOrder<Prisma.AccountingPeriodOrderByWithRelationInput>(
        {
          name: (dir) => [{ name: dir }, { startDate: "desc" }],
          startDate: (dir) => [{ startDate: dir }, { id: "asc" }],
          status: (dir) => [{ status: dir }, { startDate: "desc" }],
        },
        [{ startDate: "desc" }, { id: "asc" }],
        query?.sortBy,
        query?.sortDir,
      );
      if (query?.page) {
        const [rows, total] = await Promise.all([
          db.accountingPeriod.findMany({ where, include: periodFields, orderBy, skip: (query.page - 1) * query.limit, take: query.limit }),
          db.accountingPeriod.count({ where }),
        ]);
        return { items: rows.map(periodDto), ...pageMeta(total, query.page, query.limit) };
      }
      const rows = await db.accountingPeriod.findMany({ where, include: periodFields, orderBy });
      return { items: rows.map(periodDto), nextCursor: null };
    },
    async savePeriod(actor: StoreActor, input: AccountingPeriodInput, id?: string) {
      return db.$transaction(async (tx) => {
        await lockFinance(tx, actor.storeId);
        const prior = id ? await getPeriod(tx, actor.storeId, id) : null;
        if (prior) editable(prior);
        const rule = await tx.dividendRule.findFirst({ where: { storeId: actor.storeId, id: input.ruleId } });
        if (!rule) throw new ApiError(400, "INVALID_REFERENCE");
        const startDate = dayDate(input.startDate);
        const endDate = dayDate(input.endDate);
        if (rule.formula === "MONTHLY_AVERAGE") monthBoundaries(startDate, endDate);
        const overlap = await tx.accountingPeriod.findFirst({ where: {
          storeId: actor.storeId, startDate: { lte: endDate }, endDate: { gte: startDate }, ...(id && { id: { not: id } }),
        }, select: { id: true } });
        if (overlap) throw new ApiError(409, "PERIOD_CONFLICT");
        if (prior && (+prior.startDate !== +startDate || +prior.endDate !== +endDate) &&
          await tx.purchaseAdjustment.count({ where: { periodId: prior.id } })) {
          throw new ApiError(409, "PERIOD_CONFLICT");
        }
        const data = { name: input.name, ruleId: rule.id, startDate, endDate, currentRunId: null, status: "DRAFT" };
        const period = prior ? await tx.accountingPeriod.update({ where: { id: prior.id }, data, include: periodFields })
          : await tx.accountingPeriod.create({ data: { ...data, storeId: actor.storeId }, include: periodFields });
        await audit(tx, actor, prior ? "ACCOUNTING_PERIOD_UPDATED" : "ACCOUNTING_PERIOD_CREATED", period.id);
        return periodDto(period);
      }, txOptions);
    },
    async calculate(actor: StoreActor, id: string) {
      return db.$transaction(async (tx) => {
        await lockFinance(tx, actor.storeId);
        const period = await getPeriod(tx, actor.storeId, id);
        editable(period);
        const snapshot = await calculateDividend(tx, period, period.rule);
        const fingerprint = digest(JSON.stringify(snapshot));
        const current = period.currentRunId && await tx.dividendRun.findUnique({ where: { id: period.currentRunId } });
        if (current && current.fingerprint === fingerprint) return periodDto(period);
        const run = await tx.dividendRun.create({ data: { periodId: id, ruleId: period.ruleId,
          snapshot, fingerprint, calculatedAt: new Date(now()), calculatedBy: actor.userId } });
        const updated = await tx.accountingPeriod.update({ where: { id }, data: { currentRunId: run.id, status: "CALCULATED" }, include: periodFields });
        await audit(tx, actor, "DIVIDEND_PREVIEW_CREATED", run.id);
        return periodDto(updated);
      }, txOptions);
    },
    async preview(storeId: string, id: string, { q, limit, after, page: pageNum, sortBy, sortDir }: CatalogQuery): Promise<DividendPreview> {
      const period = await getPeriod(db, storeId, id);
      if (!period.currentRunId) throw new ApiError(404, "NOT_FOUND");
      const run = await db.dividendRun.findUniqueOrThrow({ where: { id: period.currentRunId } });
      const { rows, ...summary } = run.snapshot as unknown as DividendSnapshot;
      const ordered = filterAndSortSnapshotRows(rows, q, sortBy, sortDir);
      if (pageNum) {
        const offset = (pageNum - 1) * limit;
        const items = ordered.slice(offset, offset + limit);
        return {
          ...summary, id: run.id, calculatedAt: run.calculatedAt.toISOString(), items, nextCursor: null,
          totalCount: ordered.length, page: pageNum, pageSize: limit, totalPages: Math.max(1, Math.ceil(ordered.length / limit)),
        };
      }
      const normalizedAfter = after?.toLowerCase();
      const offset = normalizedAfter ? ordered.findIndex((row) => row.memberId === normalizedAfter) + 1 : 0;
      if (normalizedAfter && offset === 0) throw new ApiError(404, "NOT_FOUND");
      const items = ordered.slice(offset, offset + limit);
      return { ...summary, id: run.id, calculatedAt: run.calculatedAt.toISOString(), items,
        nextCursor: offset + limit < ordered.length ? items[items.length - 1]!.memberId : null };
    },
    async approve(actor: StoreActor, id: string, runId: string) {
      return db.$transaction(async (tx) => {
        await lockFinance(tx, actor.storeId);
        const period = await getPeriod(tx, actor.storeId, id);
        if (isLocked(period.status) && period.currentRunId === runId) return periodDto(period);
        editable(period);
        if (period.status !== "CALCULATED" || period.currentRunId !== runId) throw new ApiError(409, "PREVIEW_STALE");
        if (dateText(period.endDate) >= bangkokDay(now())) throw new ApiError(400, "INVALID_PERIOD_DATES");
        const run = await tx.dividendRun.findUniqueOrThrow({ where: { id: runId } });
        const snapshot = await calculateDividend(tx, period, period.rule);
        if (run.ruleId !== period.ruleId || digest(JSON.stringify(snapshot)) !== run.fingerprint) throw new ApiError(409, "PREVIEW_STALE");
        for (let offset = 0; offset < snapshot.rows.length; offset += 2000) {
          const rows = snapshot.rows.slice(offset, offset + 2000);
          await tx.dividendResult.createMany({ data: rows.map(({ memberId, dividendAmount }) => ({ runId, memberId, amount: dividendAmount })) });
          await tx.purchaseRebateResult.createMany({ data: rows.map(({ memberId, rebateAmount }) => ({ runId, memberId, amount: rebateAmount })) });
          const payable = rows.filter(({ total }) => total !== "0.00");
          if (payable.length) await tx.payoutObligation.createMany({ data: payable.map(({ memberId, dividendAmount, rebateAmount, total }) => ({
            periodId: id, memberId, dividendAmount, rebateAmount, totalObligation: total,
          })) });
        }
        const locked = await tx.accountingPeriod.update({ where: { id }, data: {
          status: "APPROVED_LOCKED", lockedAt: new Date(now()), lockedBy: actor.userId,
        }, include: periodFields });
        await audit(tx, actor, "ACCOUNTING_PERIOD_APPROVED_LOCKED", id);
        return periodDto(locked);
      }, txOptions);
    },
    async adjustPurchases(actor: StoreActor, id: string, key: string, input: PurchaseAdjustmentInput) {
      return db.$transaction(async (tx) => {
        await lockFinance(tx, actor.storeId);
        const fingerprint = digest(JSON.stringify({ id, ...input }));
        const prior = await tx.purchaseAdjustment.findUnique({ where: { id: key } });
        if (prior) {
          if (prior.approvedBy !== actor.userId || prior.fingerprint !== fingerprint) throw new ApiError(409, "IDEMPOTENCY_CONFLICT");
          return { id: prior.id };
        }
        const period = await getPeriod(tx, actor.storeId, id);
        editable(period);
        const timestamp = now();
        const date = bangkokDay(timestamp);
        if (date < dateText(period.startDate)) throw new ApiError(400, "INVALID_PERIOD_DATES");
        if (!await tx.member.findFirst({ where: { id: input.memberId, storeId: actor.storeId }, select: { id: true } })) {
          throw new ApiError(400, "INVALID_REFERENCE");
        }
        const periodEndMs = +dayDate(dateText(period.endDate)) + 86_400_000 - 25_200_000 - 1;
        const recordedAt = new Date(Math.min(timestamp, periodEndMs));
        const amount = new Decimal(input.amount).mul(input.direction === "DECREASE" ? -1 : 1);
        const ledger = await tx.memberPurchaseLedger.create({ data: {
          memberId: input.memberId, transactionType: "ADJUSTMENT", grossAmount: "0.00", netEligibleAmount: amount, recordedAt,
        } });
        const row = await tx.purchaseAdjustment.create({ data: {
          id: key, periodId: id, ledgerId: ledger.id, approvedBy: actor.userId, reason: input.reason, fingerprint,
        } });
        await tx.accountingPeriod.update({ where: { id }, data: { status: "DRAFT", currentRunId: null } });
        await audit(tx, actor, "MEMBER_PURCHASE_ADJUSTED", row.id);
        return { id: row.id };
      }, txOptions);
    },
    async close(actor: StoreActor, id: string) {
      return db.$transaction(async (tx) => {
        await lockFinance(tx, actor.storeId);
        const period = await getPeriod(tx, actor.storeId, id);
        if (period.status === "CLOSED") return periodDto(period);
        if (period.status !== "APPROVED_LOCKED") throw new ApiError(409, "PERIOD_LOCKED");
        const [balance] = await tx.$queryRaw<{ unpaid: boolean }[]>`
          SELECT EXISTS(SELECT 1 FROM payout_obligations o
            WHERE o.accounting_period_id = ${id}::uuid AND o.total_obligation > COALESCE(
              (SELECT SUM(a.amount) FROM payout_allocations a WHERE a.obligation_id = o.id), 0)) AS unpaid`;
        if (balance?.unpaid) throw new ApiError(409, "PAYOUT_LIMIT");
        const closed = await tx.accountingPeriod.update({ where: { id }, data: { status: "CLOSED" }, include: periodFields });
        await audit(tx, actor, "ACCOUNTING_PERIOD_CLOSED", id);
        return periodDto(closed);
      }, txOptions);
    },
  };
}
