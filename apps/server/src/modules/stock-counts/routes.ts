import { stockCountInput, stockCountQuery, stockDecisionInput } from "@thepos/contracts";
import type { Hono } from "hono";
import { body, uuid, validate, type RouteContext } from "../../core/http";
import type { createStockCounts } from "./service";

export function registerStockCountRoutes(
  app: Hono,
  deps: { ctx: RouteContext; counts: ReturnType<typeof createStockCounts> },
) {
  const { ctx, counts } = deps;

  app.get("/inventory/counts", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "inventory:read");
    return c.json(await counts.list(storeId, validate(c.req.query(), stockCountQuery)));
  });

  app.post("/inventory/counts", async (c) => {
    const actor = await ctx.authorize(c.req, "inventory:count");
    const key = validate(c.req.header("idempotency-key"), uuid);
    return c.json(await counts.submit(actor, key, await body(c.req, stockCountInput)), 201);
  });

  app.post("/inventory/counts/:id/review", async (c) => {
    const actor = await ctx.authorize(c.req, "inventory:approve");
    const id = validate(c.req.param("id"), uuid);
    return c.json(await counts.review(actor, id, await body(c.req, stockDecisionInput)));
  });
}
