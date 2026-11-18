import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { importColumns, productInput, type ImportInput, type ImportPreview, type ProductInput } from "@thepos/contracts";
import { ApiError } from "../errors";
import { digest } from "../security";
import { translateDuplicate, type StoreActor } from "./catalog";

const parts = (value: string) => value.split("|").map((part) => part.trim()).filter(Boolean);
const flag = (value: string, fallback: boolean) => {
  const normalized = value.toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return value;
};

async function inspect(db: Prisma.TransactionClient, storeId: string, input: ImportInput) {
  const rows = input.rows.map(({ row, cells }) => {
    const [sku, name, category, baseUnit, costPrice, regularPrice, memberPrice, codes, conversions, track, expiry] =
      cells.map((cell) => cell.trim());
    return {
      row, category, sku: sku.toUpperCase(), name, baseUnit, costPrice, regularPrice, memberPrice,
      barcodes: parts(codes),
      units: parts(conversions).map((value) => {
        const [name, multiplier, ...extra] = value.split("=").map((part) => part.trim());
        return { name, multiplier: extra.length ? undefined : multiplier };
      }),
      trackStock: flag(track, true), trackExpiration: flag(expiry, false),
    };
  });
  const skus = new Map<string, number>();
  const barcodes = new Map<string, number>();
  for (const row of rows) {
    skus.set(row.sku, (skus.get(row.sku) ?? 0) + 1);
    for (const code of row.barcodes) barcodes.set(code, (barcodes.get(code) ?? 0) + 1);
  }
  const [categories, products, codes] = await Promise.all([
    db.category.findMany({ where: { storeId, name: { in: rows.map(({ category }) => category) } }, select: { id: true, name: true } }),
    db.product.findMany({ where: { storeId, sku: { in: [...skus.keys()] } }, select: { sku: true } }),
    db.productBarcode.findMany({ where: { code: { in: [...barcodes.keys()] } }, select: { code: true } }),
  ]);
  const categoryIds = new Map(categories.map(({ id, name }) => [name, id]));
  const existingSkus = new Set(products.map(({ sku }) => sku));
  const existingCodes = new Set(codes.map(({ code }) => code));
  const validated: ProductInput[] = [];
  const previews: ImportPreview["rows"] = rows.map(({ row, category, ...product }) => {
    const categoryId = categoryIds.get(category);
    const parsed = productInput.safeParse({ ...product, categoryId });
    const issues: string[] = [];
    if (!categoryId) issues.push("category");
    if (!parsed.success) {
      for (const { path } of parsed.error.issues) {
        const field = String(path[0]);
        if (importColumns.some((column) => column === field)) issues.push(field);
      }
    }
    if (existingSkus.has(product.sku) || (skus.get(product.sku) ?? 0) > 1) issues.push("duplicateSku");
    if (product.barcodes.some((code) => existingCodes.has(code) || (barcodes.get(code) ?? 0) > 1)) issues.push("duplicateBarcode");
    if (parsed.success && !issues.length) validated.push(parsed.data);
    return { row, sku: product.sku, name: product.name, issues: [...new Set(issues)] };
  });
  return { preview: { rows: previews, valid: validated.length === rows.length }, validated };
}

export function createCatalogImport(db: PrismaClient) {
  return {
    async preview(storeId: string, input: ImportInput) {
      return (await inspect(db, storeId, input)).preview;
    },
    async commit(actor: StoreActor, key: string, input: ImportInput) {
      const payloadHash = digest(JSON.stringify(input));
      const where = { storeId_idempotencyKey: { storeId: actor.storeId, idempotencyKey: key } };
      const result = (previous: { payloadHash: string; createdCount: number }) => {
        if (previous.payloadHash !== payloadHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT");
        return { createdCount: previous.createdCount };
      };
      try {
        return await db.$transaction(async (tx) => {
          const previous = await tx.catalogImport.findUnique({ where });
          if (previous) return result(previous);
          const { preview, validated } = await inspect(tx, actor.storeId, input);
          if (!preview.valid) {
            const raced = await tx.catalogImport.findUnique({ where });
            if (raced) return result(raced);
            throw new ApiError(409, "INVALID_INPUT");
          }
          await tx.catalogImport.create({
            data: { ...where.storeId_idempotencyKey, payloadHash, createdCount: validated.length },
          });
          const items = validated
            .sort((left, right) => left.sku.localeCompare(right.sku))
            .map((product) => ({ id: randomUUID(), product }));
          await tx.product.createMany({
            data: items.map(({ id, product: { barcodes: _barcodes, units: _units, ...fields } }) => ({
              id,
              storeId: actor.storeId,
              ...fields,
            })),
          });
          const barcodes = items.flatMap(({ id, product }) =>
            product.barcodes.map((code) => ({ productId: id, code })),
          );
          if (barcodes.length) await tx.productBarcode.createMany({ data: barcodes });
          const units = items.flatMap(({ id, product }) =>
            product.units.map((unit) => ({ productId: id, ...unit })),
          );
          if (units.length) await tx.productUnitConversion.createMany({ data: units });
          await tx.auditLog.createMany({
            data: items.map(({ id }) => ({ ...actor, event: "PRODUCT_IMPORTED", reason: id })),
          });
          return { createdCount: validated.length };
        }, { timeout: 15_000 });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const previous = await db.catalogImport.findUnique({ where });
          if (previous) return result(previous);
        }
        return translateDuplicate(error);
      }
    },
  };
}
