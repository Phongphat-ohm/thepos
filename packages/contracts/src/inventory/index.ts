import { z } from "zod";
import { catalogQuery } from "../shared/pagination";
import { positiveQuantitySchema, unitCostSchema, unitNameSchema, uuidSchema } from "../shared/primitives";

export const stockMovementQuery = catalogQuery.extend({
  productId: uuidSchema,
  kind: z.enum(["RECEIPT", "SALE", "RETURN", "RETURN_DAMAGED", "ADJUSTMENT", "all"]).default("all"),
});

export const receiptInput = z.strictObject({
  supplierId: uuidSchema,
  lines: z
    .array(
      z.strictObject({
        productId: uuidSchema,
        unit: unitNameSchema,
        quantity: positiveQuantitySchema,
        lotNumber: z.string().trim().min(1).max(100),
        expirationDate: z.iso.date().nullable().default(null),
        unitCostPerBaseUnit: unitCostSchema,
      }),
    )
    .min(1)
    .max(50),
});

export type ReceiptInput = z.output<typeof receiptInput>;
