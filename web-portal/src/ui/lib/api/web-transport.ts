import { sessionResponseSchema, setupStatusSchema } from "@thepos/contracts";
import { z } from "zod";
import { webRoutes, type BusinessRoute } from "./routes";

const WEB_URL_KEY = "thepos/web/server-url";
const COOKIE_REFRESH_MARKER = "__COOKIE__";
const ADMIN_VERIFY_TTL_MS = 90_000;
let webAccess: string | null = null;
let webSessionGen = 0;
let refreshPromise: Promise<string> | null = null;
let webAdminVerifiedAt: number | null = null;

function isWebAdminVerified(): boolean {
  return webAdminVerifiedAt !== null && Date.now() - webAdminVerifiedAt < ADMIN_VERIFY_TTL_MS;
}

export function normalizeWebUrl(value: string, defaultProtocol?: "http:" | "https:"): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw "INVALID_SERVER_URL";
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const proto =
    defaultProtocol ??
    (typeof window !== "undefined" && window.location?.protocol === "http:" ? "http:" : "https:");
  const candidate = hasScheme ? trimmed : `${proto}//${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw "INVALID_SERVER_URL";
  }
  if (
    !(parsed.protocol === "https:" || parsed.protocol === "http:") ||
    !parsed.hostname ||
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

function validateWebUrl(value: string): string {
  return normalizeWebUrl(value);
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
  const serverToken = options.serverToken === undefined ? readWebVault(url, "server-token") : options.serverToken;
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
  webSessionGen += 1;
  webAdminVerifiedAt = null;
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
  const expectedGen = webSessionGen;
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
      if (webSessionGen !== expectedGen) throw "SESSION_LOCKED";
      acceptWebSession(url, value);
      if (!webAccess) throw "NETWORK_ERROR";
      return webAccess;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export function clearWebPortalStorage() {
  webSessionGen += 1;
  webAdminVerifiedAt = null;
  webAccess = null;
  refreshPromise = null;
  if (typeof window === "undefined") return;
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && key.startsWith("thepos/")) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        storage.removeItem(key);
      }
    } catch {
      // Ignore storage access errors during full reset.
    }
  }
}

export async function webExecute(kind: string, data: Record<string, unknown>) {
  if (kind === "reset_connection") {
    clearWebPortalStorage();
    return { url: null, setup: null, lockedUser: null };
  }
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
    const previous = localStorage.getItem(WEB_URL_KEY);
    const verified = (await webFetch(target, "POST", "setup/verify-connection", {
      serverToken: null,
      body: { serverKey },
    })) as { ok?: boolean; serverToken?: string } | null;
    if (!verified?.ok || typeof verified.serverToken !== "string") throw "INVALID_SERVER_KEY";
    webAccess = null;
    webAdminVerifiedAt = null;
    webSessionGen += 1;
    if (previous && previous !== target) removeWebVault(previous, "refresh");
    writeWebVault(target, "server-token", verified.serverToken);
    const result = await webStartup(target);
    localStorage.setItem(WEB_URL_KEY, target);
    return result;
  }

  const saved = localStorage.getItem(WEB_URL_KEY);
  if (!saved) throw "INVALID_SERVER_URL";
  const url = validateWebUrl(saved);

  switch (kind) {
    case "setup_devices":
      return webFetch(url, "GET", "setup/devices", { device: readWebVault(url, "device") });
    case "verify_admin": {
      const res = await webFetch(url, "POST", "setup/verify-admin", {
        device: readWebVault(url, "device"),
        body: data.input,
      });
      webAdminVerifiedAt = Date.now();
      return res;
    }
    case "bootstrap":
    case "enroll": {
      const raw = { ...(data.input as Record<string, unknown>) };
      for (const [k, v] of Object.entries(raw)) {
        if (v === null || v === undefined) delete raw[k];
      }
      const existingDevice = readWebVault(url, "device");
      const hadDevice = existingDevice !== null;
      const isNewEnroll = kind === "enroll" && !("deviceId" in raw) && hadDevice;
      const device = isNewEnroll || !existingDevice ? generateWebToken() : existingDevice;
      const path = kind === "bootstrap" ? "setup/bootstrap" : "devices/enroll";
      try {
        await webFetch(url, "POST", path, { device, body: raw });
        if (!hadDevice || isNewEnroll) writeWebVault(url, "device", device);
        return null;
      } catch (err) {
        if (
          (err === "ALREADY_INITIALIZED" && kind === "bootstrap") ||
          (err === "NETWORK_ERROR" && (!hadDevice || kind === "bootstrap"))
        ) {
          const check = await webCheck(url).catch(() => null);
          if (check?.registered) {
            if (!hadDevice || isNewEnroll) writeWebVault(url, "device", device);
            return null;
          }
        }
        throw err;
      }
    }
    case "login": {
      webAdminVerifiedAt = null;
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
      webSessionGen += 1;
      webAdminVerifiedAt = null;
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
