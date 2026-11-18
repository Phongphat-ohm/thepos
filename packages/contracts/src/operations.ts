import { z } from "zod";
import { managerApprovalInput, saleMoney } from "./sales";

export const shiftOpenInput = z.strictObject({ openingFloat: saleMoney });
export const shiftMovementInput = z.strictObject({
  kind: z.enum(["CASH_IN", "CASH_DROP", "PETTY_CASH"]),
  amount: saleMoney.refine((value) => /[1-9]/.test(value)),
  reason: z.string().trim().min(1).max(300),
});
export const shiftCloseInput = z.strictObject({
  countedCash: saleMoney, expectedCash: z.string().regex(/^-?\d{1,10}(\.\d{1,2})?$/), approval: managerApprovalInput.optional(),
});
export type CashMovementInput = z.output<typeof shiftMovementInput>;
export type ShiftCloseInput = z.output<typeof shiftCloseInput>;
export type ShiftMovement = {
  id: string; kind: CashMovementInput["kind"] | "SALE" | "REFUND" | "PAYOUT_OUT";
  amount: string; reason: string | null; recordedAt: string; reference: string | null;
};
export type CashShift = {
  id: string; cashier: string; device: string; openedAt: string; closedAt: string | null; openingFloat: string;
  cashSales: string; cashRefunds: string; cashIn: string; cashOut: string;
  expectedCash: string; countedCash: string | null; variance: string | null;
  varianceLimit: string; approver: string | null; editable: boolean; canForceClose?: boolean;
};

export const reportKind = z.enum(["daily", "monthly", "product", "category", "cashier", "payment", "profit",
  "stock", "movement", "expiry", "members", "dividends", "payouts", "shifts"]);
export type ReportKind = z.infer<typeof reportKind>;
export const reportQuery = z.strictObject({
  kind: reportKind,
  start: z.iso.date(),
  end: z.iso.date(),
  q: z.string().trim().max(120).default(""),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sortCol: z.coerce.number().int().min(0).max(20).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
}).refine(({ start, end }) => start <= end && !start.startsWith("0000") &&
  Date.parse(end) - Date.parse(start) <= 365 * 86_400_000);
export type ReportQuery = z.output<typeof reportQuery>;
export type ReportColumn = { label: string; number?: "money" | "quantity" | "count" };
export type Report = {
  store: string;
  title: string;
  start: string;
  end: string;
  columns: ReportColumn[];
  rows: string[][];
  note?: string;
  limited: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
};
export type Dashboard = {
  date: string;
  sales?: { net: string; receipts: string; refunds: string; profit?: string; personal: boolean };
  stock?: { low: string; expiring: string; expired: string; lots: { name: string; lot: string; date: string; quantity: string }[] };
  payoutBalance?: string;
};
