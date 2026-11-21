import {
  catalogQuery,
  checkoutInput,
  heldInput,
  memberInput,
  posLookupInput,
  resumeInput,
  returnInput,
  returnQuoteInput,
} from "@thepos/contracts";
import type { Hono } from "hono";
import { z } from "zod";
import { body, uuid, validate, type RouteContext } from "../../core/http";
import type { createCatalog } from "../catalog/service";
import type { createMembers } from "../members/service";
import type { createPOSDrafts } from "./drafts.service";
import type { createReturns } from "./returns.service";
import type { createSales } from "./sales.service";

export function registerSalesRoutes(
  app: Hono,
  deps: {
    ctx: RouteContext;
    catalog: ReturnType<typeof createCatalog>;
    members: ReturnType<typeof createMembers>;
    sales: ReturnType<typeof createSales>;
    drafts: ReturnType<typeof createPOSDrafts>;
    returns: ReturnType<typeof createReturns>;
  },
) {
  const { ctx, catalog, members, sales, drafts, returns } = deps;

  app.get("/sales/categories", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "sales:read");
    return c.json(await catalog.categories(storeId, validate(c.req.query(), catalogQuery)));
  });

  app.get("/sales/products", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "sales:read");
    return c.json(await sales.lookup(storeId, validate(c.req.query(), posLookupInput)));
  });

  app.get("/sales/members", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "sales:read");
    return c.json(await drafts.members(storeId, validate(c.req.query("q") ?? "", z.string().trim().max(100))));
  });

  app.post("/sales/members", async (c) => {
    const actor = await ctx.authorize(c.req, "member:write");
    const { id, number, name } = await members.save(actor, { ...(await body(c.req, memberInput)), isActive: true });
    return c.json({ id, number, name }, 201);
  });

  app.get("/sales/held", async (c) => {
    const actor = await ctx.authorize(c.req, "sales:checkout");
    return c.json(await drafts.list(actor, validate(c.req.query(), catalogQuery)));
  });

  app.put("/sales/held/:id", async (c) => {
    const actor = await ctx.authorize(c.req, "sales:checkout");
    return c.json(await drafts.hold(actor, validate(c.req.param("id"), uuid), await body(c.req, heldInput)));
  });

  app.post("/sales/held/:id/resume", async (c) => {
    const actor = await ctx.authorize(c.req, "sales:checkout");
    const { revision } = await body(c.req, resumeInput);
    return c.json(await drafts.resume(actor, validate(c.req.param("id"), uuid), revision));
  });

  app.get("/sales", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "sales:read");
    return c.json(await sales.history(storeId, validate(c.req.query(), catalogQuery)));
  });

  app.get("/sales/:id", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "sales:read");
    return c.json(await sales.detail(storeId, validate(c.req.param("id"), uuid)));
  });

  app.post("/sales/:id/returns/quote", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "sales:return");
    return c.json(await returns.quote(storeId, validate(c.req.param("id"), uuid), await body(c.req, returnQuoteInput)));
  });

  app.post("/sales/:id/returns", async (c) => {
    const actor = await ctx.authorize(c.req, "sales:return");
    const key = validate(c.req.header("idempotency-key"), uuid);
    const { result, replayed } = await returns.record(
      actor,
      validate(c.req.param("id"), uuid),
      key,
      await body(c.req, returnInput),
    );
    return c.json(result, replayed ? 200 : 201);
  });

  app.post("/sales", async (c) => {
    const actor = await ctx.authorize(c.req, "sales:checkout");
    const key = validate(c.req.header("idempotency-key"), uuid);
    const { sale, replayed } = await sales.checkout(actor, key, await body(c.req, checkoutInput));
    c.header("Idempotency-Replayed", replayed ? "true" : "false");
    return c.json(sale, replayed ? 200 : 201);
  });
}
