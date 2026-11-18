import { z } from "zod";
import { memberInput, saleMoney } from "./sales";
import { catalogQuery } from "./catalog";

const uuid = z.uuid().transform((id) => id.toLowerCase());
export const memberListQuery = catalogQuery.extend({ activeOnly: z.enum(["true"]).optional(), excludeId: uuid.optional() });
export type MemberListQuery = z.output<typeof memberListQuery>;

export const memberProfileInput = memberInput.extend({
  phone: memberInput.shape.phone.nullable(),
  barcode: memberInput.shape.barcode.nullable(),
  address: z.string().trim().min(1).max(400).nullish(),
  nationalId: z.string().trim().regex(/^\d{13}$/).nullish(),
  joinedOn: z.iso.date().nullish(),
  isActive: z.boolean().default(true),
});

const shareFields = {
  quantity: z.int().min(1).max(2_147_483_647),
  effectiveDate: z.iso.date(),
  reason: z.string().trim().min(1).max(300),
};
export const shareInput = z.discriminatedUnion("type", [
  z.strictObject({ ...shareFields, type: z.literal("INITIAL"), unitValue: saleMoney.refine((value) => /[1-9]/.test(value)) }),
  z.strictObject({ ...shareFields, type: z.literal("PURCHASE_ADD") }),
  z.strictObject({ ...shareFields, type: z.literal("WITHDRAWAL") }),
  z.strictObject({ ...shareFields, type: z.literal("TRANSFER"), toMemberId: z.uuid().transform((id) => id.toLowerCase()) }),
  z.strictObject({ ...shareFields, type: z.literal("CORRECTION"), direction: z.enum(["ADD", "REMOVE"]) }),
]);
export type MemberProfileInput = z.output<typeof memberProfileInput>;
export type ShareInput = z.output<typeof shareInput>;

export type MemberProfile = {
  id: string; number: string; name: string; phone: string | null; barcode: string | null;
  address: string | null; hasNationalId: boolean; joinedOn: string | null; isActive: boolean;
};
export type MemberPurchase = {
  id: string; transactionType: string; grossAmount: string; netEligibleAmount: string;
  recordedAt: string; reference: string | null; reason: string | null;
};
export type ShareEntry = {
  id: string; transactionType: ShareInput["type"]; shareQuantity: number; unitValue: string;
  totalAmount: string; effectiveDate: string; recordedAt: string; approvedBy: string;
  reason: string; transferId: string | null;
};
export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
};
export type MemberPurchases = Page<MemberPurchase> & { netTotal: string };
export type MemberShares = Page<ShareEntry> & {
  account: { totalShares: number; shareValue: string; currentBalance: string } | null;
};
