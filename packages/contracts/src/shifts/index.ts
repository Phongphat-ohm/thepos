import { z } from "zod";
import { managerApprovalInput } from "../sales";
import { moneySchema } from "../shared/primitives";

export const shiftOpenInput = z.strictObject({ openingFloat: moneySchema });

export const shiftMovementInput = z.strictObject({
  kind: z.enum(["CASH_IN", "CASH_DROP", "PETTY_CASH"]),
  amount: moneySchema.refine((value) => /[1-9]/.test(value)),
  reason: z.string().trim().min(1).max(300),
});

export const shiftCloseInput = z.strictObject({
  countedCash: moneySchema,
  expectedCash: z.string().regex(/^-?\d{1,10}(\.\d{1,2})?$/),
  approval: managerApprovalInput.optional(),
});

export type CashMovementInput = z.output<typeof shiftMovementInput>;
export type ShiftCloseInput = z.output<typeof shiftCloseInput>;

export type ShiftMovement = {
  id: string;
  kind: CashMovementInput["kind"] | "SALE" | "REFUND" | "PAYOUT_OUT";
  amount: string;
  reason: string | null;
  recordedAt: string;
  reference: string | null;
};

export type CashShift = {
  id: string;
  cashier: string;
  device: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: string;
  cashSales: string;
  cashRefunds: string;
  cashIn: string;
  cashOut: string;
  expectedCash: string;
  countedCash: string | null;
  variance: string | null;
  varianceLimit: string;
  approver: string | null;
  editable: boolean;
  canForceClose?: boolean;
};
