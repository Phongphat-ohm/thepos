import { Prisma, type AccountingPeriod, type DividendRule } from "@prisma/client";
import type { DividendSnapshot } from "@thepos/contracts";
import { ApiError } from "../errors";

export const Decimal = Prisma.Decimal.clone({ precision: 40 });
export const dateText = (date: Date) => date.toISOString().slice(0, 10);
export const dayDate = (day: string) => new Date(day + "T00:00:00.000Z");
const bangkok = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok" });
export const bangkokDay = (value: number) => bangkok.format(new Date(value));
const nextDay = (date: Date) => new Date(+date + 86_400_000);
const localMidnight = (date: Date) => new Date(+date - 25_200_000);
const zero = new Decimal(0);
const maximum = new Decimal("9999999999.99");

export function monthBoundaries(start: Date, end: Date) {
  const cursor = new Date(start);
  if (cursor.getUTCDate() !== 1) throw new ApiError(400, "INVALID_PERIOD_DATES");
  const months = Array.from({ length: 12 }, () => {
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    return new Date(cursor);
  });
  if (+months[11]! !== +nextDay(end)) throw new ApiError(400, "INVALID_PERIOD_DATES");
  return months;
}

// Allocate each category independently so rounded member entries equal the rounded fund total.
function allocate(numerators: Prisma.Decimal[], denominator: number) {
  const floors = numerators.map((value) => value.divToInt(denominator));
  const numeratorTotal = numerators.reduce((total, value) => total.plus(value), zero);
  const total = numeratorTotal.div(denominator).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const remainder = total.minus(floors.reduce((value, floor) => value.plus(floor), zero)).toNumber();
  const order = numerators.map((value, index) => ({ index, fraction: value.mod(denominator) }))
    .sort((a, b) => b.fraction.cmp(a.fraction) || a.index - b.index);
  for (const { index } of order.slice(0, remainder)) floors[index] = floors[index]!.plus(1);
  return { amounts: floors.map((value) => value.div(100)), total: total.div(100) };
}

export async function calculateDividend(
  tx: Prisma.TransactionClient, period: AccountingPeriod, rule: DividendRule,
): Promise<DividendSnapshot> {
  const { storeId, startDate, endDate } = period;
  const monthly = rule.formula === "MONTHLY_AVERAGE";
  const ends = monthly ? monthBoundaries(startDate, endDate) : [nextDay(endDate)];
  const [shareEntries, purchaseEntries] = await Promise.all([
    tx.$queryRaw<{ memberId: string; effectiveDate: Date; amount: Prisma.Decimal }[]>`
      SELECT a.member_id AS "memberId", GREATEST(t.effective_date, ${startDate}::date) AS "effectiveDate",
             SUM(t.total_amount) AS amount
      FROM share_transactions t JOIN share_accounts a ON a.id = t.share_account_id
      JOIN members m ON m.id = a.member_id
      WHERE m.store_id = ${storeId}::uuid AND t.effective_date <= ${endDate}::date
      GROUP BY a.member_id, 2
      ORDER BY "effectiveDate"`,
    tx.memberPurchaseLedger.groupBy({
      by: ["memberId"], where: { member: { storeId }, recordedAt: { gte: localMidnight(startDate), lt: localMidnight(nextDay(endDate)) } },
      _sum: { netEligibleAmount: true },
    }),
  ]);
  const purchases = new Map(purchaseEntries.map(({ memberId, _sum }) => [memberId, new Decimal(_sum.netEligibleAmount ?? 0)]));
  const balances = new Map<string, Prisma.Decimal[]>();
  for (const { memberId, effectiveDate, amount } of shareEntries) {
    const month = ends.findIndex((end) => effectiveDate < end);
    if (month < 0) continue;
    const changes = balances.get(memberId) ?? ends.map(() => zero);
    changes[month] = changes[month]!.plus(amount);
    balances.set(memberId, changes);
  }
  const activeMemberIds = [...new Set([...balances.keys(), ...purchases.keys()])];
  const members = activeMemberIds.length
    ? await tx.member.findMany({
        where: { storeId, id: { in: activeMemberIds } },
        select: { id: true, number: true, name: true },
        orderBy: { id: "asc" },
      })
    : [];
  const inputs = members.map((member) => {
    const changes = balances.get(member.id) ?? ends.map(() => zero);
    let balance = zero;
    let shareSum = zero;
    for (const change of changes) {
      balance = balance.plus(change);
      if (balance.isNegative() && !balance.isZero()) throw new ApiError(409, "FINANCIAL_LIMIT");
      shareSum = shareSum.plus(balance);
    }
    return { member, shareSum, purchases: purchases.get(member.id) ?? zero };
  });
  const dividend = allocate(inputs.map(({ shareSum }) => shareSum.mul(rule.dividendRate)), ends.length);
  const rebate = allocate(inputs.map(({ purchases }) => Decimal.max(0, purchases).mul(rule.rebateRate)), 1);
  const rows = inputs.map(({ member, shareSum, purchases }, index) => {
    const share = dividend.amounts[index]!;
    const refund = rebate.amounts[index]!;
    const total = share.plus(refund);
    if (total.gt(maximum)) throw new ApiError(409, "FINANCIAL_LIMIT");
    return { memberId: member.id, number: member.number, name: member.name, shareBasis: shareSum.div(ends.length).toFixed(4),
      eligiblePurchases: purchases.toFixed(2), dividendAmount: share.toFixed(2), rebateAmount: refund.toFixed(2),
      total: total.toFixed(2), negativePurchases: purchases.lt(0) };
  });
  return {
    dividendTotal: dividend.total.toFixed(2), rebateTotal: rebate.total.toFixed(2), total: dividend.total.plus(rebate.total).toFixed(2),
    negativePurchases: rows.filter((row) => row.negativePurchases).length,
    payableMembers: rows.filter(({ total }) => total !== "0.00").length,
    rows: rows.sort((a, b) => a.number.localeCompare(b.number) || a.memberId.localeCompare(b.memberId)),
  };
}
