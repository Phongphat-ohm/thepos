import { z } from "zod";
import { catalogQuery } from "../shared/pagination";
import {
  countedQuantitySchema,
  optionalText,
  positiveQuantitySchema,
  unitNameSchema,
  uuidSchema,
} from "../shared/primitives";

export const countSessionStatusSchema = z.enum(["OPEN", "PAUSED", "SUBMITTED", "CANCELLED"]);
export type CountSessionStatus = z.infer<typeof countSessionStatusSchema>;

export const countSessionCreateInput = z.strictObject({
  title: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(400),
  showExpectedQty: z.boolean().default(false),
});
export type CountSessionCreateInput = z.output<typeof countSessionCreateInput>;

export const countSessionStatusInput = z.strictObject({
  status: z.enum(["OPEN", "PAUSED", "CANCELLED"]),
});
export type CountSessionStatusInput = z.output<typeof countSessionStatusInput>;

export const countSessionQuery = catalogQuery.extend({
  status: z.enum(["OPEN", "PAUSED", "SUBMITTED", "CANCELLED", "all"]).default("all"),
});
export type CountSessionQuery = z.output<typeof countSessionQuery>;

export const countSessionEntryCreateInput = z.strictObject({
  lotId: uuidSchema,
  unit: unitNameSchema,
  quantity: positiveQuantitySchema,
  note: optionalText(200),
});
export type CountSessionEntryCreateInput = z.output<typeof countSessionEntryCreateInput>;

export const countSessionEntryUpdateInput = z.strictObject({
  unit: unitNameSchema.optional(),
  quantity: positiveQuantitySchema,
  note: optionalText(200),
});
export type CountSessionEntryUpdateInput = z.output<typeof countSessionEntryUpdateInput>;

export const countSessionFinalizeInput = z
  .strictObject({
    reason: z.string().trim().min(1).max(400).optional(),
    lines: z
      .array(
        z.strictObject({
          lotId: uuidSchema,
          expected: countedQuantitySchema,
          counted: countedQuantitySchema,
        }),
      )
      .min(1)
      .max(1000),
  })
  .refine(({ lines }) => new Set(lines.map(({ lotId }) => lotId)).size === lines.length);
export type CountSessionFinalizeInput = z.output<typeof countSessionFinalizeInput>;

export const mobileJoinInput = z.strictObject({
  code: z
    .string()
    .trim()
    .min(4)
    .max(16)
    .transform((value) => value.toUpperCase().replace(/[^A-Z0-9]/g, "")),
  displayName: z.string().trim().min(1).max(80),
});
export type MobileJoinInput = z.output<typeof mobileJoinInput>;

export const mobileLookupQuery = z.object({
  q: z.string().trim().min(1).max(255),
});
export type MobileLookupQuery = z.output<typeof mobileLookupQuery>;
