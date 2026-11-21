import { catalogQuery, receiptInput, stockMovementQuery } from "@thepos/contracts";
import type { Hono } from "hono";
import { body, uuid, validate, type RouteContext } from "../../core/http";
import type { createInventory } from "./service";

const stockQuery = catalogQuery.extend({ productId: uuid });

export function registerInventoryRoutes(
  app: Hono,
  deps: { ctx: RouteContext; inventory: ReturnType<typeof createInventory> },
) {
  const { ctx, inventory } = deps;

  app.post("/inventory/receipts", async (c) => {
    const actor = await ctx.authorize(c.req, "inventory:receive");
    const key = validate(c.req.header("idempotency-key"), uuid);
    const result = await inventory.receive(actor, key, await body(c.req, receiptInput));
    return c.json(result, result.replayed ? 200 : 201);
  });

  app.get("/inventory/lots", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "inventory:read");
    return c.json(await inventory.lots(storeId, validate(c.req.query(), stockQuery)));
  });

  app.get("/inventory/movements", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "inventory:read");
    return c.json(await inventory.movements(storeId, validate(c.req.query(), stockMovementQuery)));
  });
}
