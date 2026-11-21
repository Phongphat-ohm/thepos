import { afterAll, beforeAll, expect, it } from "vitest";
import { sessionResponseSchema } from "@thepos/contracts";
import { seedRoles } from "../prisma/roles";
import { createApp } from "../src/app";
import { newToken } from "../src/core/security";
import { createServerSecurity } from "../src/core/server-security";
import { isolatedDatabase } from "./isolated-db";

const WEB_ORIGIN = "https://web.thepos.example";
const testDatabase = isolatedDatabase();
const { db } = testDatabase;
const secret = newToken();
const desktopDevice = newToken();
const password = "web portal cors integration password";

const { security } = createServerSecurity({
  signingSecret: newToken(),
  connectKey: "connect-key-1234",
});

const app = createApp(db, {
  jwtSecret: newToken(),
  bootstrapSecret: secret,
  serverSecurity: security,
  corsOrigins: [WEB_ORIGIN],
});

beforeAll(async () => {
  await testDatabase.create();
  testDatabase.migrate();
  await seedRoles(db);
  await security.initPersistence?.(db);

  const serverRes = await app.request("/api/v1/setup/verify-connection", {
    method: "POST",
    headers: { "content-type": "application/json", origin: WEB_ORIGIN },
    body: JSON.stringify({ serverKey: "connect-key-1234" }),
  });
  expect(serverRes.status).toBe(200);
  const { serverToken } = (await serverRes.json()) as { serverToken: string };

  const boot = await app.request("/api/v1/setup/bootstrap", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-server-token": serverToken,
      "x-device-token": desktopDevice,
    },
    body: JSON.stringify({
      username: "admin",
      password,
      pin: "123456",
      secret,
      storeName: "ร้านสหกรณ์เว็บกลาง",
      deviceName: "POS-1",
      displayName: "ผู้ดูแลระบบ",
    }),
  });
  expect(boot.status).toBe(201);
});

afterAll(async () => {
  await testDatabase.drop();
});

it("supports cross-origin central web portal flow (preflight, connect, web enroll, login, refresh, and back-office restriction)", async () => {
  // 1. CORS Preflight OPTIONS does not require x-server-token and returns CORS headers
  const preflight = await app.request("/api/v1/setup/verify-connection", {
    method: "OPTIONS",
    headers: {
      origin: WEB_ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,x-server-token",
    },
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);

  // 2. Verify server connection from Central Web Portal
  const verifyRes = await app.request("/api/v1/setup/verify-connection", {
    method: "POST",
    headers: { "content-type": "application/json", origin: WEB_ORIGIN },
    body: JSON.stringify({ serverKey: "connect-key-1234" }),
  });
  expect(verifyRes.status).toBe(200);
  expect(verifyRes.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
  const { serverToken } = (await verifyRes.json()) as { serverToken: string };

  // 3. Login from cross-origin web portal via /auth/web-login (auto-registers isWebDevice = true, uses x-refresh-token header)
  const webDeviceToken = newToken();
  const loginRes = await app.request("/api/v1/auth/web-login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: WEB_ORIGIN,
      "x-server-token": serverToken,
      "x-device-token": webDeviceToken,
    },
    body: JSON.stringify({ username: "admin", password }),
  });
  expect(loginRes.status).toBe(200);
  const rawLogin = await loginRes.json();
  const session = sessionResponseSchema.parse(rawLogin);
  const effectiveDeviceToken = (rawLogin as { deviceToken?: string }).deviceToken ?? webDeviceToken;
  expect(session.profile.device.isWebDevice).toBe(true);
  expect(session.profile.capabilities).not.toContain("sales:checkout");
  expect(session.profile.capabilities).not.toContain("shift:operate");

  // 4. Access back-office dashboard cross-origin
  const dashRes = await app.request("/api/v1/dashboard", {
    headers: {
      origin: WEB_ORIGIN,
      "x-server-token": serverToken,
      "x-device-token": effectiveDeviceToken,
      authorization: `Bearer ${session.accessToken}`,
    },
  });
  expect(dashRes.status).toBe(200);
  expect(dashRes.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);

  // 5. Refresh access token cross-origin via x-refresh-token header
  const refreshRes = await app.request("/api/v1/auth/refresh", {
    method: "POST",
    headers: {
      origin: WEB_ORIGIN,
      "x-server-token": serverToken,
      "x-device-token": effectiveDeviceToken,
      "x-refresh-token": session.refreshToken,
    },
  });
  expect(refreshRes.status).toBe(200);
  const refreshed = sessionResponseSchema.parse(await refreshRes.json());
  expect(refreshed.accessToken).toBeTruthy();
});
