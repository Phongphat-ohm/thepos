import { Prisma, type PrismaClient } from "@prisma/client";
import { apiPrefix } from "@thepos/contracts";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { ApiError } from "./core/errors";
import { createRouteContext, defaultTrustedProxies } from "./core/http";
import type { ServerSecurity } from "./core/server-security";
import { registerAuthRoutes } from "./modules/auth/routes";
import { createAuth, registeredDevice } from "./modules/auth/service";
import { createCatalogImport } from "./modules/catalog/import.service";
import { registerCatalogRoutes } from "./modules/catalog/routes";
import { createCatalog } from "./modules/catalog/service";
import { createPayouts } from "./modules/dividends/payouts.service";
import { registerDividendRoutes } from "./modules/dividends/routes";
import { createDividends } from "./modules/dividends/service";
import { registerInventoryRoutes } from "./modules/inventory/routes";
import { createInventory } from "./modules/inventory/service";
import { registerMemberRoutes } from "./modules/members/routes";
import { createMembers } from "./modules/members/service";
import { registerReportRoutes } from "./modules/reports/routes";
import { createReports } from "./modules/reports/service";
import { createPOSDrafts } from "./modules/sales/drafts.service";
import { createReturns } from "./modules/sales/returns.service";
import { registerSalesRoutes } from "./modules/sales/routes";
import { createSales } from "./modules/sales/sales.service";
import { registerSettingsRoutes } from "./modules/settings/routes";
import { createSettings } from "./modules/settings/service";
import { registerSetupRoutes } from "./modules/setup/routes";
import { createSetup } from "./modules/setup/service";
import { registerShiftRoutes } from "./modules/shifts/routes";
import { createShifts } from "./modules/shifts/service";

type Options = {
  cashVarianceLimit?: string;
  jwtSecret: string;
  bootstrapSecret?: string;
  memberEncryptionKey?: string;
  now?: () => number;
  trustedProxies?: readonly string[];
  clientIp?: (request: Request) => string | undefined;
  corsOrigins?: readonly string[];
  serverSecurity?: ServerSecurity;
  getNetworkUrls?: () => unknown;
};

export function normalizeCorsOrigins(origins: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const raw of origins) {
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (!trimmed) continue;
    if (trimmed === "*") {
      normalized.push("*");
      continue;
    }
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        normalized.push(parsed.origin);
      }
    } catch {
      // Ignore malformed CORS origin entries.
    }
  }
  return [...new Set(normalized)];
}

export function createApp(
  db: PrismaClient,
  {
    jwtSecret,
    bootstrapSecret,
    memberEncryptionKey,
    cashVarianceLimit = "0.00",
    now = Date.now,
    trustedProxies = defaultTrustedProxies,
    clientIp,
    corsOrigins,
    serverSecurity,
  }: Options,
) {
  const app = new Hono().basePath(apiPrefix);

  const auth = createAuth(db, { jwtSecret, now });
  const setup = createSetup(db, bootstrapSecret, now);
  const catalog = createCatalog(db);
  const importer = createCatalogImport(db);
  const settings = createSettings(db, now);
  const inventory = createInventory(db, now);
  const sales = createSales(db, now);
  const drafts = createPOSDrafts(db);
  const returns = createReturns(db, now);
  const members = createMembers(db, now, memberEncryptionKey);
  const dividends = createDividends(db, now);
  const payouts = createPayouts(db, now);
  const shifts = createShifts(db, now, cashVarianceLimit);
  const reports = createReports(db, now);

  const ctx = createRouteContext({
    db,
    auth,
    registeredDevice,
    now,
    trustedProxies,
    clientIp,
  });

  const normalizedCorsOrigins = corsOrigins?.length ? normalizeCorsOrigins(corsOrigins) : [];
  if (normalizedCorsOrigins.length) {
    const allowWildcard = normalizedCorsOrigins.includes("*");
    app.use(
      "*",
      cors({
        origin: allowWildcard ? "*" : normalizedCorsOrigins,
        credentials: !allowWildcard,
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowHeaders: [
          "Content-Type",
          "Authorization",
          "X-Device-Token",
          "X-Refresh-Token",
          "Idempotency-Key",
          "X-Server-Token",
          "X-Web-Auth",
        ],
        exposeHeaders: ["Idempotency-Replayed"],
      }),
    );
  }

  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    if (serverSecurity && c.req.method !== "OPTIONS") {
      const p = c.req.path;
      if (p !== `${apiPrefix}/health` && p !== `${apiPrefix}/setup/verify-connection`) {
        const token = c.req.header("x-server-token");
        if (!serverSecurity.verifyServerToken(token)) {
          throw new ApiError(401, "INVALID_SERVER_KEY");
        }
      }
    }
    await next();
  });

  const bodyLimitOptions = { onError: (c: Context) => c.json({ code: "INVALID_INPUT" }, 413) };
  const normalBody = bodyLimit({ ...bodyLimitOptions, maxSize: 32 * 1024 });
  const importBody = bodyLimit({ ...bodyLimitOptions, maxSize: 1024 * 1024 });
  app.use("*", (c, next) => (c.req.path.startsWith(`${apiPrefix}/catalog/import/`) ? importBody : normalBody)(c, next));

  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json({ code: error.code }, error.status);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return c.json({ code: "NOT_FOUND" }, 404);
    }
    console.error("API operation failed", { path: c.req.routePath, kind: error.name });
    return c.json({ code: "UNAVAILABLE" }, 503);
  });
  app.notFound((c) => c.json({ code: "NOT_FOUND" }, 404));

  // Mount each domain system's routes
  registerSetupRoutes(app, { db, ctx, setup, serverSecurity });
  registerAuthRoutes(app, { ctx, auth });
  registerReportRoutes(app, { ctx, reports });
  registerShiftRoutes(app, { ctx, shifts });
  registerSettingsRoutes(app, { ctx, settings });
  registerCatalogRoutes(app, { ctx, catalog, importer });
  registerInventoryRoutes(app, { ctx, inventory });
  registerSalesRoutes(app, { ctx, catalog, members, sales, drafts, returns });
  registerMemberRoutes(app, { ctx, members });
  registerDividendRoutes(app, { ctx, dividends, payouts });

  return app;
}
