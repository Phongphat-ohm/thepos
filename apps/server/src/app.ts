import { Prisma, type PrismaClient } from "@prisma/client";
import {
  apiPrefix, bootstrapSchema, catalogQuery, changePasswordSchema, enrollSchema, loginSchema, nameInput,
  checkoutInput, heldInput, importInput, memberInput, memberListQuery, memberProfileInput, shareInput, posLookupInput, productInput, productQuery, receiptInput,
  resumeInput, returnInput, returnQuoteInput, roleSchema, stockCountInput, stockDecisionInput,
  unlockSchema, verifyConnectionSchema, type Permission,
  accountingPeriodInput, approveDividendInput, dividendRuleInput, purchaseAdjustmentInput, payoutInput, payoutObligationQuery,
  reportQuery, shiftOpenInput, shiftMovementInput, shiftCloseInput, supplierInput, supplierQuery, supplierStatusInput,
  storeSettingsInput, staffCreateInput, staffUpdateInput, staffQuery, deviceCreateInput, deviceUpdateInput, deviceListQuery,
  auditLogQuery, stockCountQuery, stockMovementQuery, periodListQuery,
} from "@thepos/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import type { HonoRequest } from "hono/request";
import { z } from "zod";
import { ApiError } from "./errors";
import type { ServerSecurity } from "./server-security";
import { createAuth, deviceDigest, registeredDevice } from "./modules/auth";
import { isTrustedProxyIp, sessionMs } from "./security";
import { createCatalog } from "./modules/catalog";
import { createCatalogImport } from "./modules/catalog-import";
import { createInventory } from "./modules/inventory";
import { createSetup } from "./modules/setup";
import { createStockCounts } from "./modules/stock-counts";
import { createSales } from "./modules/sales";
import { createPOSDrafts } from "./modules/pos-drafts";
import { createReturns } from "./modules/returns";
import { createMembers } from "./modules/members";
import { createDividends } from "./modules/dividends";
import { createPayouts } from "./modules/payouts";
import { createShifts } from "./modules/shifts";
import { createReports, reportPermissions } from "./modules/reports";
import { createSettings } from "./modules/settings";

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
};

const defaultTrustedProxies = ["127.0.0.1", "::1", "::ffff:127.0.0.1"] as const;

function validate<S extends z.ZodType>(value: unknown, schema: S): z.output<S> {
  const input = schema.safeParse(value);
  if (!input.success) throw new ApiError(400, "INVALID_INPUT");
  return input.data;
}

async function body<S extends z.ZodType>(request: HonoRequest, schema: S): Promise<z.output<S>> {
  return validate(await request.json().catch(() => null), schema);
}

const uuid = z.uuid().transform((id) => id.toLowerCase());
const stockQuery = catalogQuery.extend({ productId: uuid });

export function createApp(db: PrismaClient, {
  jwtSecret, bootstrapSecret, memberEncryptionKey, cashVarianceLimit = "0.00", now = Date.now,
  trustedProxies = defaultTrustedProxies, clientIp, corsOrigins, serverSecurity,
}: Options) {
  const app = new Hono().basePath(apiPrefix);
  const auth = createAuth(db, { jwtSecret, now });
  const setup = createSetup(db, bootstrapSecret, now);
  const catalog = createCatalog(db);
  const settings = createSettings(db, now);
  const inventory = createInventory(db);
  const importer = createCatalogImport(db);
  const counts = createStockCounts(db);
  const sales = createSales(db, now);
  const drafts = createPOSDrafts(db);
  const returns = createReturns(db, now);
  const members = createMembers(db, now, memberEncryptionKey);
  const dividends = createDividends(db, now);
  const payouts = createPayouts(db, now);
  const shifts = createShifts(db, now, cashVarianceLimit);
  const reports = createReports(db, now);
  const perIp = new Map<string, number>();
  let windowEnd = 0;

  function resolveClientIp(request: Request) {
    const peer = clientIp?.(request);
    if (!peer) return undefined;
    if (!isTrustedProxyIp(peer, trustedProxies)) return peer;
    const forwarded = request.headers.get("x-forwarded-for");
    if (!forwarded) return peer;
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
    for (let index = hops.length - 1; index >= 0; index--) {
      const candidate = hops[index]!;
      if (!isTrustedProxyIp(candidate, trustedProxies)) return candidate;
    }
    return peer;
  }

  function limitCredentials(request: HonoRequest, bucket: "auth" | "setup" = "auth") {
    const ip = resolveClientIp(request.raw);
    if (!ip) return;
    const key = `${bucket}:${ip}`;
    const timestamp = now();
    if (timestamp >= windowEnd) {
      windowEnd = timestamp + 60_000;
      perIp.clear();
    }
    const count = perIp.get(key) ?? 0;
    if (count >= 60) {
      throw new ApiError(429, "RATE_LIMITED");
    }
    if (!perIp.has(key) && perIp.size >= 4096) {
      const oldest = perIp.keys().next().value;
      if (oldest !== undefined) perIp.delete(oldest);
    }
    perIp.delete(key);
    perIp.set(key, count + 1);
  }

  const WEB_REFRESH_COOKIE = "thepos_web_refresh";
  const rawDevice = (req: HonoRequest) => req.header("x-device-token");
  const device = (req: HonoRequest) => registeredDevice(db, rawDevice(req));
  const refresh = (c: import("hono").Context) => {
    const headerToken = c.req.header("x-refresh-token");
    if (headerToken) return { token: headerToken, fromCookie: false };
    const cookieToken = getCookie(c, WEB_REFRESH_COOKIE);
    return { token: cookieToken, fromCookie: Boolean(cookieToken) };
  };
  const access = (req: HonoRequest) => req.header("authorization");
  const authorize = async (req: HonoRequest, permission: Permission) =>
    auth.authorize(access(req), await device(req), permission);
  const authorizeAny = async (req: HonoRequest, permissions: readonly Permission[]) =>
    auth.authorizeAny(access(req), await device(req), permissions);
  const profile = async (req: HonoRequest) => auth.me(access(req), await device(req));
  async function shiftReader(req: HonoRequest) {
    const { actor, capabilities } = await authorizeAny(req, ["shift:review", "shift:operate"]);
    return { actor, review: capabilities.includes("shift:review") };
  }

  function assertCookieSameOrigin(c: import("hono").Context) {
    const fetchSite = c.req.header("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
      throw new ApiError(403, "FORBIDDEN");
    }
    const origin = c.req.header("origin");
    if (origin) {
      try {
        const url = new URL(c.req.url);
        const reqOrigin = url.origin;
        const peer = clientIp?.(c.req.raw);
        const trusted = !!peer && isTrustedProxyIp(peer, trustedProxies);
        const host = trusted ? (c.req.header("x-forwarded-host")?.split(",")[0]?.trim() || c.req.header("host")) : c.req.header("host");
        const proto = trusted
          ? (c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", ""))
          : url.protocol.replace(":", "");
        const expected = host ? `${proto}://${host}` : reqOrigin;
        if (origin !== reqOrigin && origin !== expected) throw new ApiError(403, "FORBIDDEN");
      } catch {
        throw new ApiError(403, "FORBIDDEN");
      }
    }
  }

  function isSecureRequest(request: Request): boolean {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    if (forwardedProto === "https") return true;
    try {
      return new URL(request.url).protocol === "https:";
    } catch {
      return false;
    }
  }

  function setWebRefreshCookie(c: import("hono").Context, refreshToken: string) {
    setCookie(c, WEB_REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: "Strict",
      secure: isSecureRequest(c.req.raw),
      path: `${apiPrefix}/auth`,
      maxAge: Math.floor(sessionMs / 1000),
    });
  }

  function clearWebRefreshCookie(c: import("hono").Context) {
    deleteCookie(c, WEB_REFRESH_COOKIE, {
      path: `${apiPrefix}/auth`,
      secure: isSecureRequest(c.req.raw),
    });
  }

  if (corsOrigins?.length) {
    const allowWildcard = corsOrigins.includes("*");
    app.use("*", cors({
      origin: allowWildcard ? "*" : [...corsOrigins],
      credentials: !allowWildcard,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Device-Token", "X-Refresh-Token", "Idempotency-Key", "X-Server-Token", "X-Web-Auth"],
      exposeHeaders: ["Idempotency-Replayed"],
    }));
  }

  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
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
  const bodyLimitOptions = { onError: (c: import("hono").Context) => c.json({ code: "INVALID_INPUT" }, 413) };
  const normalBody = bodyLimit({ ...bodyLimitOptions, maxSize: 32 * 1024 });
  const importBody = bodyLimit({ ...bodyLimitOptions, maxSize: 1024 * 1024 });
  app.use("*", (c, next) => (
    c.req.path.startsWith(apiPrefix + "/catalog/import/") ? importBody : normalBody
  )(c, next));
  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json({ code: error.code }, error.status);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return c.json({ code: "NOT_FOUND" }, 404);
    }
    console.error("API operation failed", { path: c.req.routePath, kind: error.name });
    return c.json({ code: "UNAVAILABLE" }, 503);
  });
  app.notFound((c) => c.json({ code: "NOT_FOUND" }, 404));

  app.get("/health", async (c) => {
    const [, roleCount] = await db.$transaction([
      db.store.count(),
      db.role.count({ where: { code: { in: [...roleSchema.options] } } }),
    ]);
    if (roleCount !== roleSchema.options.length) throw new ApiError(503, "UNAVAILABLE");
    return c.json({ ready: true });
  });
  app.post("/setup/verify-connection", async (c) => {
    limitCredentials(c.req, "setup");
    const { serverKey } = await body(c.req, verifyConnectionSchema);
    if (!serverSecurity) return c.json({ ok: true, serverToken: "disabled" });
    const serverToken = serverSecurity.verifyConnectKey(serverKey);
    if (!serverToken) throw new ApiError(401, "INVALID_SERVER_KEY");
    return c.json({ ok: true, serverToken });
  });
  app.get("/setup/status", async (c) => {
    limitCredentials(c.req, "setup");
    return c.json(await setup.status(rawDevice(c.req)));
  });
  app.get("/setup/devices", async (c) => {
    limitCredentials(c.req, "setup");
    return c.json(await setup.devices(rawDevice(c.req)));
  });
  app.post("/setup/bootstrap", async (c) => {
    limitCredentials(c.req, "setup");
    await setup.bootstrap(await body(c.req, bootstrapSchema), deviceDigest(rawDevice(c.req)));
    return c.body(null, 201);
  });
  app.post("/devices/enroll", async (c) => {
    limitCredentials(c.req, "setup");
    await setup.enroll(await body(c.req, enrollSchema), deviceDigest(rawDevice(c.req)));
    return c.body(null, 204);
  });
  app.post("/auth/login", async (c) => {
    limitCredentials(c.req);
    return c.json(await auth.login(await device(c.req), await body(c.req, loginSchema)));
  });
  app.post("/auth/web-login", async (c) => {
    limitCredentials(c.req);
    const cookieMode = c.req.header("x-web-auth") === "cookie";
    if (cookieMode) assertCookieSameOrigin(c);
    const session = await auth.webLogin(await body(c.req, loginSchema), rawDevice(c.req));
    setWebRefreshCookie(c, session.refreshToken);
    if (cookieMode) {
      const { refreshToken: _refreshToken, ...safeSession } = session;
      return c.json({ ...safeSession, cookieAuth: true });
    }
    return c.json(session);
  });
  app.post("/auth/refresh", async (c) => {
    const { token, fromCookie } = refresh(c);
    if (fromCookie) assertCookieSameOrigin(c);
    const session = await auth.refresh(await device(c.req), token);
    if (fromCookie || c.req.header("x-web-auth") === "cookie") {
      setWebRefreshCookie(c, session.refreshToken);
      const { refreshToken: _refreshToken, ...safeSession } = session;
      return c.json({ ...safeSession, cookieAuth: true });
    }
    return c.json(session);
  });
  app.post("/auth/lock", async (c) => {
    const { token, fromCookie } = refresh(c);
    if (fromCookie) assertCookieSameOrigin(c);
    return c.json(await auth.lock(await device(c.req), token));
  });
  app.post("/auth/unlock", async (c) => {
    limitCredentials(c.req);
    const { token, fromCookie } = refresh(c);
    if (fromCookie) assertCookieSameOrigin(c);
    const { pin } = await body(c.req, unlockSchema);
    const session = await auth.unlock(await device(c.req), token, pin);
    if (fromCookie || c.req.header("x-web-auth") === "cookie") {
      setWebRefreshCookie(c, session.refreshToken);
      const { refreshToken: _refreshToken, ...safeSession } = session;
      return c.json({ ...safeSession, cookieAuth: true });
    }
    return c.json(session);
  });
  app.post("/auth/logout", async (c) => {
    const { token, fromCookie } = refresh(c);
    if (fromCookie) assertCookieSameOrigin(c);
    await auth.logout(await device(c.req), token);
    clearWebRefreshCookie(c);
    return c.body(null, 204);
  });
  app.post("/auth/change-password", async (c) => {
    limitCredentials(c.req);
    await auth.changePassword(access(c.req), await device(c.req), await body(c.req, changePasswordSchema));
    return c.body(null, 204);
  });
  app.get("/auth/me", async (c) => c.json(await auth.me(access(c.req), await device(c.req))));

  app.get("/dashboard", async (c) => c.json(await reports.dashboard(await profile(c.req))));
  app.get("/reports", async (c) => {
    const query = validate(c.req.query(), reportQuery);
    const { storeId } = await authorize(c.req, reportPermissions[query.kind]);
    return c.json(await reports.report(storeId, query));
  });
  app.get("/shifts", async (c) => {
    const { actor, review } = await shiftReader(c.req);
    return c.json(await shifts.list(actor, review, validate(c.req.query(), catalogQuery)));
  });
  app.get("/shifts/:id", async (c) => {
    const { actor, review } = await shiftReader(c.req);
    return c.json(await shifts.read(actor, validate(c.req.param("id"), uuid), review, validate(c.req.query(), catalogQuery)));
  });
  app.post("/shifts", async (c) => {
    const actor = await authorize(c.req, "shift:operate");
    const key = validate(c.req.header("idempotency-key"), uuid).toLowerCase();
    const { openingFloat } = await body(c.req, shiftOpenInput);
    return c.json(await shifts.open(actor, key, openingFloat), 201);
  });
  app.post("/shifts/:id/movements", async (c) => {
    const actor = await authorize(c.req, "shift:operate");
    const key = validate(c.req.header("idempotency-key"), uuid).toLowerCase();
    return c.json(await shifts.move(actor, validate(c.req.param("id"), uuid), key, await body(c.req, shiftMovementInput)), 201);
  });
  app.post("/shifts/:id/close", async (c) => {
    const { actor, review } = await shiftReader(c.req);
    return c.json(await shifts.close(actor, validate(c.req.param("id"), uuid), await body(c.req, shiftCloseInput), review));
  });

  app.get("/settings/store", async (c) => {
    const { storeId } = await authorize(c.req, "settings:manage");
    return c.json(await settings.read(storeId));
  });
  app.put("/settings/store", async (c) => {
    const actor = await authorize(c.req, "settings:manage");
    return c.json(await settings.save(actor, await body(c.req, storeSettingsInput)));
  });
  app.get("/settings/users", async (c) => {
    const actor = await authorize(c.req, "settings:manage");
    return c.json(await settings.users(actor, validate(c.req.query(), staffQuery)));
  });
  app.post("/settings/users", async (c) => {
    const actor = await authorize(c.req, "settings:manage");
    return c.json(await settings.createUser(actor, await body(c.req, staffCreateInput)), 201);
  });
  app.put("/settings/users/:id", async (c) => {
    const actor = await authorize(c.req, "settings:manage");
    const id = validate(c.req.param("id"), uuid).toLowerCase();
    return c.json(await settings.updateUser(actor, id, await body(c.req, staffUpdateInput)));
  });
  app.delete("/settings/users/:id", async (c) => {
    const actor = await authorize(c.req, "settings:manage");
    const id = validate(c.req.param("id"), uuid).toLowerCase();
    await settings.deleteUser(actor, id);
    return c.body(null, 204);
  });
  app.get("/settings/devices", async (c) => {
    const actor = await authorize(c.req, "settings:manage");
    return c.json(await settings.devices(actor, validate(c.req.query(), deviceListQuery)));
  });
  app.get("/settings/audit-logs", async (c) => {
    const actor = await authorize(c.req, "settings:manage");
    return c.json(await settings.auditLogs(actor.storeId, validate(c.req.query(), auditLogQuery)));
  });
  app.post("/settings/devices", async (c) => {
    const actor = await authorize(c.req, "settings:manage");
    return c.json(await settings.createDevice(actor, await body(c.req, deviceCreateInput)), 201);
  });
  app.patch("/settings/devices/:id", async (c) => {
    const actor = await authorize(c.req, "settings:manage");
    const id = validate(c.req.param("id"), uuid).toLowerCase();
    return c.json(await settings.updateDevice(actor, id, await body(c.req, deviceUpdateInput)));
  });
  app.delete("/settings/devices/:id", async (c) => {
    const actor = await authorize(c.req, "settings:manage");
    const id = validate(c.req.param("id"), uuid).toLowerCase();
    await settings.deleteDevice(actor, id);
    return c.body(null, 204);
  });
  app.get("/catalog/products", async (c) => {
    const { storeId } = await authorize(c.req, "catalog:read");
    return c.json(await catalog.products(storeId, validate(c.req.query(), productQuery)));
  });
  app.get("/catalog/products/:id", async (c) => {
    const { storeId } = await authorize(c.req, "catalog:read");
    return c.json(await catalog.product(storeId, validate(c.req.param("id"), uuid)));
  });
  app.post("/catalog/products", async (c) => {
    const actor = await authorize(c.req, "catalog:write");
    return c.json(await catalog.save(actor, await body(c.req, productInput)), 201);
  });
  app.put("/catalog/products/:id", async (c) => {
    const actor = await authorize(c.req, "catalog:write");
    const id = validate(c.req.param("id"), uuid);
    return c.json(await catalog.save(actor, await body(c.req, productInput), id));
  });
  app.post("/catalog/import/preview", async (c) => {
    const { storeId } = await authorize(c.req, "catalog:write");
    return c.json(await importer.preview(storeId, await body(c.req, importInput)));
  });
  app.post("/catalog/import/commit", async (c) => {
    const actor = await authorize(c.req, "catalog:write");
    const key = validate(c.req.header("idempotency-key"), uuid);
    return c.json(await importer.commit(actor, key, await body(c.req, importInput)), 201);
  });
  app.get("/catalog/categories", async (c) => {
    const { storeId } = await authorize(c.req, "catalog:read");
    return c.json(await catalog.categories(storeId, validate(c.req.query(), catalogQuery)));
  });
  app.post("/catalog/categories", async (c) => {
    const actor = await authorize(c.req, "catalog:write");
    const { name } = await body(c.req, nameInput);
    return c.json(await catalog.createCategory(actor, name), 201);
  });
  app.get("/catalog/suppliers", async (c) => {
    const { storeId } = await authorize(c.req, "catalog:read");
    return c.json(await catalog.suppliers(storeId, validate(c.req.query(), supplierQuery)));
  });
  app.post("/catalog/suppliers", async (c) => {
    const actor = await authorize(c.req, "catalog:write");
    return c.json(await catalog.saveSupplier(actor, await body(c.req, supplierInput)), 201);
  });
  app.put("/catalog/suppliers/:id", async (c) => {
    const actor = await authorize(c.req, "catalog:write");
    const id = validate(c.req.param("id"), uuid);
    return c.json(await catalog.saveSupplier(actor, await body(c.req, supplierInput), id));
  });
  app.patch("/catalog/suppliers/:id/status", async (c) => {
    const actor = await authorize(c.req, "catalog:write");
    const id = validate(c.req.param("id"), uuid);
    const { isActive } = await body(c.req, supplierStatusInput);
    return c.json(await catalog.setSupplierStatus(actor, id, isActive));
  });
  app.post("/inventory/receipts", async (c) => {
    const actor = await authorize(c.req, "inventory:receive");
    const key = validate(c.req.header("idempotency-key"), uuid);
    const result = await inventory.receive(actor, key, await body(c.req, receiptInput));
    return c.json(result, result.replayed ? 200 : 201);
  });
  app.get("/inventory/lots", async (c) => {
    const { storeId } = await authorize(c.req, "inventory:read");
    return c.json(await inventory.lots(storeId, validate(c.req.query(), stockQuery)));
  });
  app.get("/inventory/movements", async (c) => {
    const { storeId } = await authorize(c.req, "inventory:read");
    return c.json(await inventory.movements(storeId, validate(c.req.query(), stockMovementQuery)));
  });
  app.get("/inventory/counts", async (c) => {
    const { storeId } = await authorize(c.req, "inventory:read");
    return c.json(await counts.list(storeId, validate(c.req.query(), stockCountQuery)));
  });
  app.post("/inventory/counts", async (c) => {
    const actor = await authorize(c.req, "inventory:count");
    const key = validate(c.req.header("idempotency-key"), uuid);
    return c.json(await counts.submit(actor, key, await body(c.req, stockCountInput)), 201);
  });
  app.post("/inventory/counts/:id/review", async (c) => {
    const actor = await authorize(c.req, "inventory:approve");
    const id = validate(c.req.param("id"), uuid);
    return c.json(await counts.review(actor, id, await body(c.req, stockDecisionInput)));
  });
  app.get("/sales/categories", async (c) => {
    const { storeId } = await authorize(c.req, "sales:read");
    return c.json(await catalog.categories(storeId, validate(c.req.query(), catalogQuery)));
  });
  app.get("/sales/products", async (c) => {
    const { storeId } = await authorize(c.req, "sales:read");
    return c.json(await sales.lookup(storeId, validate(c.req.query(), posLookupInput)));
  });
  app.get("/sales/members", async (c) => {
    const { storeId } = await authorize(c.req, "sales:read");
    return c.json(await drafts.members(storeId, validate(c.req.query("q") ?? "", z.string().trim().max(100))));
  });
  app.post("/sales/members", async (c) => {
    const actor = await authorize(c.req, "member:write");
    const { id, number, name } = await members.save(actor, { ...await body(c.req, memberInput), isActive: true });
    return c.json({ id, number, name }, 201);
  });
  app.get("/members", async (c) => {
    const { storeId } = await authorize(c.req, "member:read");
    return c.json(await members.list(storeId, validate(c.req.query(), memberListQuery)));
  });
  app.post("/members", async (c) => {
    const actor = await authorize(c.req, "member:write");
    return c.json(await members.save(actor, await body(c.req, memberProfileInput)), 201);
  });
  app.get("/members/:id", async (c) => {
    const actor = await authorize(c.req, "member:read");
    return c.json(await members.detail(actor, validate(c.req.param("id"), uuid)));
  });
  app.put("/members/:id", async (c) => {
    const actor = await authorize(c.req, "member:write");
    return c.json(await members.save(actor, await body(c.req, memberProfileInput), validate(c.req.param("id"), uuid).toLowerCase()));
  });
  app.get("/members/:id/purchases", async (c) => {
    const { storeId } = await authorize(c.req, "member:read");
    return c.json(await members.purchases(storeId, validate(c.req.param("id"), uuid), validate(c.req.query(), catalogQuery)));
  });
  app.get("/members/:id/shares", async (c) => {
    const { storeId } = await authorize(c.req, "member:read");
    return c.json(await members.shares(storeId, validate(c.req.param("id"), uuid), validate(c.req.query(), catalogQuery)));
  });
  app.post("/members/:id/shares", async (c) => {
    const actor = await authorize(c.req, "shares:write");
    const id = validate(c.req.param("id"), uuid).toLowerCase();
    const key = validate(c.req.header("idempotency-key"), uuid).toLowerCase();
    const result = await members.postShares(actor, id, key, await body(c.req, shareInput));
    return c.json(result.entry, result.replayed ? 200 : 201);
  });
  app.get("/dividends/rules", async (c) => {
    const { storeId } = await authorize(c.req, "dividend:read");
    return c.json(await dividends.rules(storeId, validate(c.req.query(), catalogQuery)));
  });
  app.post("/dividends/rules", async (c) => {
    const actor = await authorize(c.req, "dividend:write");
    return c.json(await dividends.saveRule(actor, await body(c.req, dividendRuleInput)), 201);
  });
  app.get("/dividends/periods", async (c) => {
    const { storeId } = await authorize(c.req, "dividend:read");
    return c.json(await dividends.periods(storeId, validate(c.req.query(), periodListQuery)));
  });
  app.post("/dividends/periods", async (c) => {
    const actor = await authorize(c.req, "dividend:write");
    return c.json(await dividends.savePeriod(actor, await body(c.req, accountingPeriodInput)), 201);
  });
  app.put("/dividends/periods/:id", async (c) => {
    const actor = await authorize(c.req, "dividend:write");
    return c.json(await dividends.savePeriod(actor, await body(c.req, accountingPeriodInput), validate(c.req.param("id"), uuid).toLowerCase()));
  });
  app.post("/dividends/periods/:id/preview", async (c) => {
    const actor = await authorize(c.req, "dividend:write");
    return c.json(await dividends.calculate(actor, validate(c.req.param("id"), uuid).toLowerCase()));
  });
  app.get("/dividends/periods/:id/preview", async (c) => {
    const { storeId } = await authorize(c.req, "dividend:read");
    return c.json(await dividends.preview(storeId, validate(c.req.param("id"), uuid), validate(c.req.query(), catalogQuery)));
  });
  app.post("/dividends/periods/:id/approve", async (c) => {
    const actor = await authorize(c.req, "dividend:approve");
    const { runId } = await body(c.req, approveDividendInput);
    return c.json(await dividends.approve(actor, validate(c.req.param("id"), uuid).toLowerCase(), runId.toLowerCase()));
  });
  app.post("/dividends/periods/:id/adjustments", async (c) => {
    const actor = await authorize(c.req, "dividend:approve");
    const key = validate(c.req.header("idempotency-key"), uuid).toLowerCase();
    return c.json(await dividends.adjustPurchases(actor, validate(c.req.param("id"), uuid).toLowerCase(), key,
      await body(c.req, purchaseAdjustmentInput)), 201);
  });
  app.post("/dividends/periods/:id/close", async (c) => {
    const actor = await authorize(c.req, "dividend:approve");
    return c.json(await dividends.close(actor, validate(c.req.param("id"), uuid).toLowerCase()));
  });
  app.get("/dividends/periods/:id/obligations", async (c) => {
    const { storeId } = await authorize(c.req, "dividend:read");
    return c.json(await payouts.obligations(storeId, validate(c.req.param("id"), uuid), validate(c.req.query(), payoutObligationQuery)));
  });
  app.get("/dividends/obligations/:id/payouts", async (c) => {
    const { storeId } = await authorize(c.req, "dividend:read");
    return c.json(await payouts.history(storeId, validate(c.req.param("id"), uuid), validate(c.req.query(), catalogQuery)));
  });
  app.post("/dividends/obligations/:id/payouts", async (c) => {
    const actor = await authorize(c.req, "payout:write");
    const id = validate(c.req.param("id"), uuid).toLowerCase();
    const key = validate(c.req.header("idempotency-key"), uuid).toLowerCase();
    const result = await payouts.record(actor, id, key, await body(c.req, payoutInput));
    return c.json(result.payout, result.replayed ? 200 : 201);
  });
  app.get("/sales/held", async (c) => {
    const actor = await authorize(c.req, "sales:checkout");
    return c.json(await drafts.list(actor, validate(c.req.query(), catalogQuery)));
  });
  app.put("/sales/held/:id", async (c) => {
    const actor = await authorize(c.req, "sales:checkout");
    return c.json(await drafts.hold(actor, validate(c.req.param("id"), uuid), await body(c.req, heldInput)));
  });
  app.post("/sales/held/:id/resume", async (c) => {
    const actor = await authorize(c.req, "sales:checkout");
    const { revision } = await body(c.req, resumeInput);
    return c.json(await drafts.resume(actor, validate(c.req.param("id"), uuid), revision));
  });
  app.get("/sales", async (c) => {
    const { storeId } = await authorize(c.req, "sales:read");
    return c.json(await sales.history(storeId, validate(c.req.query(), catalogQuery)));
  });
  app.get("/sales/:id", async (c) => {
    const { storeId } = await authorize(c.req, "sales:read");
    return c.json(await sales.detail(storeId, validate(c.req.param("id"), uuid)));
  });
  app.post("/sales/:id/returns/quote", async (c) => {
    const { storeId } = await authorize(c.req, "sales:return");
    return c.json(await returns.quote(storeId, validate(c.req.param("id"), uuid), await body(c.req, returnQuoteInput)));
  });
  app.post("/sales/:id/returns", async (c) => {
    const actor = await authorize(c.req, "sales:return");
    const key = validate(c.req.header("idempotency-key"), uuid);
    const { result, replayed } = await returns.record(actor, validate(c.req.param("id"), uuid), key, await body(c.req, returnInput));
    return c.json(result, replayed ? 200 : 201);
  });
  app.post("/sales", async (c) => {
    const actor = await authorize(c.req, "sales:checkout");
    const key = validate(c.req.header("idempotency-key"), uuid);
    const { sale, replayed } = await sales.checkout(actor, key, await body(c.req, checkoutInput));
    c.header("Idempotency-Replayed", replayed ? "true" : "false");
    return c.json(sale, replayed ? 200 : 201);
  });

  return app;
}
