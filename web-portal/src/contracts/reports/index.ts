import { z } from "zod";

export const reportKind = z.enum([
  "daily",
  "monthly",
  "product",
  "category",
  "cashier",
  "payment",
  "profit",
  "stock",
  "movement",
  "expiry",
  "members",
  "dividends",
  "payouts",
  "shifts",
]);
export type ReportKind = z.infer<typeof reportKind>;

export const reportQuery = z
  .strictObject({
    kind: reportKind,
    start: z.iso.date(),
    end: z.iso.date(),
    q: z.string().trim().max(120).default(""),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    sortCol: z.coerce.number().int().min(0).max(20).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  })
  .refine(
    ({ start, end }) =>
      start <= end && !start.startsWith("0000") && Date.parse(end) - Date.parse(start) <= 365 * 86_400_000,
  );
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
  stock?: {
    low: string;
    expiring: string;
    expired: string;
    lots: { name: string; lot: string; date: string; quantity: string }[];
  };
  payoutBalance?: string;
};
