import { catalogQuery, memberListQuery, memberProfileInput, shareInput } from "@thepos/contracts";
import type { Hono } from "hono";
import { body, uuid, validate, type RouteContext } from "../../core/http";
import type { createMembers } from "./service";

export function registerMemberRoutes(
  app: Hono,
  deps: { ctx: RouteContext; members: ReturnType<typeof createMembers> },
) {
  const { ctx, members } = deps;

  app.get("/members", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "member:read");
    return c.json(await members.list(storeId, validate(c.req.query(), memberListQuery)));
  });

  app.post("/members", async (c) => {
    const actor = await ctx.authorize(c.req, "member:write");
    return c.json(await members.save(actor, await body(c.req, memberProfileInput)), 201);
  });

  app.get("/members/:id", async (c) => {
    const actor = await ctx.authorize(c.req, "member:read");
    return c.json(await members.detail(actor, validate(c.req.param("id"), uuid)));
  });

  app.put("/members/:id", async (c) => {
    const actor = await ctx.authorize(c.req, "member:write");
    return c.json(
      await members.save(actor, await body(c.req, memberProfileInput), validate(c.req.param("id"), uuid).toLowerCase()),
    );
  });

  app.get("/members/:id/purchases", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "member:read");
    return c.json(await members.purchases(storeId, validate(c.req.param("id"), uuid), validate(c.req.query(), catalogQuery)));
  });

  app.get("/members/:id/shares", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "member:read");
    return c.json(await members.shares(storeId, validate(c.req.param("id"), uuid), validate(c.req.query(), catalogQuery)));
  });

  app.post("/members/:id/shares", async (c) => {
    const actor = await ctx.authorize(c.req, "shares:write");
    const id = validate(c.req.param("id"), uuid).toLowerCase();
    const key = validate(c.req.header("idempotency-key"), uuid).toLowerCase();
    const result = await members.postShares(actor, id, key, await body(c.req, shareInput));
    return c.json(result.entry, result.replayed ? 200 : 201);
  });
}
