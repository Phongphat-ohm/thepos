import { Prisma, type PrismaClient } from "@prisma/client";
import type { CatalogQuery, ProductInput, ProductQuery, Supplier, SupplierInput, SupplierQuery } from "@thepos/contracts";
import { audit, translateDuplicate, type StoreActor } from "../../core/audit";
import { ApiError } from "../../core/errors";
import { pageMeta, resolveOrder } from "../../core/pagination";

export { translateDuplicate, type StoreActor };
const relations = {
  category: { select: { name: true } },
  barcodes: { orderBy: { code: "asc" } },
  units: { orderBy: { name: "asc" } },
} satisfies Prisma.ProductInclude;
type Product = Prisma.ProductGetPayload<{ include: typeof relations }>;
const supplierFields = { id: true, name: true, contactName: true, phone: true, email: true, address: true, isActive: true } as const;

function dto(product: Product) {
  return {
    id: product.id, sku: product.sku, name: product.name, description: product.description,
    categoryId: product.categoryId, categoryName: product.category.name, baseUnit: product.baseUnit,
    costPrice: product.costPrice.toFixed(4), regularPrice: product.regularPrice.toFixed(2),
    memberPrice: product.memberPrice.toFixed(2), isActive: product.isActive,
    trackStock: product.trackStock, trackExpiration: product.trackExpiration,
    barcodes: product.barcodes.map(({ code }) => code),
    units: product.units.map(({ name, multiplier }) => ({ name, multiplier: multiplier.toFixed(3) })),
  };
}

function page<T extends { id: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
}

export async function lockProducts(tx: Prisma.TransactionClient, storeId: string, ids: string[]) {
  const selection = Prisma.join(ids.map((id) => Prisma.sql`CAST(${id} AS uuid)`));
  const selected = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM products WHERE store_id = CAST(${storeId} AS uuid) AND id IN (${selection})
    ORDER BY id FOR UPDATE
  `;
  if (selected.length !== ids.length) throw new ApiError(400, "INVALID_REFERENCE");
}

export function productData({ barcodes, units, ...fields }: ProductInput) {
  return { ...fields, barcodes: { create: barcodes.map((code) => ({ code })) }, units: { create: units } };
}

export function createCatalog(db: PrismaClient) {
  const paging = ({ after, limit }: CatalogQuery) =>
    ({ take: limit + 1, ...(after && { cursor: { id: after }, skip: 1 }) });

  async function save(actor: StoreActor, input: ProductInput, id?: string) {
    return db.$transaction(async (tx) => {
      const category = await tx.category.findFirst({
        where: { id: input.categoryId, storeId: actor.storeId }, select: { id: true },
      });
      if (!category) throw new ApiError(400, "INVALID_REFERENCE");
      if (id) {
        await lockProducts(tx, actor.storeId, [id]);
        const previous = await tx.product.findUniqueOrThrow({ where: { id } });
        const changesStockDefinition = previous.baseUnit !== input.baseUnit
          || previous.trackExpiration !== input.trackExpiration || previous.trackStock !== input.trackStock;
        if (changesStockDefinition && (
          await tx.stockLot.findFirst({ where: { productId: id }, select: { id: true } }) ||
          await tx.saleItem.findFirst({ where: { productId: id }, select: { id: true } })
        )) {
          throw new ApiError(409, "STOCK_CONFIGURATION_LOCKED");
        }
        await tx.productBarcode.deleteMany({ where: { productId: id } });
        await tx.productUnitConversion.deleteMany({ where: { productId: id } });
      }
      const data = productData(input);
      const product = id
        ? await tx.product.update({ where: { id }, data, include: relations })
        : await tx.product.create({ data: { ...data, storeId: actor.storeId }, include: relations });
      await audit(tx, actor, id ? "PRODUCT_UPDATED" : "PRODUCT_CREATED", product.id);
      return dto(product);
    }, { timeout: 15_000 }).catch(translateDuplicate);
  }

  return {
    async products(storeId: string, query: ProductQuery) {
      const { q, limit, page: pageNum, sortBy, sortDir } = query;
      const where: Prisma.ProductWhereInput = {
        storeId,
        ...(query.stockTracked && { trackStock: true }),
        ...(query.receivable && { isActive: true, trackStock: true }),
        ...(q && { OR: [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { contains: q.toUpperCase() } },
          { barcodes: { some: { code: q } } },
        ] }),
      };
      const orderBy = resolveOrder<Prisma.ProductOrderByWithRelationInput>(
        {
          sku: (dir) => [{ sku: dir }, { id: "asc" }],
          name: (dir) => [{ name: dir }, { id: "asc" }],
          regularPrice: (dir) => [{ regularPrice: dir }, { sku: "asc" }, { id: "asc" }],
          memberPrice: (dir) => [{ memberPrice: dir }, { sku: "asc" }, { id: "asc" }],
          costPrice: (dir) => [{ costPrice: dir }, { sku: "asc" }, { id: "asc" }],
          isActive: (dir) => [{ isActive: dir }, { sku: "asc" }, { id: "asc" }],
        },
        [{ sku: "asc" }, { id: "asc" }],
        sortBy,
        sortDir,
      );
      if (pageNum) {
        const [rows, total] = await Promise.all([
          db.product.findMany({ where, include: relations, orderBy, skip: (pageNum - 1) * limit, take: limit }),
          db.product.count({ where }),
        ]);
        return { items: rows.map(dto), ...pageMeta(total, pageNum, limit) };
      }
      const rows = await db.product.findMany({
        where, include: relations, orderBy, ...paging(query),
      });
      return page(rows.map(dto), limit);
    },
    async product(storeId: string, id: string) {
      const product = await db.product.findFirst({ where: { id, storeId }, include: relations });
      if (!product) throw new ApiError(404, "NOT_FOUND");
      return dto(product);
    },
    save,
    async categories(storeId: string, query: CatalogQuery) {
      const rows = await db.category.findMany({
        where: { storeId, name: { contains: query.q, mode: "insensitive" } },
        select: { id: true, name: true },
        orderBy: { name: "asc" }, ...paging(query),
      });
      return page(rows, query.limit);
    },
    async createCategory(actor: StoreActor, name: string) {
      return db.$transaction(async (tx) => {
        const result = await tx.category.create({ data: { storeId: actor.storeId, name }, select: { id: true, name: true } });
        await audit(tx, actor, "CATEGORY_CREATED", result.id);
        return result;
      }).catch(translateDuplicate);
    },
    async suppliers(storeId: string, query: SupplierQuery) {
      const { q, status, limit, page: pageNum, sortBy, sortDir } = query;
      const where: Prisma.SupplierWhereInput = {
        storeId, ...(status !== "all" && { isActive: status === "active" }),
        ...(q && { OR: [
          { name: { contains: q, mode: "insensitive" } },
          { contactName: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
          { email: { contains: q, mode: "insensitive" } },
        ] }),
      };
      const orderBy = resolveOrder<Prisma.SupplierOrderByWithRelationInput>(
        {
          name: (dir) => [{ name: dir }, { id: "asc" }],
          contactName: (dir) => [{ contactName: dir }, { name: "asc" }],
          isActive: (dir) => [{ isActive: dir }, { name: "asc" }],
        },
        [{ name: "asc" }, { id: "asc" }],
        sortBy,
        sortDir,
      );
      if (pageNum) {
        const [rows, total] = await Promise.all([
          db.supplier.findMany({ where, select: supplierFields, orderBy, skip: (pageNum - 1) * limit, take: limit }),
          db.supplier.count({ where }),
        ]);
        return { items: rows, ...pageMeta(total, pageNum, limit) };
      }
      const rows = await db.supplier.findMany({
        where, select: supplierFields, orderBy, ...paging(query),
      });
      return page(rows, limit);
    },
    async saveSupplier(actor: StoreActor, input: SupplierInput, id?: string): Promise<Supplier> {
      return db.$transaction(async (tx) => {
        const result = id
          ? await tx.supplier.update({ where: { id, storeId: actor.storeId }, data: input, select: supplierFields })
          : await tx.supplier.create({ data: { ...input, storeId: actor.storeId }, select: supplierFields });
        await audit(tx, actor, id ? "SUPPLIER_UPDATED" : "SUPPLIER_CREATED", result.id);
        return result;
      }).catch(supplierError);
    },
    async setSupplierStatus(actor: StoreActor, id: string, isActive: boolean): Promise<Supplier> {
      return db.$transaction(async (tx) => {
        const result = await tx.supplier.update({ where: { id, storeId: actor.storeId }, data: { isActive }, select: supplierFields });
        await audit(tx, actor, isActive ? "SUPPLIER_REACTIVATED" : "SUPPLIER_DEACTIVATED", id);
        return result;
      }).catch(supplierError);
    },
  };
}

function supplierError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    throw new ApiError(404, "NOT_FOUND");
  }
  return translateDuplicate(error);
}
