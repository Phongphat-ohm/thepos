import { catalogQuery, shiftCloseInput, shiftMovementInput, shiftOpenInput } from "@thepos/contracts";
import type { Hono } from "hono";
import type { HonoRequest } from "hono/request";
import { body, uuid, validate, type RouteContext } from "../../core/http";
import type { createShifts } from "./service";

export function registerShiftRoutes(
  app: Hono,
  deps: { ctx: RouteContext; shifts: ReturnType<typeof createShifts> },
) {
  const { ctx, shifts } = deps;

  async function shiftReader(req: HonoRequest) {
    const { actor, capabilities } = await ctx.authorizeAny(req, ["shift:review", "shift:operate"]);
    return { actor, review: capabilities.includes("shift:review") };
  }

  app.get("/shifts", async (c) => {
    const { actor, review } = await shiftReader(c.req);
    return c.json(await shifts.list(actor, review, validate(c.req.query(), catalogQuery)));
  });

  app.get("/shifts/:id", async (c) => {
    const { actor, review } = await shiftReader(c.req);
    return c.json(
      await shifts.read(actor, validate(c.req.param("id"), uuid), review, validate(c.req.query(), catalogQuery)),
    );
  });

  app.post("/shifts", async (c) => {
    const actor = await ctx.authorize(c.req, "shift:operate");
    const key = validate(c.req.header("idempotency-key"), uuid).toLowerCase();
    const { openingFloat } = await body(c.req, shiftOpenInput);
    return c.json(await shifts.open(actor, key, openingFloat), 201);
  });

  app.post("/shifts/:id/movements", async (c) => {
    const actor = await ctx.authorize(c.req, "shift:operate");
    const key = validate(c.req.header("idempotency-key"), uuid).toLowerCase();
    return c.json(
      await shifts.move(actor, validate(c.req.param("id"), uuid), key, await body(c.req, shiftMovementInput)),
      201,
    );
  });

  app.post("/shifts/:id/close", async (c) => {
    const { actor, review } = await shiftReader(c.req);
    return c.json(
      await shifts.close(actor, validate(c.req.param("id"), uuid), await body(c.req, shiftCloseInput), review),
    );
  });
}
