import {
  countSessionCreateInput,
  countSessionEntryCreateInput,
  countSessionEntryUpdateInput,
  countSessionFinalizeInput,
  countSessionQuery,
  countSessionStatusInput,
  mobileJoinInput,
  mobileLookupQuery,
} from "@thepos/contracts";
import type { Hono } from "hono";
import type { HonoRequest } from "hono/request";
import { z } from "zod";
import { body, uuid, validate, type RouteContext } from "../../core/http";
import type { createMobileStockCounts } from "./service";

export function registerMobileStockCountRoutes(
  app: Hono,
  deps: { ctx: RouteContext; mobileCounts: ReturnType<typeof createMobileStockCounts> },
) {
  const { ctx, mobileCounts } = deps;

  // Desktop: Mobile Stock Count Sessions
  app.get("/inventory/count-sessions", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "inventory:count");
    return c.json(await mobileCounts.listSessions(storeId, validate(c.req.query(), countSessionQuery)));
  });

  app.post("/inventory/count-sessions", async (c) => {
    const actor = await ctx.authorize(c.req, "inventory:count");
    return c.json(await mobileCounts.createSession(actor, await body(c.req, countSessionCreateInput)), 201);
  });

  app.get("/inventory/count-sessions/:id", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "inventory:count");
    return c.json(await mobileCounts.getSessionDetail(storeId, validate(c.req.param("id"), uuid)));
  });

  app.patch("/inventory/count-sessions/:id/status", async (c) => {
    const actor = await ctx.authorize(c.req, "inventory:count");
    const id = validate(c.req.param("id"), uuid);
    return c.json(await mobileCounts.setSessionStatus(actor, id, await body(c.req, countSessionStatusInput)));
  });

  app.post("/inventory/count-sessions/:id/revoke-participant", async (c) => {
    const actor = await ctx.authorize(c.req, "inventory:count");
    const id = validate(c.req.param("id"), uuid);
    const { participantId } = await body(c.req, z.strictObject({ participantId: uuid }));
    return c.json(await mobileCounts.revokeParticipant(actor, id, participantId));
  });

  app.patch("/inventory/count-sessions/:id/entries", async (c) => {
    const actor = await ctx.authorize(c.req, "inventory:count");
    const id = validate(c.req.param("id"), uuid);
    const payload = await body(c.req, countSessionEntryUpdateInput.extend({ entryId: uuid }));
    const { entryId, ...rest } = payload;
    return c.json(await mobileCounts.updateDesktopEntry(actor, id, entryId, rest));
  });

  app.post("/inventory/count-sessions/:id/delete-entry", async (c) => {
    const actor = await ctx.authorize(c.req, "inventory:count");
    const id = validate(c.req.param("id"), uuid);
    const { entryId } = await body(c.req, z.strictObject({ entryId: uuid }));
    return c.json(await mobileCounts.deleteDesktopEntry(actor, id, entryId));
  });

  app.post("/inventory/count-sessions/:id/finalize", async (c) => {
    const actor = await ctx.authorize(c.req, "inventory:count");
    const id = validate(c.req.param("id"), uuid);
    const key = validate(c.req.header("idempotency-key"), uuid);
    return c.json(
      await mobileCounts.finalizeSession(actor, id, key, await body(c.req, countSessionFinalizeInput)),
      201,
    );
  });

  // Mobile Participant Endpoints (No POS login, LAN-only)
  const mobileToken = (req: HonoRequest) => req.header("x-mobile-count-token");

  app.post("/mobile-count/join", async (c) => {
    const ip = ctx.requireLanIp(c.req.raw);
    ctx.limitCredentials(c.req, "auth");
    const input = await body(c.req, mobileJoinInput);
    return c.json(await mobileCounts.joinMobile(input, ip, c.req.header("user-agent")), 201);
  });

  app.get("/mobile-count/state", async (c) => {
    ctx.requireLanIp(c.req.raw);
    return c.json(await mobileCounts.getMobileState(mobileToken(c.req)));
  });

  app.get("/mobile-count/lookup", async (c) => {
    ctx.requireLanIp(c.req.raw);
    const { q } = validate(c.req.query(), mobileLookupQuery);
    return c.json(await mobileCounts.lookupMobileProducts(mobileToken(c.req), q));
  });

  app.post("/mobile-count/entries", async (c) => {
    ctx.requireLanIp(c.req.raw);
    return c.json(
      await mobileCounts.addMobileEntry(mobileToken(c.req), await body(c.req, countSessionEntryCreateInput)),
      201,
    );
  });

  app.patch("/mobile-count/entries/:id", async (c) => {
    ctx.requireLanIp(c.req.raw);
    const entryId = validate(c.req.param("id"), uuid);
    return c.json(
      await mobileCounts.updateMobileEntry(mobileToken(c.req), entryId, await body(c.req, countSessionEntryUpdateInput)),
    );
  });

  app.delete("/mobile-count/entries/:id", async (c) => {
    ctx.requireLanIp(c.req.raw);
    const entryId = validate(c.req.param("id"), uuid);
    return c.json(await mobileCounts.deleteMobileEntry(mobileToken(c.req), entryId));
  });
}
