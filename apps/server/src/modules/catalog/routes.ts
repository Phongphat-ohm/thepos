import {
  catalogQuery,
  importInput,
  nameInput,
  productInput,
  productQuery,
  supplierInput,
  supplierQuery,
  supplierStatusInput,
} from "@thepos/contracts";
import type { Hono } from "hono";
import { body, uuid, validate, type RouteContext } from "../../core/http";
import type { createCatalogImport } from "./import.service";
import type { createCatalog } from "./service";

export function registerCatalogRoutes(
  app: Hono,
  deps: {
    ctx: RouteContext;
    catalog: ReturnType<typeof createCatalog>;
    importer: ReturnType<typeof createCatalogImport>;
  },
) {
  const { ctx, catalog, importer } = deps;

  app.get("/catalog/products", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "catalog:read");
    return c.json(await catalog.products(storeId, validate(c.req.query(), productQuery)));
  });

  app.get("/catalog/products/:id", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "catalog:read");
    return c.json(await catalog.product(storeId, validate(c.req.param("id"), uuid)));
  });

  app.post("/catalog/products", async (c) => {
    const actor = await ctx.authorize(c.req, "catalog:write");
    return c.json(await catalog.save(actor, await body(c.req, productInput)), 201);
  });

  app.put("/catalog/products/:id", async (c) => {
    const actor = await ctx.authorize(c.req, "catalog:write");
    const id = validate(c.req.param("id"), uuid);
    return c.json(await catalog.save(actor, await body(c.req, productInput), id));
  });

  app.post("/catalog/import/preview", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "catalog:write");
    return c.json(await importer.preview(storeId, await body(c.req, importInput)));
  });

  app.post("/catalog/import/commit", async (c) => {
    const actor = await ctx.authorize(c.req, "catalog:write");
    const key = validate(c.req.header("idempotency-key"), uuid);
    return c.json(await importer.commit(actor, key, await body(c.req, importInput)), 201);
  });

  app.get("/catalog/categories", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "catalog:read");
    return c.json(await catalog.categories(storeId, validate(c.req.query(), catalogQuery)));
  });

  app.post("/catalog/categories", async (c) => {
    const actor = await ctx.authorize(c.req, "catalog:write");
    const { name } = await body(c.req, nameInput);
    return c.json(await catalog.createCategory(actor, name), 201);
  });

  app.get("/catalog/suppliers", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "catalog:read");
    return c.json(await catalog.suppliers(storeId, validate(c.req.query(), supplierQuery)));
  });

  app.post("/catalog/suppliers", async (c) => {
    const actor = await ctx.authorize(c.req, "catalog:write");
    return c.json(await catalog.saveSupplier(actor, await body(c.req, supplierInput)), 201);
  });

  app.put("/catalog/suppliers/:id", async (c) => {
    const actor = await ctx.authorize(c.req, "catalog:write");
    const id = validate(c.req.param("id"), uuid);
    return c.json(await catalog.saveSupplier(actor, await body(c.req, supplierInput), id));
  });

  app.patch("/catalog/suppliers/:id/status", async (c) => {
    const actor = await ctx.authorize(c.req, "catalog:write");
    const id = validate(c.req.param("id"), uuid);
    const { isActive } = await body(c.req, supplierStatusInput);
    return c.json(await catalog.setSupplierStatus(actor, id, isActive));
  });
}
