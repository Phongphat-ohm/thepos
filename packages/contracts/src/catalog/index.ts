import { z } from "zod";
import { catalogQuery } from "../shared/pagination";
import {
  moneySchema,
  optionalText,
  positiveQuantitySchema,
  shortNameSchema,
  unitCostSchema,
  unitNameSchema,
  uuidSchema,
} from "../shared/primitives";

const barcode = z.string().trim().min(1).max(100);

export const productUnitInput = z.strictObject({ name: unitNameSchema, multiplier: positiveQuantitySchema });
export const productUnitLimit = 20;
export const nameInput = z.strictObject({ name: shortNameSchema });

export const productQuery = catalogQuery.extend({
  receivable: z.enum(["true"]).optional(),
  stockTracked: z.enum(["true"]).optional(),
});

export const supplierInput = z.strictObject({
  name: shortNameSchema,
  contactName: optionalText(120),
  phone: optionalText(40),
  email: optionalText(254).pipe(z.email().nullable()),
  address: optionalText(400),
});
export const supplierStatusInput = z.strictObject({ isActive: z.boolean() });
export const supplierQuery = catalogQuery.extend({
  status: z.enum(["active", "inactive", "all"]).default("active"),
});
export type SupplierInput = z.output<typeof supplierInput>;
export type SupplierQuery = z.output<typeof supplierQuery>;
export type Supplier = SupplierInput & { id: string; isActive: boolean };

export const productInput = z
  .strictObject({
    sku: z.string().trim().toUpperCase().min(1).max(50),
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().max(2000).nullable().default(null),
    categoryId: uuidSchema,
    baseUnit: unitNameSchema,
    costPrice: unitCostSchema,
    regularPrice: moneySchema,
    memberPrice: moneySchema,
    isActive: z.boolean().default(true),
    trackStock: z.boolean().default(true),
    trackExpiration: z.boolean().default(false),
    barcodes: z.array(barcode).max(30).default([]),
    units: z.array(productUnitInput).max(productUnitLimit).default([]),
  })
  .superRefine((product, ctx) => {
    const distinct = (values: string[]) => new Set(values).size === values.length;
    if (!distinct(product.barcodes)) {
      ctx.addIssue({ code: "custom", path: ["barcodes"], message: "Duplicate barcode." });
    }
    if (!distinct([product.baseUnit, ...product.units.map(({ name }) => name)])) {
      ctx.addIssue({ code: "custom", path: ["units"], message: "Duplicate unit." });
    }
    if (!product.trackStock && product.trackExpiration) {
      ctx.addIssue({ code: "custom", path: ["trackExpiration"], message: "Stock tracking is required." });
    }
  });

export type ProductInput = z.output<typeof productInput>;
export type ProductQuery = z.output<typeof productQuery>;

export const importColumns = [
  "sku",
  "name",
  "category",
  "baseUnit",
  "costPrice",
  "regularPrice",
  "memberPrice",
  "barcodes",
  "units",
  "trackStock",
  "trackExpiration",
] as const;
export const importRowLimit = 200;

export const importInput = z.strictObject({
  rows: z
    .array(
      z.strictObject({
        row: z.int().min(2),
        cells: z.array(z.string().max(4000)).length(importColumns.length),
      }),
    )
    .min(1)
    .max(importRowLimit),
});
export type ImportInput = z.output<typeof importInput>;
export type ImportPreview = {
  rows: { row: number; sku: string; name: string; issues: string[] }[];
  valid: boolean;
};
