import { z } from "zod";

const uuid = z.uuid().transform((id) => id.toLowerCase());
const shortName = z.string().trim().min(1).max(120);
const unitName = z.string().trim().min(1).max(50);
const barcode = z.string().trim().min(1).max(100);
const unitCost = z.string().regex(/^\d{1,10}(\.\d{1,4})?$/);
const price = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
const quantity = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/).refine((value) => /[1-9]/.test(value));
export const productUnitInput = z.strictObject({ name: unitName, multiplier: quantity });
export const productUnitLimit = 20;

export const sortDirSchema = z.enum(["asc", "desc"]);
export const nameInput = z.strictObject({ name: shortName });
export const catalogQuery = z.object({
  q: z.string().trim().max(255).default(""),
  after: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  sortBy: z.string().trim().max(64).optional(),
  sortDir: sortDirSchema.optional(),
});
export const productQuery = catalogQuery.extend({
  receivable: z.enum(["true"]).optional(),
  stockTracked: z.enum(["true"]).optional(),
});
export const stockCountQuery = catalogQuery.extend({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "all"]).default("all"),
});
export const stockMovementQuery = catalogQuery.extend({
  productId: uuid,
  kind: z.enum(["RECEIPT", "SALE", "RETURN", "RETURN_DAMAGED", "ADJUSTMENT", "all"]).default("all"),
});

const optionalText = (max: number) => z.string().trim().max(max).nullable().default(null)
  .transform((value) => value || null);
export const supplierInput = z.strictObject({
  name: shortName,
  contactName: optionalText(120),
  phone: optionalText(40),
  email: optionalText(254).pipe(z.email().nullable()),
  address: optionalText(400),
});
export const supplierStatusInput = z.strictObject({ isActive: z.boolean() });
export const supplierQuery = catalogQuery.extend({ status: z.enum(["active", "inactive", "all"]).default("active") });
export type SupplierInput = z.output<typeof supplierInput>;
export type SupplierQuery = z.output<typeof supplierQuery>;
export type Supplier = SupplierInput & { id: string; isActive: boolean };

export const productInput = z.strictObject({
  sku: z.string().trim().toUpperCase().min(1).max(50),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2000).nullable().default(null),
  categoryId: uuid,
  baseUnit: unitName,
  costPrice: unitCost,
  regularPrice: price,
  memberPrice: price,
  isActive: z.boolean().default(true),
  trackStock: z.boolean().default(true),
  trackExpiration: z.boolean().default(false),
  barcodes: z.array(barcode).max(30).default([]),
  units: z.array(productUnitInput).max(productUnitLimit).default([]),
}).superRefine((product, ctx) => {
  const distinct = (values: string[]) => new Set(values).size === values.length;
  if (!distinct(product.barcodes)) ctx.addIssue({ code: "custom", path: ["barcodes"], message: "Duplicate barcode." });
  if (!distinct([product.baseUnit, ...product.units.map(({ name }) => name)])) {
    ctx.addIssue({ code: "custom", path: ["units"], message: "Duplicate unit." });
  }
  if (!product.trackStock && product.trackExpiration) {
    ctx.addIssue({ code: "custom", path: ["trackExpiration"], message: "Stock tracking is required." });
  }
});

export const receiptInput = z.strictObject({
  supplierId: uuid,
  lines: z.array(z.strictObject({
    productId: uuid,
    unit: unitName,
    quantity,
    lotNumber: z.string().trim().min(1).max(100),
    expirationDate: z.iso.date().nullable().default(null),
    unitCostPerBaseUnit: unitCost,
  })).min(1).max(50),
});

export type ProductInput = z.output<typeof productInput>;
export type CatalogQuery = z.output<typeof catalogQuery>;
export type ProductQuery = z.output<typeof productQuery>;
export type ReceiptInput = z.output<typeof receiptInput>;

export const importColumns = [
  "sku", "name", "category", "baseUnit", "costPrice", "regularPrice", "memberPrice",
  "barcodes", "units", "trackStock", "trackExpiration",
] as const;
export const importRowLimit = 200;
export const importInput = z.strictObject({
  rows: z.array(z.strictObject({
    row: z.int().min(2),
    cells: z.array(z.string().max(4000)).length(importColumns.length),
  })).min(1).max(importRowLimit),
});
export type ImportInput = z.output<typeof importInput>;
export type ImportPreview = {
  rows: { row: number; sku: string; name: string; issues: string[] }[];
  valid: boolean;
};

const countedQuantity = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/);
export const stockCountInput = z.strictObject({
  reason: z.string().trim().min(1).max(400),
  lines: z.array(z.strictObject({
    lotId: uuid, expected: countedQuantity, counted: countedQuantity,
  })).min(1).max(50),
}).refine(({ lines }) => new Set(lines.map(({ lotId }) => lotId)).size === lines.length);
export const stockDecisionInput = z.strictObject({ decision: z.enum(["APPROVED", "REJECTED"]) });
export type StockCountInput = z.output<typeof stockCountInput>;
export type StockDecisionInput = z.output<typeof stockDecisionInput>;
