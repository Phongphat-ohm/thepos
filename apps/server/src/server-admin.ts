import { randomBytes } from "node:crypto";
import { type PrismaClient } from "@prisma/client";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { roleSchema } from "@thepos/contracts";
import type { ServerSecurity } from "./server-security";

const COOKIE_NAME = "thepos_server_admin";
const loginBodySchema = z.strictObject({
  code: z.string().trim().min(1).max(128),
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
  },
) {
  const app = new Hono();
  const now = options.now ?? Date.now;
  const attempts = new Map<string, { count: number; resetAt: number }>();

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

  function sameOriginPost(request: Request): boolean {
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
    const origin = request.headers.get("origin");
    if (origin) {
      try {
        const reqOrigin = new URL(request.url).origin;
        const host = request.headers.get("host");
        const proto = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
        const expected = host ? `${proto}://${host}` : reqOrigin;
        if (origin !== reqOrigin && origin !== expected) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  function isSecureCookie(request: Request): boolean {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    if (forwardedProto === "https") return true;
    try {
      return new URL(request.url).protocol === "https:";
    } catch {
      return false;
    }
  }

  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Frame-Options", "DENY");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    if (c.req.method === "POST" && !sameOriginPost(c.req.raw)) {
      return c.json({ ok: false, message: "คำขอไม่ตรงแหล่งที่มา (CSRF Blocked)" }, 403);
    }
    await next();
  });

  app.post("/server-admin/login", async (c) => {
    const ip = options.resolveIp?.(c.req.raw) || "local";
    if (!checkRateLimit(ip)) {
      return c.json({ ok: false, message: "ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่" }, 429);
    }
    const raw = await c.req.json().catch(() => null);
    const parsed = loginBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ ok: false, message: "รูปแบบรหัสผ่านไม่ถูกต้อง" }, 400);
    }
    if (!options.security.verifyConsoleCode(parsed.data.code)) {
      return c.json({ ok: false, message: "รหัสเข้าสู่หน้าเว็บเซิร์ฟเวอร์ไม่ถูกต้อง" }, 401);
    }
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

function renderHtml(authed: boolean, nonce: string): string {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ThePOS Server — หน้าเว็บผู้ดูแลเซิร์ฟเวอร์</title>
  <style nonce="${nonce}">
    :root {
      --bg: #f4f6f9;
      --surface: #ffffff;
      --ink: #0f172a;
      --muted: #475569;
      --brand: #1d4ed8;
      --brand-hover: #1e40af;
      --ok: #15803d;
      --warn: #b45309;
      --err: #b91c1c;
      --border: #e2e8f0;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Kanit", "Segoe UI", Tahoma, sans-serif;
      background: var(--bg);
      color: var(--ink);
      line-height: 1.5;
    }
    .wrap { max-width: 980px; margin: 0 auto; padding: 2rem 1rem 3rem; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 1.5rem;
      box-shadow: 0 4px 16px rgba(15, 23, 42, .05);
      margin-bottom: 1.25rem;
    }
    .login-box { max-width: 440px; margin: 4rem auto; }
    h1 { margin: 0 0 .35rem; font-size: 1.45rem; }
    h2 { margin: 0 0 .85rem; font-size: 1.1rem; }
    p { margin: 0 0 .75rem; color: var(--muted); font-size: .95rem; }
    .row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }
    .stat { border: 1px solid var(--border); border-radius: 10px; padding: .9rem 1rem; background: #f8fafc; }
    .stat-label { font-size: .82rem; color: var(--muted); }
    .stat-value { font-size: 1.1rem; font-weight: 600; margin-top: .2rem; }
    .secret-box {
      display: flex; flex-wrap: wrap; align-items: center; gap: .6rem;
      background: #0f172a; color: #f8fafc; padding: .85rem 1rem;
      border-radius: 10px; font-family: ui-monospace, Consolas, monospace; font-size: 1rem;
      letter-spacing: .04em;
    }
    .secret-box code { flex: 1; word-break: break-all; }
    label { display: block; font-weight: 600; font-size: .9rem; margin-bottom: .35rem; }
    input[type="password"], input[type="text"] {
      width: 100%; padding: .65rem .8rem; border: 1px solid var(--border);
      border-radius: 8px; font: inherit; font-size: 1rem; margin-bottom: .9rem;
    }
    button {
      font: inherit; font-weight: 600; font-size: .9rem; border-radius: 8px;
      padding: .55rem 1rem; cursor: pointer; border: 1px solid transparent;
      background: var(--brand); color: #fff;
    }
    button:hover { background: var(--brand-hover); }
    button.outline { background: #fff; color: var(--ink); border-color: var(--border); }
    button.outline:hover { border-color: var(--brand); color: var(--brand); }
    button.danger { background: #dc2626; }
    button.danger:hover { background: #b91c1c; }
    .badge { display: inline-block; padding: .15rem .55rem; border-radius: 999px; font-size: .8rem; font-weight: 600; }
    .badge.ok { background: #dcfce7; color: var(--ok); }
    .badge.warn { background: #fef3c7; color: var(--warn); }
    .badge.off { background: #fee2e2; color: var(--err); }
    .error { color: var(--err); font-size: .9rem; margin-bottom: .75rem; }
    table { width: 100%; border-collapse: collapse; font-size: .92rem; }
    th, td { text-align: left; padding: .65rem .5rem; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 600; }
    .brand-title { display: flex; align-items: center; gap: .75rem; }
    .brand-logo { width: 38px; height: 38px; object-fit: contain; flex: none; background: transparent; }
  </style>
</head>
<body>
  <div class="wrap">
    ${authed ? `
    <div class="card row">
      <div class="brand-title">
        <img class="brand-logo" src="/brand-logo" alt="ThePOS" />
        <div>
          <h1>หน้าเว็บผู้ดูแลเซิร์ฟเวอร์ (ThePOS Server)</h1>
          <p style="margin:0">ตรวจสอบสถานะเซิร์ฟเวอร์ รหัสเชื่อมต่อ และเครื่อง POS ที่ลงทะเบียน</p>
        </div>
      </div>
      <div class="row">
        <button class="outline" id="refreshBtn">รีเฟรชข้อมูล</button>
        <button class="outline" id="logoutBtn">ออกจากระบบ</button>
      </div>
    </div>

    <div class="card">
      <h2>สถานะระบบ</h2>
      <div class="grid" id="statsGrid">กำลังโหลด...</div>
      <div id="dbAlert" class="error" style="display:none;margin-top:.85rem;margin-bottom:0;padding:.7rem .9rem;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;"></div>
    </div>

    <div class="card">
      <h2>รหัสสำหรับเชื่อมต่อจาก Desktop App</h2>
      <p>นำ URL ของเซิร์ฟเวอร์และ <strong>รหัสเชื่อมต่อเซิร์ฟเวอร์</strong> ด้านล่างไปกรอกในหน้าเชื่อมต่อของ Desktop App</p>
      <div class="secret-box" style="margin-bottom:.85rem">
        <code id="connectKeyText">-</code>
        <button class="outline" id="copyKeyBtn">คัดลอกรหัส</button>
        <button class="danger" id="rotateKeyBtn">สร้างรหัสใหม่ (Rotate)</button>
      </div>
      <p id="keyHint" style="margin:0"></p>
    </div>

    <div class="card" id="bootstrapCard" style="display:none">
      <h2>รหัสตั้งค่าร้านครั้งแรก (Bootstrap Secret)</h2>
      <p>ใช้สำหรับตั้งค่าข้อมูลร้านและบัญชีผู้ดูแลระบบคนแรกเมื่อร้านยังไม่ได้ตั้งค่า</p>
      <div class="secret-box">
        <code id="bootstrapText">••••••••••••</code>
        <button class="outline" id="toggleBootstrapBtn">แสดง / ซ่อน</button>
        <button class="outline" id="copyBootstrapBtn">คัดลอก</button>
      </div>
    </div>

    <div class="card">
      <h2>เครื่อง POS ที่ลงทะเบียนและสถานะการเชื่อมต่อ</h2>
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th>ชื่อเครื่อง</th>
              <th>รหัส PIN เครื่อง</th>
              <th>ผู้ใช้งานปัจจุบัน</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody id="devicesBody">
            <tr><td colspan="4">กำลังโหลด...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    ` : `
    <div class="card login-box">
      <h1>เข้าสู่หน้าเว็บผู้ดูแลเซิร์ฟเวอร์</h1>
      <p>กรุณากรอก <strong>รหัสเข้าสู่หน้าเว็บเซิร์ฟเวอร์</strong> ที่แสดงอยู่ในหน้าต่าง Terminal / CMD ของเซิร์ฟเวอร์</p>
      <form id="loginForm">
        <label for="code">รหัสเข้าสู่หน้าเว็บเซิร์ฟเวอร์</label>
        <input id="code" name="code" type="password" autocomplete="off" required autofocus placeholder="เช่น ABCD-EFGH-JKLM" />
        <div class="error" id="loginErr" role="alert"></div>
        <button type="submit" style="width:100%">เข้าสู่ระบบ</button>
      </form>
    </div>
    `}
  </div>
  <script nonce="${nonce}">
    ${authed ? `
    let currentBootstrap = "";
    let bootstrapVisible = false;
    let currentConnectKey = "";

    async function loadOverview() {
      const res = await fetch("/server-admin/api/overview");
      if (res.status === 401) { location.reload(); return; }
      const data = await res.json();
      currentConnectKey = data.security.connectKey || "";
      document.getElementById("connectKeyText").textContent = currentConnectKey;
      document.getElementById("keyHint").textContent = "รหัสเชื่อมต่อรุ่นที่ " + data.security.keyVersion + " (หากสร้างรหัสใหม่ เครื่องที่เคยเชื่อมไว้จะต้องยืนยันรหัสใหม่อีกครั้ง)";

      const up = data.server.uptimeSeconds;
      const mins = Math.floor(up / 60);
      const secs = up % 60;
      document.getElementById("statsGrid").innerHTML = [
        { label: "สถานะฐานข้อมูล", val: data.server.ready ? '<span class="badge ok">พร้อมใช้งาน</span>' : '<span class="badge off">ไม่พร้อม</span>' },
        { label: "สถานะร้านค้า", val: data.store.initialized ? '<span class="badge ok">' + escapeHtml(data.store.name) + '</span>' : '<span class="badge warn">ยังไม่ตั้งค่าร้าน</span>' },
        { label: "เวลาทำงานต่อเนื่อง", val: mins + " นาที " + secs + " วินาที" },
        { label: "CORS (Web Portal)", val: data.server.corsEnabled ? "เปิดใช้งาน" : "ปิดอยู่ (เฉพาะ Desktop)" },
      ].map(s => '<div class="stat"><div class="stat-label">' + s.label + '</div><div class="stat-value">' + s.val + '</div></div>').join("");

      const dbAlert = document.getElementById("dbAlert");
      if (data.server.dbError) {
        dbAlert.textContent = data.server.dbError;
        dbAlert.style.display = "block";
      } else {
        dbAlert.style.display = "none";
      }

      if (data.security.bootstrapSecret) {
        currentBootstrap = data.security.bootstrapSecret;
        document.getElementById("bootstrapCard").style.display = "block";
      }

      const body = document.getElementById("devicesBody");
      if (!data.devices.length) {
        body.innerHTML = '<tr><td colspan="4">ยังไม่มีเครื่อง POS ลงทะเบียน</td></tr>';
      } else {
        body.innerHTML = data.devices.map(d => '<tr>'
          + '<td><strong>' + escapeHtml(d.name) + '</strong></td>'
          + '<td>' + (d.hasPin ? 'ตั้งรหัสแล้ว' : 'ยังไม่ตั้ง') + '</td>'
          + '<td>' + (d.activeUser ? escapeHtml(d.activeUser) + (d.sessionLocked ? ' <span class="badge warn">ล็อกหน้าจอ</span>' : '') : '<span style="color:#64748b">ว่าง</span>') + '</td>'
          + '<td>' + (d.isActive ? '<span class="badge ok">ใช้งาน</span>' : '<span class="badge off">ระงับ</span>') + '</td>'
          + '</tr>').join("");
      }
    }

    function escapeHtml(text) {
      return String(text ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
    }

    document.getElementById("refreshBtn").onclick = loadOverview;
    document.getElementById("logoutBtn").onclick = async () => {
      await fetch("/server-admin/logout", { method: "POST" });
      location.reload();
    };
    document.getElementById("copyKeyBtn").onclick = async () => {
      await navigator.clipboard.writeText(currentConnectKey);
      document.getElementById("copyKeyBtn").textContent = "คัดลอกแล้ว";
      setTimeout(() => { document.getElementById("copyKeyBtn").textContent = "คัดลอกรหัส"; }, 1500);
    };
    document.getElementById("rotateKeyBtn").onclick = async () => {
      if (!confirm("ต้องการสร้างรหัสเชื่อมต่อใหม่ใช่หรือไม่? เครื่องที่เชื่อมต่ออยู่จะต้องกรอกรหัสใหม่")) return;
      const res = await fetch("/server-admin/api/rotate-connect-key", { method: "POST" });
      if (res.ok) await loadOverview();
    };
    document.getElementById("toggleBootstrapBtn").onclick = () => {
      bootstrapVisible = !bootstrapVisible;
      document.getElementById("bootstrapText").textContent = bootstrapVisible ? currentBootstrap : "••••••••••••";
    };
    document.getElementById("copyBootstrapBtn").onclick = async () => {
      await navigator.clipboard.writeText(currentBootstrap);
      document.getElementById("copyBootstrapBtn").textContent = "คัดลอกแล้ว";
      setTimeout(() => { document.getElementById("copyBootstrapBtn").textContent = "คัดลอก"; }, 1500);
    };
    loadOverview();
    ` : `
    document.getElementById("loginForm").onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById("loginErr");
      err.textContent = "";
      const code = document.getElementById("code").value;
      const res = await fetch("/server-admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        err.textContent = data.message || "รหัสผ่านไม่ถูกต้อง";
        return;
      }
      location.reload();
    };
    `}
  </script>
</body>
</html>`;
}
