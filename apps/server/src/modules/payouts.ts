import { Prisma, type PrismaClient } from "@prisma/client";
import type { CatalogQuery, PayoutInput, PayoutObligation, PayoutObligationQuery, PayoutReceipt } from "@thepos/contracts";
import { ApiError } from "../errors";
import { digest } from "../security";
import { audit } from "./auth";
import type { StoreActor } from "./catalog";
import { bangkokDay, Decimal } from "./dividend-calculation";
import { getPeriod } from "./dividends";
import { lockFinance } from "./finance-lock";
import { pageMeta, resolveOrder } from "./pagination";
import { drawerForPayout } from "./shifts";

const operator = { operator: { select: { name: true } }, cashMovement: { select: { id: true } } } satisfies Prisma.PayoutInclude;
const details = { ...operator, allocation: true } satisfies Prisma.PayoutInclude;

function receipt(row: Prisma.PayoutGetPayload<{ include: typeof operator }>): PayoutReceipt {
  return { id: row.id, receiptNumber: row.receiptNumber, amount: row.amount.toFixed(2),
    method: row.method as PayoutInput["method"], reference: row.reference, paidAt: row.paidAt.toISOString(), operator: row.operator.name,
    ...(row.cashMovement && { drawer: true }) };
}

async function getObligation(tx: Prisma.TransactionClient, storeId: string, id: string) {
  const obligation = await tx.payoutObligation.findFirst({ where: { id, period: { storeId } }, include: { period: true } });
  if (!obligation) throw new ApiError(404, "NOT_FOUND");
  return obligation;
}

type ObligationRow = {
  id: string;
  memberId: string;
  number: string;
  name: string;
  dividendAmount: Prisma.Decimal;
  rebateAmount: Prisma.Decimal;
  totalObligation: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  status: PayoutObligation["status"];
};

function obligationDto(row: ObligationRow): PayoutObligation {
  return {
    id: row.id,
    memberId: row.memberId,
    number: row.number,
    name: row.name,
    dividendAmount: new Decimal(row.dividendAmount).toFixed(2),
    rebateAmount: new Decimal(row.rebateAmount).toFixed(2),
    total: new Decimal(row.totalObligation).toFixed(2),
    paid: new Decimal(row.paidAmount).toFixed(2),
    remaining: new Decimal(row.remainingAmount).toFixed(2),
    status: row.status,
  };
}

export function createPayouts(db: PrismaClient, now: () => number) {
  return {
    async obligations(storeId: string, periodId: string, { q, status = "all", limit, after, page: pageNum, sortBy, sortDir }: PayoutObligationQuery) {
      return db.$transaction(async (tx) => {
        await getPeriod(tx, storeId, periodId);
        const sql = Prisma.sql;
        const term = q.trim();
        const searchFilter = term
          ? sql`AND (m.number ILIKE ${"%" + term + "%"} OR m.name ILIKE ${"%" + term + "%"})`
          : Prisma.empty;
        const statusFilter = status !== "all"
          ? sql`AND status = ${status}`
          : Prisma.empty;
        const dirSql = sortDir === "desc" ? sql`DESC` : sql`ASC`;
        const sortColumnMap: Record<string, Prisma.Sql> = {
          number: sql`number ${dirSql}, id ASC`,
          name: sql`name ${dirSql}, id ASC`,
          total: sql`total_obligation ${dirSql}, id ASC`,
          totalAmount: sql`total_obligation ${dirSql}, id ASC`,
          paidAmount: sql`paid_amount ${dirSql}, id ASC`,
          status: sql`status ${dirSql}, number ASC, id ASC`,
        };
        const orderExpr = sortBy && Object.hasOwn(sortColumnMap, sortBy)
          ? sortColumnMap[sortBy]!
          : sql`number ASC, id ASC`;

        const baseCte = sql`
          WITH obligations AS (
            SELECT
              o.id,
              o.member_id AS "memberId",
              m.number,
              m.name,
              o.dividend_amount AS "dividendAmount",
              o.rebate_amount AS "rebateAmount",
              o.total_obligation,
              o.total_obligation AS "totalObligation",
              COALESCE(SUM(a.amount), 0) AS paid_amount,
              COALESCE(SUM(a.amount), 0) AS "paidAmount",
              o.total_obligation - COALESCE(SUM(a.amount), 0) AS "remainingAmount",
              CASE
                WHEN o.total_obligation - COALESCE(SUM(a.amount), 0) = 0 THEN 'PAID_IN_FULL'
                WHEN COALESCE(SUM(a.amount), 0) = 0 THEN 'UNPAID'
                ELSE 'PARTIAL'
              END AS status
            FROM payout_obligations o
            JOIN members m ON m.id = o.member_id
            LEFT JOIN payout_allocations a ON a.obligation_id = o.id
            WHERE o.accounting_period_id = ${periodId}::uuid
            ${searchFilter}
            GROUP BY o.id, m.number, m.name
          ),
          filtered AS (
            SELECT * FROM obligations
            WHERE true ${statusFilter}
          )
        `;

        if (pageNum) {
          const offset = (pageNum - 1) * limit;
          const rows = await tx.$queryRaw<(ObligationRow & { total_count: bigint })[]>`
            ${baseCte}
            SELECT *, COUNT(*) OVER() AS total_count
            FROM filtered
            ORDER BY ${orderExpr}
            LIMIT ${limit} OFFSET ${offset}
          `;
          let total = Number(rows[0]?.total_count ?? 0);
          if (rows.length === 0 && pageNum > 1) {
            const [countRow] = await tx.$queryRaw<{ count: bigint }[]>`
              ${baseCte}
              SELECT COUNT(*) AS count FROM filtered
            `;
            total = Number(countRow?.count ?? 0);
          }
          return { items: rows.map(obligationDto), ...pageMeta(total, pageNum, limit) };
        }

        const afterFilter = after ? sql`AND id > ${after}::uuid` : Prisma.empty;
        const rows = await tx.$queryRaw<ObligationRow[]>`
          ${baseCte}
          SELECT * FROM filtered
          WHERE true ${afterFilter}
          ORDER BY id ASC
          LIMIT ${limit + 1}
        `;
        const page = rows.slice(0, limit);
        return {
          items: page.map(obligationDto),
          nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
        };
      }, { isolationLevel: "RepeatableRead" });
    },
    async history(storeId: string, id: string, { limit, after, page: pageNum, sortBy, sortDir }: CatalogQuery) {
      await getObligation(db, storeId, id);
      const where: Prisma.PayoutWhereInput = { storeId, allocation: { obligationId: id } };
      const orderBy = resolveOrder<Prisma.PayoutOrderByWithRelationInput>(
        {
          paidAt: (dir) => [{ paidAt: dir }, { id: dir }],
          receiptNumber: (dir) => [{ receiptNumber: dir }, { id: "asc" }],
          amount: (dir) => [{ amount: dir }, { paidAt: "desc" }, { id: "desc" }],
        },
        [{ paidAt: "desc" }, { id: "desc" }],
        sortBy,
        sortDir,
      );
      if (pageNum) {
        const [rows, total] = await Promise.all([
          db.payout.findMany({ where, include: operator, orderBy, skip: (pageNum - 1) * limit, take: limit }),
          db.payout.count({ where }),
        ]);
        return { items: rows.map(receipt), ...pageMeta(total, pageNum, limit) };
      }
      if (after && !await db.payout.findFirst({ where: { id: after, storeId, allocation: { obligationId: id } }, select: { id: true } })) {
        throw new ApiError(404, "NOT_FOUND");
      }
      const rows = await db.payout.findMany({ where,
        include: operator, orderBy, take: limit + 1,
        ...(after && { cursor: { id: after }, skip: 1 }),
      });
      return { items: rows.slice(0, limit).map(receipt), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
    },
    async record(actor: StoreActor, id: string, key: string, input: PayoutInput) {
      return db.$transaction(async (tx) => {
        await lockFinance(tx, actor.storeId, "posting");
        const { amount, method } = input;
        const reference = method === "BANK_TRANSFER" ? input.reference : null;
        const value = new Decimal(amount);
        const drawer = method === "CASH" && input.drawer === true;
        const fingerprint = digest(JSON.stringify({ id, method, amount: value.toFixed(2), reference, ...(drawer && { drawer: true }) }));
        const prior = await tx.payout.findUnique({ where: { storeId_key: { storeId: actor.storeId, key } }, include: details });
        if (prior) {
          if (prior.paidBy !== actor.userId || prior.fingerprint !== fingerprint) throw new ApiError(409, "IDEMPOTENCY_CONFLICT");
          return { payout: receipt(prior), replayed: true };
        }
        const obligation = await getObligation(tx, actor.storeId, id);
        if (obligation.period.status !== "APPROVED_LOCKED") throw new ApiError(409, "PERIOD_LOCKED");
        await tx.$queryRaw`SELECT id FROM payout_obligations WHERE id = ${id}::uuid FOR UPDATE`;
        const paid = await tx.payoutAllocation.aggregate({ where: { obligationId: id }, _sum: { amount: true } });
        if (value.plus(paid._sum.amount ?? 0).gt(obligation.totalObligation)) throw new ApiError(409, "PAYOUT_LIMIT");
        const shiftId = drawer ? await drawerForPayout(tx, actor, value) : null;
        const paidAt = new Date(now());
        const [{ nextval }] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('payout_receipt_sequence')`;
        const receiptNumber = "PAY-" + bangkokDay(+paidAt).replaceAll("-", "") + "-" + nextval.toString().padStart(4, "0");
        const row = await tx.payout.create({ data: {
          storeId: actor.storeId, key, fingerprint, receiptNumber,
          method, reference, amount: value, paidAt, paidBy: actor.userId,
        }, include: operator });
        await tx.payoutAllocation.create({ data: { payoutId: row.id, obligationId: id, amount: value } });
        if (shiftId) await tx.cashMovement.create({ data: {
          shiftId, payoutId: row.id, kind: "PAYOUT_OUT", amount: value, actorId: actor.userId, recordedAt: row.paidAt,
        } });
        await audit(tx, actor, "DIVIDEND_PAYOUT_RECORDED", row.id);
        return { payout: { ...receipt(row), ...(drawer && { drawer: true }) }, replayed: false };
      });
    },
  };
}
