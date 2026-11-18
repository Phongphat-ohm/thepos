import { existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createApp } from "./app";
import { isTrustedProxyIp } from "./security";
import { createServerAdminApp } from "./server-admin";
import { createServerSecurity } from "./server-security";

const optionalEnv = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), schema.optional());

const env = z.object({
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32),
  BOOTSTRAP_SECRET: optionalEnv(z.string().min(32)),
  MEMBER_ENCRYPTION_KEY: optionalEnv(z.string().regex(/^[a-f\d]{64}$/i)),
  CASH_VARIANCE_LIMIT: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).default("0.00"),
  TRUSTED_PROXY_IPS: z.string().default(""),
  CORS_ORIGINS: z.string().default(""),
  SERVE_WEB_DIST: z.enum(["true", "false"]).default("false"),
  SERVER_CONSOLE_CODE: optionalEnv(z.string().min(6).max(64)),
  SERVER_CONNECT_SECRET: optionalEnv(z.string().min(6).max(128)),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
}).safeParse(process.env);
if (!env.success) {
  throw new Error(`Invalid server configuration: ${env.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
}
const options = env.data;
if (options.JWT_SECRET === options.BOOTSTRAP_SECRET) throw new Error("Use distinct JWT and bootstrap secrets.");
const trustedProxies = options.TRUSTED_PROXY_IPS.split(",").map((ip) => ip.trim()).filter(Boolean);
const corsOrigins = options.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);

const startedAt = Date.now();
const { security, consoleCode } = createServerSecurity({
  signingSecret: options.JWT_SECRET,
  consoleCode: options.SERVER_CONSOLE_CODE,
  connectKey: options.SERVER_CONNECT_SECRET,
});

const db = new PrismaClient();
await security.initPersistence?.(db);
const defaultTrustedProxies = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
const effectiveTrusted = trustedProxies.length ? trustedProxies : defaultTrustedProxies;

const resolveAdminIp = (request: Request) => {
  const peer = server.requestIP(request)?.address;
  if (!peer) return undefined;
  if (!isTrustedProxyIp(peer, effectiveTrusted)) return peer;
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return peer;
  const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
  for (let index = hops.length - 1; index >= 0; index--) {
    const candidate = hops[index]!;
    if (!isTrustedProxyIp(candidate, effectiveTrusted)) return candidate;
  }
  return peer;
};

const app = createApp(db, {
  jwtSecret: options.JWT_SECRET,
  bootstrapSecret: options.BOOTSTRAP_SECRET,
  memberEncryptionKey: options.MEMBER_ENCRYPTION_KEY,
  cashVarianceLimit: options.CASH_VARIANCE_LIMIT,
  trustedProxies: trustedProxies.length ? trustedProxies : undefined,
  corsOrigins: corsOrigins.length ? corsOrigins : undefined,
  serverSecurity: security,
  clientIp: (request) => server.requestIP(request)?.address,
});
const serverAdmin = createServerAdminApp(db, {
  security,
  bootstrapSecret: options.BOOTSTRAP_SECRET,
  host: options.API_HOST,
  port: options.API_PORT,
  startedAt,
  corsEnabled: corsOrigins.length > 0,
  resolveIp: resolveAdminIp,
});
const webRoot = resolve(import.meta.dir, "../../desktop/dist");
const indexHtml = resolve(webRoot, "index.html");

const webSecurityHeaders = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

const brandLogoCandidates = ["logo.png", "logo.svg", "logo.webp", "logo.jpg", "logo.jpeg"] as const;
const brandLogoTypes: Record<string, string> = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function findBrandLogo(): { path: string; contentType: string; etag: string } | null {
  const dirs = [
    process.cwd(),
    resolve(import.meta.dir, "../../.."),
    resolve(process.execPath, ".."),
  ];
  for (const dir of dirs) {
    for (const file of brandLogoCandidates) {
      const candidate = resolve(dir, file);
      if (existsSync(candidate)) {
        const stat = statSync(candidate);
        if (stat.isFile()) {
          const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
          return {
            path: candidate,
            contentType: brandLogoTypes[ext] ?? "application/octet-stream",
            etag: `"${Math.trunc(stat.mtimeMs)}-${stat.size}"`,
          };
        }
      }
    }
  }
  return null;
}

function serveBrandLogo(request: Request): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405 });
  }
  const logo = findBrandLogo();
  if (!logo) {
    return new Response(null, { status: 404, headers: { "cache-control": "no-cache" } });
  }
  const headers = {
    "content-type": logo.contentType,
    "cache-control": "no-cache",
    etag: logo.etag,
    "x-content-type-options": "nosniff",
  };
  if (request.headers.get("if-none-match") === logo.etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : Bun.file(logo.path), { headers });
}

function serveStaticWeb(request: Request): Response | null {
  if (options.SERVE_WEB_DIST !== "true") return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith("/api/") || pathname === "/api" || pathname.startsWith("/server-admin")) return null;
  if (!existsSync(indexHtml)) return null;
  const relative = pathname.replace(/^\/+/, "");
  if (relative) {
    const candidate = resolve(webRoot, relative);
    if ((candidate === webRoot || candidate.startsWith(webRoot + sep)) && existsSync(candidate) && statSync(candidate).isFile()) {
      return new Response(Bun.file(candidate), { headers: webSecurityHeaders });
    }
  }
  return new Response(Bun.file(indexHtml), {
    headers: { ...webSecurityHeaders, "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
  });
}

const server = Bun.serve({
  hostname: options.API_HOST,
  port: options.API_PORT,
  maxRequestBodySize: 1024 * 1024,
  fetch: (request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/brand-logo") {
      return serveBrandLogo(request);
    }
    if (pathname === "/server-admin" || pathname.startsWith("/server-admin/")) {
      return serverAdmin.fetch(request);
    }
    return serveStaticWeb(request) ?? app.fetch(request);
  },
});

const displayHost = server.hostname === "0.0.0.0" ? "127.0.0.1" : server.hostname;
console.info("");
console.info("======================================================================");
console.info(`  กำลังรันเซิร์ฟเวอร์ ThePOS ที่:      http://${displayHost}:${server.port}`);
console.info(`  หน้าเว็บผู้ดูแลเซิร์ฟเวอร์:        http://${displayHost}:${server.port}/server-admin`);
console.info(`  รหัสเข้าสู่หน้าเว็บเซิร์ฟเวอร์:       ${consoleCode}`);
console.info("  (ใช้รหัสนี้เพื่อเข้าสู่หน้าเว็บผู้ดูแล สำหรับดูรหัสเชื่อมต่อและตรวจสอบเครื่อง POS)");
console.info("======================================================================");
console.info("");
