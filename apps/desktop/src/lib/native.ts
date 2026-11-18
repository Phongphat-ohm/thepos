import { invoke } from "@tauri-apps/api/core";
import {
  bootstrapSchema, enrollableDeviceSchema, enrollSchema, errorCodeSchema, loginSchema, profileSchema, sessionResponseSchema, setupStatusSchema,
  type EnrollableDevice, type ErrorCode,
} from "@thepos/contracts";
import { z } from "zod";

export const isDesktopApp = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const connectionSchema = z.object({
  url: z.string().nullable(),
  setup: setupStatusSchema.nullable(),
  lockedUser: z.string().nullable(),
});

export type Connection = z.infer<typeof connectionSchema>;
const messages: Record<ErrorCode, string> = {
  INVALID_INPUT: "กรุณาตรวจสอบข้อมูลที่กรอกแล้วลองอีกครั้ง",
  INVALID_CREDENTIALS: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
  INVALID_BOOTSTRAP_SECRET: "รหัสตั้งค่าระบบไม่ถูกต้อง กรุณาตรวจสอบกับผู้ดูแลเซิร์ฟเวอร์",
  INVALID_SERVER_KEY: "รหัสเชื่อมต่อเซิร์ฟเวอร์ไม่ถูกต้อง กรุณาตรวจสอบจากหน้าเว็บผู้ดูแลเซิร์ฟเวอร์",
  DEVICE_REQUIRED: "เครื่องนี้ยังไม่ได้ลงทะเบียนหรือถูกระงับการใช้งาน",
  SESSION_REQUIRED: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง",
  SESSION_LOCKED: "หน้าจอถูกล็อก กรุณาปลดล็อกหรือออกจากระบบก่อน",
  INVALID_PIN: "PIN ไม่ถูกต้อง กรุณาลองอีกครั้ง",
  RATE_LIMITED: "ลองหลายครั้งเกินกำหนด กรุณารอสักครู่แล้วลองใหม่",
  FORBIDDEN: "บัญชีนี้ไม่มีสิทธิ์ทำรายการ",
  ALREADY_INITIALIZED: "ร้านค้าถูกตั้งค่าแล้ว กรุณากลับไปตรวจการเชื่อมต่อเพื่อลงทะเบียนเครื่อง",
  SETUP_REQUIRED: "ยังไม่มีข้อมูลร้านค้า กรุณาตั้งค่าร้านก่อน",
  NOT_FOUND: "ไม่พบ API ที่รองรับ กรุณาตรวจสอบที่อยู่เซิร์ฟเวอร์",
  UNAVAILABLE: "เซิร์ฟเวอร์ยังไม่พร้อมใช้งาน กรุณาลองอีกครั้ง",
  NETWORK_ERROR: "ติดต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่",
  INVALID_SERVER_URL: "กรุณากรอกที่อยู่เซิร์ฟเวอร์ HTTPS โดยไม่ระบุเส้นทาง",
  SECURE_STORAGE_ERROR: "อ่านหรือบันทึกข้อมูลใน Windows Credential Manager ไม่ได้",
  DUPLICATE_RECORD: "มีรหัสหรือชื่อนี้อยู่ในระบบแล้ว",
  INVALID_REFERENCE: "ไม่พบรายการที่เลือกหรือรายการถูกปิดใช้งาน",
  SUPPLIER_INACTIVE: "ผู้จัดจำหน่ายรายนี้พักใช้งานแล้ว กรุณาเลือกผู้จัดจำหน่ายที่เปิดใช้งาน",
  STOCK_CONFIGURATION_LOCKED: "สินค้านี้มีประวัติสต็อกแล้ว จึงเปลี่ยนหน่วยหลักหรือวิธีติดตามสต็อกไม่ได้",
  INVALID_QUANTITY: "จำนวนสินค้าไม่ถูกต้องหรือแปลงเป็นหน่วยหลักไม่ได้",
  EXPIRATION_REQUIRED: "กรุณาระบุวันหมดอายุของสินค้าล็อตนี้",
  IDEMPOTENCY_CONFLICT: "รหัสรายการนี้ถูกใช้กับข้อมูลชุดอื่นแล้ว",
  INSUFFICIENT_STOCK: "สินค้าคงเหลือไม่เพียงพอ",
  STOCK_COUNT_STALE: "ยอดล็อตเปลี่ยนแล้ว กรุณาตรวจนับอีกครั้งจากยอดล่าสุด",
  STOCK_COUNT_CONFLICT: "ใบตรวจนับนี้ได้รับการตัดสินแล้ว กรุณาโหลดรายการล่าสุด",
  PRICE_CHANGED: "ราคาสินค้าเปลี่ยนแล้ว กรุณาตรวจสอบราคาอีกครั้ง",
  PAYMENT_MISMATCH: "จำนวนเงินที่ชำระไม่ตรงกับยอดสุทธิ หรือเงินสดที่รับมาไม่พอ",
  INVALID_DISCOUNT: "ส่วนลดเกินยอดสินค้าหรือยอดบิล",
  APPROVAL_REQUIRED: "รายการนี้ต้องใช้ PIN ผู้จัดการ",
  HELD_CONFLICT: "บิลถูกเปิดหรือแก้ไขจากอีกเครื่อง กรุณาโหลดบิลล่าสุด",
  RETURN_LIMIT: "ยอดหรือจำนวนที่คืนได้เปลี่ยนแล้ว กรุณาตรวจสอบบิลและคำนวณใหม่",
  PRINT_FAILED: "ส่งงานพิมพ์ไม่สำเร็จ กรุณาตรวจสอบคิวพิมพ์และเครื่องพิมพ์",
  MEMBER_KEY_REQUIRED: "ยังบันทึกเลขบัตรประชาชนไม่ได้ กรุณาติดต่อผู้ดูแลเซิร์ฟเวอร์",
  SHARE_ACCOUNT_CONFLICT: "สถานะบัญชีหุ้นหรือมูลค่าต่อหุ้นไม่ตรงกับรายการ กรุณาตรวจสอบบัญชีที่เกี่ยวข้อง",
  INSUFFICIENT_SHARES: "จำนวนหุ้นคงเหลือไม่พอสำหรับรายการนี้",
  INVALID_SHARE_DATE: "วันที่มีผลต้องไม่ก่อนวันสมัครหรือรายการหุ้นล่าสุด และต้องไม่เกินวันนี้",
  PERIOD_CONFLICT: "วันที่งวดทับซ้อนกับงวดอื่น หรือมีรายการปรับยอดในงวดนี้แล้ว",
  PERIOD_LOCKED: "ไม่สามารถบันทึกรายการนี้ในสถานะงวดปัจจุบัน ตรวจสอบวันที่มีผลหรือสถานะงวด",
  INVALID_PERIOD_DATES: "ตรวจสอบช่วงวันที่ของงวดและสูตรที่เลือก งวดต้องสิ้นสุดก่อนอนุมัติ",
  PREVIEW_STALE: "ข้อมูลหรือผลจำลองเปลี่ยนแล้ว กรุณาคำนวณใหม่และตรวจผลก่อนอนุมัติ",
  PAYOUT_LIMIT: "จำนวนเงินเกินยอดคงค้าง หรืองวดยังมียอดที่ต้องจ่าย กรุณาโหลดข้อมูลล่าสุด",
  FINANCIAL_LIMIT: "ยอดคำนวณอยู่นอกช่วงที่รองรับ กรุณาตรวจสอบยอดหุ้นและยอดซื้อของสมาชิก",
  SHIFT_REQUIRED: "กรุณาเปิดกะเงินสดที่เครื่องนี้ก่อนทำรายการ",
  SHIFT_CONFLICT: "เครื่องนี้มีกะเปิดอยู่หรือกะถูกปิดแล้ว กรุณาตรวจสอบกะล่าสุด",
  SHIFT_STALE: "มีรายการเงินสดเพิ่มหลังจากเปิดหน้านี้ กรุณาโหลดกะล่าสุดและตรวจนับอีกครั้ง",
  CASH_LIMIT: "ยอดเงินในลิ้นชักไม่พอ หรือจำนวนเงินเกินช่วงที่รองรับ",
  DEVICE_IN_USE: "เครื่อง POS นี้กำลังมีผู้ใช้งานอยู่ (ห้ามเลือกซ้ำ) หรือมีประวัติทำรายการในระบบแล้วจึงลบไม่ได้",
  RECORD_IN_USE: "รายการนี้ถูกใช้งานในประวัติระบบแล้วจึงลบไม่ได้ (สามารถระงับการใช้งานแทนได้)",
};

export function errorCode(error: unknown) {
  return errorCodeSchema.safeParse(error).data;
}

export function errorMessage(error: unknown) {
  return messages[errorCode(error) ?? "NETWORK_ERROR"];
}

function request<T = unknown>(kind: string, data: Record<string, unknown> = {}) {
  if (isDesktopApp()) return invoke<T>("pos_request", { command: { kind, ...data } });
  return webExecute(kind, data) as Promise<T>;
}

const webRoutes: Record<BusinessRoute, [string, string]> = {
  dashboard: ["GET", "dashboard"],
  store_settings: ["GET", "settings/store"],
  update_store_settings: ["PUT", "settings/store"],
  users: ["GET", "settings/users"],
  create_user: ["POST", "settings/users"],
  update_user: ["PUT", "settings/users/:id"],
  delete_user: ["DELETE", "settings/users/:id"],
  devices: ["GET", "settings/devices"],
  create_device: ["POST", "settings/devices"],
  update_device: ["PATCH", "settings/devices/:id"],
  delete_device: ["DELETE", "settings/devices/:id"],
  audit_logs: ["GET", "settings/audit-logs"],
  change_password: ["POST", "auth/change-password"],
  reports: ["GET", "reports"],
  shifts: ["GET", "shifts"],
  open_shift: ["POST", "shifts"],
  shift_detail: ["GET", "shifts/:id"],
  shift_movement: ["POST", "shifts/:id/movements"],
  close_shift: ["POST", "shifts/:id/close"],
  products: ["GET", "catalog/products"],
  create_product: ["POST", "catalog/products"],
  update_product: ["PUT", "catalog/products/:id"],
  categories: ["GET", "catalog/categories"],
  create_category: ["POST", "catalog/categories"],
  suppliers: ["GET", "catalog/suppliers"],
  create_supplier: ["POST", "catalog/suppliers"],
  update_supplier: ["PUT", "catalog/suppliers/:id"],
  set_supplier_status: ["PATCH", "catalog/suppliers/:id/status"],
  lots: ["GET", "inventory/lots"],
  movements: ["GET", "inventory/movements"],
  receive: ["POST", "inventory/receipts"],
  import_preview: ["POST", "catalog/import/preview"],
  import_commit: ["POST", "catalog/import/commit"],
  stock_counts: ["GET", "inventory/counts"],
  submit_count: ["POST", "inventory/counts"],
  review_count: ["POST", "inventory/counts/:id/review"],
  pos_lookup: ["GET", "sales/products"],
  pos_categories: ["GET", "sales/categories"],
  pos_members: ["GET", "sales/members"],
  add_member: ["POST", "sales/members"],
  members: ["GET", "members"],
  member_detail: ["GET", "members/:id"],
  create_member: ["POST", "members"],
  update_member: ["PUT", "members/:id"],
  member_purchases: ["GET", "members/:id/purchases"],
  member_shares: ["GET", "members/:id/shares"],
  post_shares: ["POST", "members/:id/shares"],
  dividend_rules: ["GET", "dividends/rules"],
  create_dividend_rule: ["POST", "dividends/rules"],
  accounting_periods: ["GET", "dividends/periods"],
  create_accounting_period: ["POST", "dividends/periods"],
  update_accounting_period: ["PUT", "dividends/periods/:id"],
  calculate_dividend: ["POST", "dividends/periods/:id/preview"],
  dividend_preview: ["GET", "dividends/periods/:id/preview"],
  approve_dividend: ["POST", "dividends/periods/:id/approve"],
  adjust_purchases: ["POST", "dividends/periods/:id/adjustments"],
  close_accounting_period: ["POST", "dividends/periods/:id/close"],
  payout_obligations: ["GET", "dividends/periods/:id/obligations"],
  payout_history: ["GET", "dividends/obligations/:id/payouts"],
  post_payout: ["POST", "dividends/obligations/:id/payouts"],
  held_list: ["GET", "sales/held"],
  hold_bill: ["PUT", "sales/held/:id"],
  resume_bill: ["POST", "sales/held/:id/resume"],
  sales_history: ["GET", "sales"],
  sale_detail: ["GET", "sales/:id"],
  checkout: ["POST", "sales"],
  return_quote: ["POST", "sales/:id/returns/quote"],
  return_sale: ["POST", "sales/:id/returns"],
};

const WEB_URL_KEY = "thepos/web/server-url";
const COOKIE_REFRESH_MARKER = "__COOKIE__";
let webAccess: string | null = null;
let refreshPromise: Promise<string> | null = null;

function validateWebUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw "INVALID_SERVER_URL";
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    !(parsed.protocol === "https:" || (loopback && parsed.protocol === "http:")) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    throw "INVALID_SERVER_URL";
  }
  return parsed.origin;
}

function webStorage(kind: "device" | "refresh" | "server-token") {
  return kind === "refresh" ? sessionStorage : localStorage;
}

function readWebVault(url: string, kind: "device" | "refresh" | "server-token"): string | null {
  try {
    return webStorage(kind).getItem(`thepos/web/${kind}/${url}`);
  } catch {
    throw "SECURE_STORAGE_ERROR";
  }
}

function writeWebVault(url: string, kind: "device" | "refresh" | "server-token", value: string) {
  try {
    webStorage(kind).setItem(`thepos/web/${kind}/${url}`, value);
  } catch {
    throw "SECURE_STORAGE_ERROR";
  }
}

function removeWebVault(url: string, kind: "device" | "refresh" | "server-token") {
  try {
    webStorage(kind).removeItem(`thepos/web/${kind}/${url}`);
  } catch {
    throw "SECURE_STORAGE_ERROR";
  }
}

function generateWebToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function prepareWebDevice(url: string): string {
  const existing = readWebVault(url, "device");
  if (existing) return existing;
  const token = generateWebToken();
  writeWebVault(url, "device", token);
  return token;
}

function isSameOriginUrl(url: string): boolean {
  return typeof window !== "undefined" && window.location.origin === url;
}

async function webFetch(
  url: string,
  method: string,
  path: string,
  options: {
    device?: string | null;
    refresh?: string | null;
    access?: string | null;
    serverToken?: string | null;
    useCookieAuth?: boolean;
    key?: string;
    query?: Record<string, unknown>;
    body?: unknown;
  } = {},
) {
  const headers = new Headers({ accept: "application/json" });
  const serverToken = options.serverToken ?? readWebVault(url, "server-token");
  if (serverToken) headers.set("x-server-token", serverToken);
  if (options.device) headers.set("x-device-token", options.device);
  if (options.refresh && options.refresh !== COOKIE_REFRESH_MARKER) headers.set("x-refresh-token", options.refresh);
  if (options.useCookieAuth) headers.set("x-web-auth", "cookie");
  if (options.access) headers.set("authorization", `Bearer ${options.access}`);
  if (options.key) headers.set("idempotency-key", options.key);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined && v !== null) search.set(k, String(v));
  }
  const target = `${url}/api/v1/${path}${search.size ? `?${search.toString()}` : ""}`;
  let response: Response;
  try {
    response = await fetch(target, {
      method,
      headers,
      credentials: isSameOriginUrl(url) ? "same-origin" : "omit",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw "NETWORK_ERROR";
  }
  if (response.status === 204) return null;
  if (response.status === 201 && (path === "setup/bootstrap" || path === "devices/enroll")) return null;
  const replayed = response.headers.get("idempotency-replayed");
  let payload: Record<string, unknown>;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    throw "NETWORK_ERROR";
  }
  if (!response.ok) {
    if (payload?.code === "INVALID_SERVER_KEY") {
      removeWebVault(url, "server-token");
    }
    throw typeof payload?.code === "string" ? payload.code : "NETWORK_ERROR";
  }
  return replayed !== null ? { sale: payload, replayed: replayed === "true" } : payload;
}

async function webCheck(url: string) {
  const health = (await webFetch(url, "GET", "health")) as { ready?: boolean } | null;
  if (health?.ready !== true) throw "NETWORK_ERROR";
  const device = readWebVault(url, "device");
  return setupStatusSchema.parse(await webFetch(url, "GET", "setup/status", { device }));
}

async function webLock(url: string) {
  webAccess = null;
  const device = readWebVault(url, "device");
  const refresh = readWebVault(url, "refresh");
  if (!device) throw "DEVICE_REQUIRED";
  if (!refresh) throw "SESSION_REQUIRED";
  return (await webFetch(url, "POST", "auth/lock", { device, refresh })) as { userName?: string };
}

async function webStartup(url: string) {
  const status = await webCheck(url);
  let lockedUser: string | null = null;
  if (status.initialized) {
    if (readWebVault(url, "device") && readWebVault(url, "refresh")) {
      try {
        const result = await webLock(url);
        lockedUser = typeof result?.userName === "string" ? result.userName : null;
      } catch (err) {
        if (err === "SESSION_REQUIRED" || err === "DEVICE_REQUIRED" || err === "FORBIDDEN") {
          removeWebVault(url, "refresh");
        } else {
          throw err;
        }
      }
    }
    return { url, setup: { initialized: true, registered: true }, lockedUser };
  }
  removeWebVault(url, "refresh");
  return { url, setup: status, lockedUser };
}

const webSessionResponseSchema = sessionResponseSchema.extend({
  refreshToken: sessionResponseSchema.shape.refreshToken.optional(),
  cookieAuth: z.boolean().optional(),
  deviceToken: z.string().optional(),
});

function acceptWebSession(url: string, value: unknown) {
  const session = webSessionResponseSchema.parse(value);
  if (session.cookieAuth) {
    writeWebVault(url, "refresh", COOKIE_REFRESH_MARKER);
  } else if (session.refreshToken) {
    writeWebVault(url, "refresh", session.refreshToken);
  } else {
    throw "NETWORK_ERROR";
  }
  webAccess = session.accessToken;
  return session.profile;
}

async function refreshWebAccess(url: string, failedToken: string): Promise<string> {
  if (webAccess && webAccess !== failedToken) return webAccess;
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const device = readWebVault(url, "device");
      const refresh = readWebVault(url, "refresh");
      if (!device) throw "DEVICE_REQUIRED";
      if (!refresh) throw "SESSION_REQUIRED";
      const value = await webFetch(url, "POST", "auth/refresh", {
        device,
        refresh,
        useCookieAuth: isSameOriginUrl(url),
      });
      acceptWebSession(url, value);
      if (!webAccess) throw "NETWORK_ERROR";
      return webAccess;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function webExecute(kind: string, data: Record<string, unknown>) {
  if (kind === "startup") {
    let saved = localStorage.getItem(WEB_URL_KEY);
    if (!saved && typeof window !== "undefined") {
      try {
        const origin = validateWebUrl(window.location.origin);
        const health = (await webFetch(origin, "GET", "health")) as { ready?: boolean } | null;
        if (health?.ready === true) {
          localStorage.setItem(WEB_URL_KEY, origin);
          saved = origin;
        }
      } catch {
        // Prompt user to enter server URL if current origin does not host the API.
      }
    }
    if (!saved) return { url: null, setup: null, lockedUser: null };
    try {
      return await webStartup(validateWebUrl(saved));
    } catch (err) {
      if (err === "INVALID_SERVER_KEY") {
        return { url: saved, setup: null, lockedUser: null };
      }
      throw err;
    }
  }
  if (kind === "connect") {
    const target = validateWebUrl(String(data.url ?? ""));
    const serverKey = String(data.server_key ?? "").trim();
    if (!serverKey) throw "INVALID_SERVER_KEY";
    if (webAccess) throw "SESSION_LOCKED";
    const verified = (await webFetch(target, "POST", "setup/verify-connection", {
      serverToken: null,
      body: { serverKey },
    })) as { ok?: boolean; serverToken?: string } | null;
    if (!verified?.ok || typeof verified.serverToken !== "string") throw "INVALID_SERVER_KEY";
    writeWebVault(target, "server-token", verified.serverToken);
    const result = await webStartup(target);
    const previous = localStorage.getItem(WEB_URL_KEY);
    if (previous && previous !== target) removeWebVault(previous, "refresh");
    localStorage.setItem(WEB_URL_KEY, target);
    return result;
  }

  const saved = localStorage.getItem(WEB_URL_KEY);
  if (!saved) throw "INVALID_SERVER_URL";
  const url = validateWebUrl(saved);

  switch (kind) {
    case "setup_devices":
      return webFetch(url, "GET", "setup/devices", { device: readWebVault(url, "device") });
    case "bootstrap":
    case "enroll": {
      const raw = { ...(data.input as Record<string, unknown>) };
      for (const [k, v] of Object.entries(raw)) {
        if (v === null || v === undefined) delete raw[k];
      }
      const hadDevice = readWebVault(url, "device") !== null;
      const isNewEnroll = kind === "enroll" && !("deviceId" in raw) && hadDevice;
      const device = isNewEnroll ? generateWebToken() : prepareWebDevice(url);
      if (isNewEnroll) writeWebVault(url, "device", device);
      const path = kind === "bootstrap" ? "setup/bootstrap" : "devices/enroll";
      try {
        await webFetch(url, "POST", path, { device, body: raw });
        return null;
      } catch (err) {
        if (
          (err === "ALREADY_INITIALIZED" && kind === "bootstrap") ||
          (err === "NETWORK_ERROR" && (!hadDevice || kind === "bootstrap"))
        ) {
          const check = await webCheck(url).catch(() => null);
          if (check?.registered) return null;
        }
        throw err;
      }
    }
    case "login": {
      if (readWebVault(url, "refresh")) throw "SESSION_LOCKED";
      const existingDevice = readWebVault(url, "device");
      const value = (await webFetch(url, "POST", "auth/web-login", {
        device: existingDevice,
        useCookieAuth: isSameOriginUrl(url),
        body: data.input,
      })) as { deviceToken?: unknown } & Record<string, unknown>;
      if (typeof value?.deviceToken !== "string") throw "NETWORK_ERROR";
      writeWebVault(url, "device", value.deviceToken);
      return acceptWebSession(url, value);
    }
    case "profile": {
      const device = readWebVault(url, "device");
      if (!device) throw "DEVICE_REQUIRED";
      if (!webAccess) throw "SESSION_LOCKED";
      const initial = webAccess;
      try {
        return await webFetch(url, "GET", "auth/me", { device, access: initial });
      } catch (err) {
        if (err === "SESSION_REQUIRED") {
          const refreshed = await refreshWebAccess(url, initial);
          return await webFetch(url, "GET", "auth/me", { device, access: refreshed });
        }
        throw err;
      }
    }
    case "lock":
      return webLock(url);
    case "unlock": {
      if (webAccess) await webLock(url);
      const device = readWebVault(url, "device");
      const refresh = readWebVault(url, "refresh");
      if (!device) throw "DEVICE_REQUIRED";
      if (!refresh) throw "SESSION_REQUIRED";
      const value = await webFetch(url, "POST", "auth/unlock", {
        device,
        refresh,
        useCookieAuth: isSameOriginUrl(url),
        body: { pin: String(data.pin ?? "") },
      });
      return acceptWebSession(url, value);
    }
    case "logout": {
      webAccess = null;
      const device = readWebVault(url, "device");
      const refresh = readWebVault(url, "refresh");
      if (device && refresh) {
        try {
          await webFetch(url, "POST", "auth/logout", { device, refresh });
        } catch {
          // Best-effort revocation; always clear local refresh token below.
        }
      }
      removeWebVault(url, "refresh");
      return null;
    }
    case "business": {
      const route = data.route as BusinessRoute;
      const entry = webRoutes[route];
      if (!entry) throw "INVALID_INPUT";
      const [method, template] = entry;
      let endpoint = template;
      if (template.includes(":id")) {
        const id = typeof data.id === "string" ? data.id : "";
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
          throw "INVALID_INPUT";
        }
        endpoint = template.replace(":id", id);
      }
      const device = readWebVault(url, "device");
      if (!device) throw "DEVICE_REQUIRED";
      if (!webAccess) throw "SESSION_LOCKED";
      const initial = webAccess;
      const callWith = (access: string) =>
        webFetch(url, method, endpoint, {
          device,
          access,
          key: typeof data.key === "string" ? data.key : undefined,
          query: data.query as Record<string, unknown> | undefined,
          body: data.input,
        });
      try {
        return await callWith(initial);
      } catch (err) {
        if (err === "SESSION_REQUIRED") {
          const refreshed = await refreshWebAccess(url, initial);
          return await callWith(refreshed);
        }
        throw err;
      }
    }
    default:
      throw "INVALID_INPUT";
  }
}

type BusinessRoute = "products" | "create_product" | "update_product"
  | "dashboard" | "reports" | "shifts" | "open_shift" | "shift_detail" | "shift_movement" | "close_shift"
  | "store_settings" | "update_store_settings"
  | "users" | "create_user" | "update_user" | "delete_user" | "devices" | "create_device" | "update_device" | "delete_device" | "audit_logs" | "change_password"
  | "categories" | "create_category" | "suppliers" | "create_supplier" | "update_supplier" | "set_supplier_status"
  | "lots" | "movements" | "receive" | "import_preview" | "import_commit"
  | "stock_counts" | "submit_count" | "review_count"
  | "pos_lookup" | "pos_categories" | "pos_members" | "add_member" | "held_list" | "hold_bill" | "resume_bill"
  | "members" | "member_detail" | "create_member" | "update_member" | "member_purchases" | "member_shares" | "post_shares"
  | "dividend_rules" | "create_dividend_rule" | "accounting_periods" | "create_accounting_period" | "update_accounting_period"
  | "calculate_dividend" | "dividend_preview" | "approve_dividend" | "adjust_purchases" | "close_accounting_period"
  | "payout_obligations" | "payout_history" | "post_payout"
  | "sales_history" | "sale_detail" | "checkout" | "return_quote" | "return_sale";
type BusinessOptions = {
  query?: {
    q?: string; after?: string; productId?: string; limit?: number; mode?: "search" | "barcode" | "browse"; categoryId?: string;
    receivable?: "true"; stockTracked?: "true"; activeOnly?: "true"; excludeId?: string;
    kind?: string; start?: string; end?: string;
    status?: string;
    page?: number; sortBy?: string; sortDir?: "asc" | "desc"; sortCol?: number; event?: string;
  };
  id?: string;
  key?: string;
  input?: unknown;
};

export function business<T>(route: BusinessRoute, options: BusinessOptions = {}) {
  return request<T>("business", { route, ...options });
}

const setupDevicesSchema = z.object({ items: z.array(enrollableDeviceSchema) });

export const native = {
  startup: async () => connectionSchema.parse(await request("startup")),
  setupDevices: async (): Promise<EnrollableDevice[]> => setupDevicesSchema.parse(await request("setup_devices")).items,
  connect: async (url: string, serverKey: string) =>
    connectionSchema.parse(await request("connect", { url, server_key: serverKey })),
  bootstrap: (input: z.infer<typeof bootstrapSchema>) => request("bootstrap", { input }),
  enroll: (input: z.infer<typeof enrollSchema>) => request("enroll", { input }),
  login: async (input: z.infer<typeof loginSchema>) => profileSchema.parse(await request("login", { input })),
  profile: async () => profileSchema.parse(await request("profile")),
  lock: () => request("lock"),
  unlock: async (pin: string) => profileSchema.parse(await request("unlock", { pin })),
  logout: () => request("logout"),
  openWeb: () => (isDesktopApp() ? invoke<void>("open_web") : Promise.resolve()),
};
