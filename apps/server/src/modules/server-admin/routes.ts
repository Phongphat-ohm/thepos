import { randomBytes } from "node:crypto";
import { type PrismaClient } from "@prisma/client";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { roleSchema } from "@thepos/contracts";
import { isPrivateLanIp, isTrustedProxyIp } from "../../core/security";
import type { ServerSecurity } from "../../core/server-security";
import { resetServerData } from "./reset";
import { renderHtml } from "./page";

const COOKIE_NAME = "thepos_server_admin";
const loginBodySchema = z.strictObject({
  code: z.string().trim().min(1).max(128),
});
const resetBodySchema = z.strictObject({
  code: z.string().trim().min(1).max(128),
  confirmation: z.literal("ล้างข้อมูลทั้งหมด"),
});

export function createServerAdminApp(
  db: PrismaClient,
  options: {
    security: ServerSecurity;
    bootstrapSecret?: string;
    host: string;
    port: number;
    startedAt: number;
    corsEnabled: boolean;
    now?: () => number;
    resolveIp?: (request: Request) => string | undefined;
    resolvePeerIp?: (request: Request) => string | undefined;
    trustedProxies?: readonly string[];
  },
) {
  const app = new Hono();
  const now = options.now ?? Date.now;
  const attempts = new Map<string, { count: number; resetAt: number }>();
  const failedLogins = new Map<string, { fails: number; lockedUntil: number }>();
  const LOCKOUT_MS = 15 * 60_000;
  let resetInProgress = false;

  function checkRateLimit(key: string) {
    const ts = now();
    const current = attempts.get(key);
    if (!current || ts >= current.resetAt) {
      if (!attempts.has(key) && attempts.size >= 4096) {
        const oldest = attempts.keys().next().value;
        if (oldest !== undefined) attempts.delete(oldest);
      }
      attempts.delete(key);
      attempts.set(key, { count: 1, resetAt: ts + 60_000 });
      return true;
    }
    if (current.count >= 20) return false;
    current.count += 1;
    attempts.delete(key);
    attempts.set(key, current);
    return true;
  }

  function isAuthed(c: import("hono").Context) {
    return options.security.verifyAdminSessionToken(getCookie(c, COOKIE_NAME));
  }

  function isFromTrustedProxy(request: Request): boolean {
    const peer = options.resolvePeerIp?.(request);
    return !!peer && !!options.trustedProxies && isTrustedProxyIp(peer, options.trustedProxies);
  }

  function sameOriginPost(request: Request): boolean {
    const fetchSite = request.headers.get("sec-fetch-site");
    const origin = request.headers.get("origin");
    if (!fetchSite && !origin) return false;
    if (fetchSite && fetchSite !== "same-origin") return false;
    if (origin) {
      try {
        const url = new URL(request.url);
        const reqOrigin = url.origin;
        const trusted = isFromTrustedProxy(request);
        const host = trusted
          ? request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host")
          : request.headers.get("host");
        const proto = trusted
          ? request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "")
          : url.protocol.replace(":", "");
        const expected = host ? `${proto}://${host}` : reqOrigin;
        if (origin !== reqOrigin && origin !== expected) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  function isSecureCookie(request: Request): boolean {
    if (isFromTrustedProxy(request)) {
      const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
      if (forwardedProto === "https") return true;
    }
    try {
      return new URL(request.url).protocol === "https:";
    } catch {
      return false;
    }
  }

  app.use("*", async (c, next) => {
    if (options.resolveIp) {
      const ip = options.resolveIp(c.req.raw);
      if (!isPrivateLanIp(ip)) {
        return c.json({ ok: false, code: "LAN_ONLY" }, 403);
      }
    }
    c.header("Cache-Control", "no-store");
    c.header("X-Frame-Options", "DENY");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !sameOriginPost(c.req.raw)) {
      return c.json({ ok: false, message: "คำขอไม่ตรงแหล่งที่มา (CSRF Blocked)" }, 403);
    }
    await next();
  });

  app.post("/server-admin/login", async (c) => {
    const ip = options.resolveIp?.(c.req.raw) || "local";
    const ts = now();
    const lockState = failedLogins.get(ip);
    if (lockState && lockState.lockedUntil > ts) {
      return c.json({ ok: false, message: "ลองเข้าสู่ระบบผิดพลาดหลายครั้ง กรุณารอ 15 นาที" }, 429);
    }
    if (!checkRateLimit(ip)) {
      return c.json({ ok: false, message: "ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่" }, 429);
    }
    const raw = await c.req.json().catch(() => null);
    const parsed = loginBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ ok: false, message: "รูปแบบรหัสผ่านไม่ถูกต้อง" }, 400);
    }
    if (!options.security.verifyConsoleCode(parsed.data.code)) {
      const prevFails = lockState && lockState.lockedUntil <= ts ? 0 : (lockState?.fails ?? 0);
      const nextFails = prevFails + 1;
      if (failedLogins.size >= 4096 && !failedLogins.has(ip)) {
        const oldest = failedLogins.keys().next().value;
        if (oldest !== undefined) failedLogins.delete(oldest);
      }
      failedLogins.set(ip, {
        fails: nextFails,
        lockedUntil: nextFails >= 5 ? ts + LOCKOUT_MS : 0,
      });
      return c.json({ ok: false, message: "รหัสเข้าสู่หน้าเว็บเซิร์ฟเวอร์ไม่ถูกต้อง" }, 401);
    }
    failedLogins.delete(ip);
    const token = options.security.createAdminSessionToken();
    setCookie(c, COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "Strict",
      secure: isSecureCookie(c.req.raw),
      path: "/server-admin",
      maxAge: 8 * 60 * 60,
    });
    return c.json({ ok: true });
  });

  app.post("/server-admin/logout", (c) => {
    options.security.revokeAdminSessionToken(getCookie(c, COOKIE_NAME));
    deleteCookie(c, COOKIE_NAME, { path: "/server-admin", secure: isSecureCookie(c.req.raw) });
    return c.json({ ok: true });
  });

  app.get("/server-admin/api/overview", async (c) => {
    if (!isAuthed(c)) return c.json({ code: "UNAUTHORIZED" }, 401);

    let ready = false;
    let dbError: string | null = null;
    let store: { name: string; createdAt: Date } | null = null;
    let devices: {
      id: string;
      name: string;
      disabledAt: Date | null;
      pinHash: string | null;
      isWebDevice: boolean;
      createdAt: Date;
      sessions: { expiresAt: Date; lockedAt: Date | null; user: { name: string; username: string } }[];
    }[] = [];

    try {
      const [foundStore, roleCount, foundDevices] = await db.$transaction([
        db.store.findFirst({ select: { name: true, createdAt: true } }),
        db.role.count({ where: { code: { in: [...roleSchema.options] } } }),
        db.device.findMany({
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            disabledAt: true,
            pinHash: true,
            isWebDevice: true,
            createdAt: true,
            sessions: {
              where: { revokedAt: null },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                expiresAt: true,
                lockedAt: true,
                user: { select: { name: true, username: true } },
              },
            },
          },
        }),
      ]);
      store = foundStore;
      devices = foundDevices;
      ready = roleCount === roleSchema.options.length;
      if (!ready) {
        dbError = "ฐานข้อมูลยังไม่มีข้อมูลบทบาทเริ่มต้น (กรุณารัน bun run db:migrate และ bun run db:seed)";
      }
    } catch {
      ready = false;
      dbError = "ไม่สามารถเชื่อมต่อฐานข้อมูลได้ (กรุณาตรวจสอบว่า PostgreSQL กำลังทำงานอยู่ เช่น รัน bun run db:up)";
    }

    const currentNow = now();
    return c.json({
      server: {
        ready,
        dbError,
        host: options.host,
        port: options.port,
        startedAt: new Date(options.startedAt).toISOString(),
        uptimeSeconds: Math.max(0, Math.floor((currentNow - options.startedAt) / 1000)),
        corsEnabled: options.corsEnabled,
      },
      security: {
        connectKey: options.security.getConnectKey(),
        keyVersion: options.security.getKeyVersion(),
        hasBootstrapSecret: Boolean(options.bootstrapSecret),
        bootstrapSecret: !store && options.bootstrapSecret ? options.bootstrapSecret : null,
      },
      store: store
        ? { initialized: true, name: store.name, createdAt: store.createdAt.toISOString() }
        : { initialized: false, name: null, createdAt: null },
      devices: devices
        .filter((d) => {
          if (!d.isWebDevice) return true;
          const session = d.sessions[0];
          return !!session && session.expiresAt.getTime() > currentNow;
        })
        .map((d) => {
          const session = d.sessions[0];
          const isSessionActive = !!session && session.expiresAt.getTime() > currentNow;
          return {
            id: d.id,
            name: d.name,
            isActive: d.disabledAt === null,
            hasPin: Boolean(d.pinHash),
            createdAt: d.createdAt.toISOString(),
            activeUser: isSessionActive ? `${session.user.name} (${session.user.username})` : null,
            sessionLocked: isSessionActive && session.lockedAt !== null,
          };
        }),
    });
  });

  app.post("/server-admin/api/rotate-connect-key", async (c) => {
    if (!isAuthed(c)) return c.json({ code: "UNAUTHORIZED" }, 401);
    const rotated = options.security.rotateConnectKeyPersisted
      ? await options.security.rotateConnectKeyPersisted(db)
      : options.security.rotateConnectKey();
    return c.json(rotated);
  });

  app.post("/server-admin/api/reset-data", async (c) => {
    if (!isAuthed(c)) return c.json({ code: "UNAUTHORIZED" }, 401);
    const ip = options.resolveIp?.(c.req.raw) || "local";
    if (!checkRateLimit(`reset:${ip}`)) {
      return c.json({ message: "ยืนยันบ่อยเกินไป กรุณารอ 1 นาที" }, 429);
    }
    const parsed = resetBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ message: "กรอกรหัสผู้ดูแลและข้อความยืนยันให้ครบถ้วน" }, 400);
    if (!options.security.verifyConsoleCode(parsed.data.code)) {
      return c.json({ message: "รหัสผู้ดูแลจาก Terminal ไม่ถูกต้อง" }, 403);
    }
    if (!options.bootstrapSecret) {
      return c.json({ message: "ต้องกำหนด BOOTSTRAP_SECRET บนเซิร์ฟเวอร์ก่อน เพื่อให้ตั้งค่าร้านใหม่ได้หลังล้างข้อมูล" }, 409);
    }
    if (resetInProgress) return c.json({ message: "เซิร์ฟเวอร์กำลังล้างข้อมูล กรุณารอสักครู่" }, 409);
    resetInProgress = true;
    try {
      await resetServerData(db);
      return c.json({ ok: true });
    } catch {
      return c.json({ message: "ล้างข้อมูลไม่สำเร็จ ระบบย้อนกลับการเปลี่ยนแปลงแล้ว กรุณาตรวจสอบฐานข้อมูลและสิทธิ์ของเซิร์ฟเวอร์" }, 503);
    } finally {
      resetInProgress = false;
    }
  });

  app.get("/server-admin", (c) => {
    const authed = isAuthed(c);
    const nonce = randomBytes(16).toString("base64");
    c.header(
      "Content-Security-Policy",
      `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    );
    return c.html(renderHtml(authed, nonce));
  });

  return app;
}
