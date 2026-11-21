import type { Device, PrismaClient } from "@prisma/client";
import { apiPrefix, type Permission, type Profile } from "@thepos/contracts";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { HonoRequest } from "hono/request";
import { z } from "zod";
import { ApiError } from "./errors";
import { isPrivateLanIp, isTrustedProxyIp, resolveClientIp as resolveClientAddress, sessionMs } from "./security";
import type { StoreActor } from "./audit";

export const defaultTrustedProxies = ["127.0.0.1", "::1", "::ffff:127.0.0.1"] as const;
export const WEB_REFRESH_COOKIE = "thepos_web_refresh";
export const uuid = z.uuid().transform((id) => id.toLowerCase());

export function validate<S extends z.ZodType>(value: unknown, schema: S): z.output<S> {
  const input = schema.safeParse(value);
  if (!input.success) throw new ApiError(400, "INVALID_INPUT");
  return input.data;
}

export async function body<S extends z.ZodType>(request: HonoRequest, schema: S): Promise<z.output<S>> {
  return validate(await request.json().catch(() => null), schema);
}

export type AuthServiceLike = {
  authorize(accessHeader: string | undefined, device: Device, permission: Permission): Promise<StoreActor>;
  authorizeAny(
    accessHeader: string | undefined,
    device: Device,
    permissions: readonly Permission[],
  ): Promise<{ actor: StoreActor; capabilities: Permission[] }>;
  me(accessHeader: string | undefined, device: Device): Promise<Profile>;
};

export type RouteContext = {
  rawDevice(req: HonoRequest): string | undefined;
  device(req: HonoRequest): Promise<Device>;
  access(req: HonoRequest): string | undefined;
  refresh(c: Context): { token: string | undefined; fromCookie: boolean };
  authorize(req: HonoRequest, permission: Permission): Promise<StoreActor>;
  authorizeAny(
    req: HonoRequest,
    permissions: readonly Permission[],
  ): Promise<{ actor: StoreActor; capabilities: Permission[] }>;
  profile(req: HonoRequest): Promise<Profile>;
  limitCredentials(req: HonoRequest, bucket?: "auth" | "setup"): void;
  requireLanIp(request: Request): string | undefined;
  assertCookieSameOrigin(c: Context): void;
  setWebRefreshCookie(c: Context, refreshToken: string): void;
  clearWebRefreshCookie(c: Context): void;
};

export function createRouteContext(options: {
  db: PrismaClient;
  auth: AuthServiceLike;
  registeredDevice: (db: PrismaClient, raw: string | undefined) => Promise<Device>;
  now: () => number;
  trustedProxies: readonly string[];
  clientIp?: (request: Request) => string | undefined;
}): RouteContext {
  const { db, auth, registeredDevice, now, trustedProxies, clientIp } = options;
  const perIp = new Map<string, { count: number; resetAt: number }>();

  function resolveClientIp(request: Request) {
    return resolveClientAddress(request, clientIp?.(request), trustedProxies);
  }

  function requireLanIp(request: Request) {
    const ip = clientIp ? resolveClientIp(request) : "127.0.0.1";
    if (!isPrivateLanIp(ip)) throw new ApiError(403, "LAN_ONLY");
    return ip;
  }

  function limitCredentials(request: HonoRequest, bucket: "auth" | "setup" = "auth") {
    const ip = resolveClientIp(request.raw);
    if (!ip) return;
    const key = `${bucket}:${ip}`;
    const timestamp = now();
    const current = perIp.get(key);
    if (!current || timestamp >= current.resetAt) {
      if (!current && perIp.size >= 4096) {
        const oldest = perIp.keys().next().value;
        if (oldest !== undefined) perIp.delete(oldest);
      }
      perIp.delete(key);
      perIp.set(key, { count: 1, resetAt: timestamp + 60_000 });
      return;
    }
    if (current.count >= 60) {
      throw new ApiError(429, "RATE_LIMITED");
    }
    current.count += 1;
    perIp.delete(key);
    perIp.set(key, current);
  }

  function isSecureRequest(request: Request): boolean {
    const peer = clientIp?.(request);
    if (peer && isTrustedProxyIp(peer, trustedProxies)) {
      const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
      if (forwardedProto === "https") return true;
    }
    try {
      return new URL(request.url).protocol === "https:";
    } catch {
      return false;
    }
  }

  function assertCookieSameOrigin(c: Context) {
    const fetchSite = c.req.header("sec-fetch-site");
    const origin = c.req.header("origin");
    if (!fetchSite && !origin) {
      throw new ApiError(403, "FORBIDDEN");
    }
    if (fetchSite && fetchSite !== "same-origin") {
      throw new ApiError(403, "FORBIDDEN");
    }
    if (origin) {
      try {
        const url = new URL(c.req.url);
        const reqOrigin = url.origin;
        const peer = clientIp?.(c.req.raw);
        const trusted = !!peer && isTrustedProxyIp(peer, trustedProxies);
        const host = trusted
          ? c.req.header("x-forwarded-host")?.split(",")[0]?.trim() || c.req.header("host")
          : c.req.header("host");
        const proto = trusted
          ? c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "")
          : url.protocol.replace(":", "");
        const expected = host ? `${proto}://${host}` : reqOrigin;
        if (origin !== reqOrigin && origin !== expected) throw new ApiError(403, "FORBIDDEN");
      } catch {
        throw new ApiError(403, "FORBIDDEN");
      }
    }
  }

  const rawDevice = (req: HonoRequest) => req.header("x-device-token");
  const device = (req: HonoRequest) => registeredDevice(db, rawDevice(req));
  const access = (req: HonoRequest) => req.header("authorization");

  return {
    rawDevice,
    device,
    access,
    refresh(c) {
      const headerToken = c.req.header("x-refresh-token");
      if (headerToken) return { token: headerToken, fromCookie: false };
      const cookieToken = getCookie(c, WEB_REFRESH_COOKIE);
      return { token: cookieToken, fromCookie: Boolean(cookieToken) };
    },
    authorize: async (req, permission) => auth.authorize(access(req), await device(req), permission),
    authorizeAny: async (req, permissions) => auth.authorizeAny(access(req), await device(req), permissions),
    profile: async (req) => auth.me(access(req), await device(req)),
    limitCredentials,
    requireLanIp,
    assertCookieSameOrigin,
    setWebRefreshCookie(c, refreshToken) {
      setCookie(c, WEB_REFRESH_COOKIE, refreshToken, {
        httpOnly: true,
        sameSite: "Strict",
        secure: isSecureRequest(c.req.raw),
        path: `${apiPrefix}/auth`,
        maxAge: Math.floor(sessionMs / 1000),
      });
    },
    clearWebRefreshCookie(c) {
      deleteCookie(c, WEB_REFRESH_COOKIE, {
        path: `${apiPrefix}/auth`,
        secure: isSecureRequest(c.req.raw),
      });
    },
  };
}
