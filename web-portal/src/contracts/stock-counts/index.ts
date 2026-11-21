import { z } from "zod";
import { catalogQuery } from "../shared/pagination";
import { countedQuantitySchema, uuidSchema } from "../shared/primitives";

export const stockCountQuery = catalogQuery.extend({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "all"]).default("all"),
});

export const stockCountInput = z
  .strictObject({
    reason: z.string().trim().min(1).max(400),
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

export const stockDecisionInput = z.strictObject({ decision: z.enum(["APPROVED", "REJECTED"]) });

export type StockCountInput = z.output<typeof stockCountInput>;
export type StockDecisionInput = z.output<typeof stockDecisionInput>;
