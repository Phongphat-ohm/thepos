import { existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createApp, normalizeCorsOrigins } from "./app";
import { resolveClientIp } from "./core/security";
import { createServerSecurity } from "./core/server-security";
import { detectAllInterfaceIpv4s, detectLanIps, ensureSelfSignedCert, isValidIpv4 } from "./core/tls";
import { createServerAdminApp } from "./modules/server-admin/routes";

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
  AUTO_HTTPS: z.enum(["true", "false"]).default("false"),
  HTTPS_PORT: z.coerce.number().int().min(0).max(65535).default(3443),
  TLS_CERT_PATH: optionalEnv(z.string().min(1)),
  TLS_KEY_PATH: optionalEnv(z.string().min(1)),
  TLS_EXTRA_IPS: z.string().default(""),
  SERVER_CONSOLE_CODE: optionalEnv(z.string().min(12).max(64)),
  SERVER_CONNECT_SECRET: optionalEnv(z.string().min(12).max(128)),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
}).safeParse(process.env);
if (!env.success) {
  throw new Error(`Invalid server configuration: ${env.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
}
const options = env.data;
if (options.JWT_SECRET === options.BOOTSTRAP_SECRET) throw new Error("Use distinct JWT and bootstrap secrets.");
const trustedProxies = options.TRUSTED_PROXY_IPS.split(",").map((ip) => ip.trim()).filter(Boolean);
const corsOrigins = normalizeCorsOrigins(options.CORS_ORIGINS.split(","));
const tlsExtraIps = options.TLS_EXTRA_IPS.split(",").map((ip) => ip.trim()).filter(isValidIpv4);

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

const resolvePeerIp = (request: Request) =>
  (httpsServer?.requestIP(request) ?? server.requestIP(request))?.address;

const resolveAdminIp = (request: Request) =>
  resolveClientIp(request, resolvePeerIp(request), effectiveTrusted);

const httpsEnabled = options.AUTO_HTTPS === "true" && options.HTTPS_PORT > 0 && options.HTTPS_PORT !== options.API_PORT;

function getNetworkUrls() {
  const lanIps = detectLanIps();
  const hosts = options.API_HOST !== "0.0.0.0" && options.API_HOST !== "127.0.0.1" && options.API_HOST !== "::1"
    ? [options.API_HOST, ...lanIps.filter((ip) => ip !== options.API_HOST)]
    : lanIps;
  const mobileBaseUrls: string[] = [];
  if (httpsEnabled) {
    const portPart = options.HTTPS_PORT === 443 ? "" : `:${options.HTTPS_PORT}`;
    for (const ip of hosts) mobileBaseUrls.push(`https://${ip}${portPart}`);
  }
  const httpPortPart = options.API_PORT === 80 ? "" : `:${options.API_PORT}`;
  for (const ip of hosts) mobileBaseUrls.push(`http://${ip}${httpPortPart}`);

  return {
    preferredMobileBaseUrl: mobileBaseUrls[0] ?? null,
    mobileBaseUrls,
    httpsEnabled,
  };
}

const app = createApp(db, {
  jwtSecret: options.JWT_SECRET,
  bootstrapSecret: options.BOOTSTRAP_SECRET,
  memberEncryptionKey: options.MEMBER_ENCRYPTION_KEY,
  cashVarianceLimit: options.CASH_VARIANCE_LIMIT,
  trustedProxies: trustedProxies.length ? trustedProxies : undefined,
  corsOrigins: corsOrigins.length ? corsOrigins : undefined,
  serverSecurity: security,
  clientIp: resolvePeerIp,
  getNetworkUrls,
});
const serverAdmin = createServerAdminApp(db, {
  security,
  bootstrapSecret: options.BOOTSTRAP_SECRET,
  host: options.API_HOST,
  port: options.API_PORT,
  startedAt,
  corsEnabled: corsOrigins.length > 0,
  resolveIp: resolveAdminIp,
  resolvePeerIp,
  trustedProxies: effectiveTrusted,
});
const webRoot = existsSync(resolve(import.meta.dir, "../../../web-portal/dist/index.html"))
  ? resolve(import.meta.dir, "../../../web-portal/dist")
  : resolve(import.meta.dir, "../../desktop/dist");
const indexHtml = resolve(webRoot, "index.html");

const webSecurityHeaders = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(self)",
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
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; sandbox",
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

const handleFetch = (request: Request) => {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/brand-logo") {
    return serveBrandLogo(request);
  }
  if (pathname === "/server-admin" || pathname.startsWith("/server-admin/")) {
    return serverAdmin.fetch(request);
  }
  return serveStaticWeb(request) ?? app.fetch(request);
};

const handleHttpFetch = (request: Request) => {
  const url = new URL(request.url);
  if (httpsEnabled && (url.pathname === "/server-admin" || url.pathname.startsWith("/server-admin/"))) {
    const httpsPort = options.HTTPS_PORT === 443 ? "" : `:${options.HTTPS_PORT}`;
    return Response.redirect(`https://${url.hostname}${httpsPort}${url.pathname}${url.search}`, 308);
  }
  return handleFetch(request);
};

const server = Bun.serve({
  hostname: options.API_HOST,
  port: options.API_PORT,
  maxRequestBodySize: 1024 * 1024,
  fetch: handleHttpFetch,
});

const lanIps = detectLanIps();
const certIps = [...new Set([...lanIps, ...detectAllInterfaceIpv4s(), ...tlsExtraIps])];
let httpsServer: ReturnType<typeof Bun.serve> | undefined;
if (httpsEnabled) {
  const tls = options.TLS_CERT_PATH && options.TLS_KEY_PATH
    ? {
        cert: Bun.file(options.TLS_CERT_PATH),
        key: Bun.file(options.TLS_KEY_PATH),
      }
    : (() => {
        const generated = ensureSelfSignedCert(certIps, resolve(import.meta.dir, "../../../.tls"));
        return { cert: generated.cert, key: generated.key };
      })();

  httpsServer = Bun.serve({
    hostname: options.API_HOST,
    port: options.HTTPS_PORT,
    maxRequestBodySize: 1024 * 1024,
    tls,
    fetch: handleFetch,
  });
}

const primaryLanIp = lanIps[0];
const displayHost =
  server.hostname === "0.0.0.0" ? (primaryLanIp ?? "127.0.0.1") : server.hostname;
console.info("");
console.info("======================================================================");
console.info(`  กำลังรันเซิร์ฟเวอร์ ThePOS (HTTP):  http://${displayHost}:${server.port}`);
if (httpsServer) {
  console.info(`  กำลังรันเซิร์ฟเวอร์ ThePOS (HTTPS): https://${displayHost}:${httpsServer.port}`);
  for (const extraIp of tlsExtraIps) {
    if (extraIp !== displayHost) {
      console.info(`  กำลังรันเซิร์ฟเวอร์ ThePOS (HTTPS): https://${extraIp}:${httpsServer.port}`);
    }
  }
}
if (lanIps.length > 1) {
  console.info(`  IP ในวง LAN ทั้งหมดที่พบ:          ${lanIps.join(", ")}`);
}
if (corsOrigins.length) {
  console.info(`  CORS Origins ที่อนุญาต:            ${corsOrigins.join(", ")}`);
}
const adminUrl = httpsServer
  ? `https://${displayHost}:${httpsServer.port}/server-admin`
  : `http://${displayHost}:${server.port}/server-admin`;
console.info(`  หน้าเว็บผู้ดูแลเซิร์ฟเวอร์:        ${adminUrl}`);
if (!options.SERVER_CONSOLE_CODE && process.env.NODE_ENV !== "production") {
  console.info(`  รหัสเข้าสู่หน้าเว็บเซิร์ฟเวอร์:       ${consoleCode}`);
  console.info("  (ใช้รหัสนี้เพื่อเข้าสู่หน้าเว็บผู้ดูแล สำหรับดูรหัสเชื่อมต่อและตรวจสอบเครื่อง POS)");
}
console.info("======================================================================");
console.info("");
