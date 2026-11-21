import {
  auditLogQuery,
  deviceCreateInput,
  deviceListQuery,
  deviceUpdateInput,
  staffCreateInput,
  staffQuery,
  staffUpdateInput,
  storeSettingsInput,
} from "@thepos/contracts";
import type { Hono } from "hono";
import { body, uuid, validate, type RouteContext } from "../../core/http";
import type { createSettings } from "./service";

export function registerSettingsRoutes(
  app: Hono,
  deps: { ctx: RouteContext; settings: ReturnType<typeof createSettings> },
) {
  const { ctx, settings } = deps;

  app.get("/settings/store", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "settings:manage");
    return c.json(await settings.read(storeId));
  });

  app.put("/settings/store", async (c) => {
    const actor = await ctx.authorize(c.req, "settings:manage");
    return c.json(await settings.save(actor, await body(c.req, storeSettingsInput)));
  });

  app.get("/settings/users", async (c) => {
    const actor = await ctx.authorize(c.req, "settings:manage");
    return c.json(await settings.users(actor, validate(c.req.query(), staffQuery)));
  });

  app.post("/settings/users", async (c) => {
    const actor = await ctx.authorize(c.req, "settings:manage");
    return c.json(await settings.createUser(actor, await body(c.req, staffCreateInput)), 201);
  });

  app.put("/settings/users/:id", async (c) => {
    const actor = await ctx.authorize(c.req, "settings:manage");
    const id = validate(c.req.param("id"), uuid).toLowerCase();
    return c.json(await settings.updateUser(actor, id, await body(c.req, staffUpdateInput)));
  });

  app.delete("/settings/users/:id", async (c) => {
    const actor = await ctx.authorize(c.req, "settings:manage");
    const id = validate(c.req.param("id"), uuid).toLowerCase();
    await settings.deleteUser(actor, id);
    return c.body(null, 204);
  });

  app.get("/settings/devices", async (c) => {
    const actor = await ctx.authorize(c.req, "settings:manage");
    return c.json(await settings.devices(actor, validate(c.req.query(), deviceListQuery)));
  });

  app.post("/settings/devices", async (c) => {
    const actor = await ctx.authorize(c.req, "settings:manage");
    return c.json(await settings.createDevice(actor, await body(c.req, deviceCreateInput)), 201);
  });

  app.patch("/settings/devices/:id", async (c) => {
    const actor = await ctx.authorize(c.req, "settings:manage");
    const id = validate(c.req.param("id"), uuid).toLowerCase();
    return c.json(await settings.updateDevice(actor, id, await body(c.req, deviceUpdateInput)));
  });

  app.delete("/settings/devices/:id", async (c) => {
    const actor = await ctx.authorize(c.req, "settings:manage");
    const id = validate(c.req.param("id"), uuid).toLowerCase();
    await settings.deleteDevice(actor, id);
    return c.body(null, 204);
  });

  app.get("/settings/audit-logs", async (c) => {
    const actor = await ctx.authorize(c.req, "settings:manage");
    return c.json(await settings.auditLogs(actor.storeId, validate(c.req.query(), auditLogQuery)));
  });
}
