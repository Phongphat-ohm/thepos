import { z } from "zod";
import { catalogQuery } from "../shared/pagination";
import { moneySchema, uuidSchema as uuid } from "../shared/primitives";

export const dividendFormula = z.enum(["CLOSING_BALANCE", "MONTHLY_AVERAGE"]);
const rate = z.string().trim().regex(/^(?:[0-9]{1,2}(?:\.[0-9]{1,4})?|100(?:\.0{1,4})?)$/);

export const dividendRuleInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  formula: dividendFormula,
  dividendRate: rate,
  rebateRate: rate,
});

export const accountingPeriodInput = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    ruleId: uuid,
  })
  .refine(({ startDate, endDate }) => startDate <= endDate && !startDate.startsWith("0000"));

export const approveDividendInput = z.strictObject({ runId: uuid });

const positiveMoney = moneySchema.refine((amount) => /[1-9]/.test(amount));
export const payoutInput = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("CASH"), amount: positiveMoney, drawer: z.literal(true).optional() }),
  z.strictObject({
    method: z.literal("BANK_TRANSFER"),
    amount: positiveMoney,
    reference: z.string().trim().min(1).max(120),
  }),
]);

export const purchaseAdjustmentInput = z.strictObject({
  memberId: uuid,
  amount: positiveMoney,
  direction: z.enum(["INCREASE", "DECREASE"]),
  reason: z.string().trim().min(1).max(300),
});

export type DividendRuleInput = z.output<typeof dividendRuleInput>;
export type AccountingPeriodInput = z.output<typeof accountingPeriodInput>;
export type PayoutInput = z.output<typeof payoutInput>;
export type PurchaseAdjustmentInput = z.output<typeof purchaseAdjustmentInput>;
export type DividendRule = DividendRuleInput & { id: string; version: number };

export type AccountingPeriod = Omit<AccountingPeriodInput, "ruleId"> & {
  id: string;
  rule: DividendRule;
  status: "DRAFT" | "CALCULATED" | "APPROVED_LOCKED" | "CLOSED";
  currentRunId: string | null;
  lockedAt: string | null;
  approver: string | null;
};

export type DividendRow = {
  memberId: string;
  number: string;
  name: string;
  shareBasis: string;
  eligiblePurchases: string;
  dividendAmount: string;
  rebateAmount: string;
  total: string;
  negativePurchases: boolean;
};

export type DividendSnapshot = {
  rows: DividendRow[];
  dividendTotal: string;
  rebateTotal: string;
  total: string;
  negativePurchases: number;
  payableMembers: number;
};

export type DividendPreview = Omit<DividendSnapshot, "rows"> & {
  id: string;
  calculatedAt: string;
  items: DividendRow[];
  nextCursor: string | null;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
};

export const periodListQuery = catalogQuery.extend({
  status: z.enum(["DRAFT", "CALCULATED", "APPROVED_LOCKED", "CLOSED", "all"]).default("all"),
});

export const payoutObligationQuery = catalogQuery.extend({
  status: z.enum(["UNPAID", "PARTIAL", "PAID_IN_FULL", "all"]).default("all"),
});

export type PayoutObligationQuery = z.output<typeof payoutObligationQuery>;

export type PayoutObligation = {
  id: string;
  memberId: string;
  number: string;
  name: string;
  dividendAmount: string;
  rebateAmount: string;
  total: string;
  paid: string;
  remaining: string;
  status: "UNPAID" | "PARTIAL" | "PAID_IN_FULL";
};

export type PayoutReceipt = {
  id: string;
  receiptNumber: string;
  amount: string;
  method: PayoutInput["method"];
  reference: string | null;
  paidAt: string;
  operator: string;
  drawer?: boolean;
};
