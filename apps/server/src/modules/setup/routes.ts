import type { PrismaClient } from "@prisma/client";
import { bootstrapSchema, enrollSchema, roleSchema, verifyAdminSchema, verifyConnectionSchema } from "@thepos/contracts";
import type { Hono } from "hono";
import { ApiError } from "../../core/errors";
import { body, type RouteContext } from "../../core/http";
import type { ServerSecurity } from "../../core/server-security";
import { deviceDigest } from "../auth/service";
import type { createSetup } from "./service";

export function registerSetupRoutes(
  app: Hono,
  deps: {
    db: PrismaClient;
    ctx: RouteContext;
    setup: ReturnType<typeof createSetup>;
    serverSecurity?: ServerSecurity;
  },
) {
  const { db, ctx, setup, serverSecurity } = deps;

  app.get("/health", async (c) => {
    const [, roleCount] = await db.$transaction([
      db.store.count(),
      db.role.count({ where: { code: { in: [...roleSchema.options] } } }),
    ]);
    if (roleCount !== roleSchema.options.length) throw new ApiError(503, "UNAVAILABLE");
    return c.json({ ready: true });
  });

  app.post("/setup/verify-connection", async (c) => {
    ctx.limitCredentials(c.req, "setup");
    const { serverKey } = await body(c.req, verifyConnectionSchema);
    if (!serverSecurity) return c.json({ ok: true, serverToken: "disabled" });
    const serverToken = serverSecurity.verifyConnectKey(serverKey);
    if (!serverToken) throw new ApiError(401, "INVALID_SERVER_KEY");
    return c.json({ ok: true, serverToken });
  });

  app.get("/setup/status", async (c) => {
    ctx.limitCredentials(c.req, "setup");
    return c.json(await setup.status(ctx.rawDevice(c.req)));
  });

  app.get("/setup/devices", async (c) => {
    ctx.limitCredentials(c.req, "setup");
    return c.json(await setup.devices(ctx.rawDevice(c.req)));
  });

  app.post("/setup/verify-admin", async (c) => {
    ctx.limitCredentials(c.req, "setup");
    return c.json(await setup.verifyAdmin(await body(c.req, verifyAdminSchema), ctx.rawDevice(c.req)));
  });

  app.post("/setup/bootstrap", async (c) => {
    ctx.limitCredentials(c.req, "setup");
    await setup.bootstrap(await body(c.req, bootstrapSchema), deviceDigest(ctx.rawDevice(c.req)));
    return c.body(null, 201);
  });

  app.post("/devices/enroll", async (c) => {
    ctx.limitCredentials(c.req, "setup");
    await setup.enroll(await body(c.req, enrollSchema), deviceDigest(ctx.rawDevice(c.req)));
    return c.body(null, 204);
  });
}
