import { z } from "zod";
import { moneySchema, pinSchema, usernameSchema, uuidSchema as uuid } from "./primitives";

export const saleMoney = moneySchema;
export const saleQuantity = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/).refine((value) => /[1-9]/.test(value));
export const discountApprovalPercent = "5";
const revision = z.int().min(1).max(2_147_483_646);
export const managerApprovalInput = z.strictObject({
  username: usernameSchema,
  pin: pinSchema,
});
const approval = managerApprovalInput;

export const posLookupInput = z.strictObject({
  q: z.string().trim().max(255),
  mode: z.enum(["search", "barcode", "browse"]).default("search"),
  categoryId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).refine(({ q, mode }) => mode === "browse" || q.length > 0);

const draft = {
  lines: z.array(z.strictObject({
    productId: uuid,
    unit: z.string().trim().min(1).max(50),
    quantity: saleQuantity,
    expectedBasePrice: saleMoney,
    discount: saleMoney.optional(),
  })).min(1).max(50),
  memberId: uuid.nullable().optional(),
  billDiscount: saleMoney.optional(),
};
export const heldInput = z.strictObject({
  ...draft, note: z.string().trim().max(100).default(""), revision: revision.optional(),
});
export const resumeInput = z.strictObject({ revision });
export const checkoutInput = z.strictObject({
  ...draft,
  drawer: z.literal(true).optional(),
  hold: z.strictObject({ id: uuid, revision }).optional(),
  approval: approval.optional(),
  payments: z.array(z.discriminatedUnion("method", [
    z.strictObject({ method: z.literal("CASH"), amount: saleMoney, tendered: saleMoney }),
    z.strictObject({
      method: z.enum(["TRANSFER", "PROMPTPAY"]),
      amount: saleMoney,
      reference: z.string().trim().min(1).max(120),
    }),
  ])).max(10),
});
export const memberInput = z.strictObject({
  number: z.string().trim().toUpperCase().min(1).max(50),
  name: z.string().trim().min(1).max(120),
  barcode: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().regex(/^\d{9,10}$/).optional(),
});
const returnFields = {
  drawer: z.literal(true).optional(),
  reason: z.string().trim().min(1).max(300),
  lines: z.array(z.strictObject({
    saleItemId: uuid, quantity: saleQuantity, disposition: z.enum(["SELLABLE", "DAMAGED"]),
  })).min(1).max(50).refine((lines) => new Set(lines.map(({ saleItemId }) => saleItemId)).size === lines.length),
  approval: approval.optional(),
};
export const returnQuoteInput = z.strictObject({
  ...returnFields,
  expectedQuote: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
export const returnInput = z.strictObject({
  ...returnFields,
  expectedQuote: z.string().regex(/^[a-f0-9]{64}$/),
});
export type POSLookupInput = z.output<typeof posLookupInput>;
export type CheckoutInput = z.output<typeof checkoutInput>;
export type HeldInput = z.output<typeof heldInput>;
export type MemberInput = z.output<typeof memberInput>;
export type ReturnQuoteInput = z.output<typeof returnQuoteInput>;
export type ReturnInput = z.output<typeof returnInput>;
export type ManagerApproval = z.output<typeof approval>;
