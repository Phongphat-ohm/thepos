import { profileSchema, sessionResponseSchema } from "@thepos/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedRoles } from "../prisma/roles";
import { createApp } from "../src/app";
import { accessMs, digest, hashPassword, lockoutMs, newToken, sessionMs } from "../src/security";
import { createServerSecurity } from "../src/server-security";
import { isolatedDatabase } from "./isolated-db";

const testDatabase = isolatedDatabase();
const { db } = testDatabase;
const secret = newToken();
let deviceOne = newToken();
const deviceTwo = newToken();
const competitor = newToken();
const password = "phase one verification password";
const newPassword = "new verification password";
const credentials = { username: "admin", password };
const fixture = {
  ...credentials, secret, pin: "012345", storeName: "สหกรณ์ทดสอบ", displayName: "ผู้ดูแลทดสอบ",
  deviceName: "จุดขาย 1", storeAddress: "กรุงเทพมหานคร", taxId: "0123456789012",
};
let now = Date.now();
const app = createApp(db, { jwtSecret: newToken(), bootstrapSecret: secret, now: () => now });

function call(path: string, options: { input?: unknown; device?: string; access?: string; refresh?: string; post?: boolean } = {}) {
  const headers = new Headers();
  if (options.device) headers.set("x-device-token", options.device);
  if (options.access) headers.set("authorization", "Bearer " + options.access);
  if (options.refresh) headers.set("x-refresh-token", options.refresh);
  if (options.input !== undefined) headers.set("content-type", "application/json");
  return app.request("/api/v1/" + path, {
    headers,
    method: options.post || options.input !== undefined ? "POST" : "GET",
    body: options.input === undefined ? undefined : JSON.stringify(options.input),
  });
}

async function login(device = deviceOne, input = credentials) {
  const result = await call("auth/login", { device, input });
  expect(result.status).toBe(200);
  return sessionResponseSchema.parse(await result.json());
}

beforeAll(async () => {
  await testDatabase.create();
  const notReady = await call("health");
  expect(notReady.status).toBe(503);
  testDatabase.migrate();
  await seedRoles(db);
  await seedRoles(db);
});

afterAll(() => testDatabase.drop());

describe.sequential("Phase 1 against PostgreSQL 16", () => {
  it("reports readiness and allows exactly one authorized bootstrap transaction", async () => {
    expect(await (await call("health")).json()).toEqual({ ready: true });
    expect(await (await call("setup/status")).json()).toEqual({ initialized: false, registered: false });
    expect((await call("setup/bootstrap", { device: deviceOne, input: { ...fixture, secret: newToken() } })).status).toBe(403);
    const responses = await Promise.all([
      call("setup/bootstrap", { device: deviceOne, input: fixture }),
      call("setup/bootstrap", { device: competitor, input: fixture }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await db.store.count()).toBe(1);
    expect(await db.user.count()).toBe(1);
    expect(await db.device.count()).toBe(1);
    // Carry the winning terminal forward while retaining coverage for either transaction ordering.
    if (responses[0].status === 409) deviceOne = competitor;
    expect(await (await call("setup/status", { device: deviceOne })).json()).toEqual({ initialized: true, registered: true });
    expect((await call("setup/bootstrap", { device: deviceOne, input: fixture })).status).toBe(409);
    const store = await db.store.findFirstOrThrow();
    expect(store.vatActive).toBe(false);
    await expect(db.store.create({ data: { name: "Second store", singleton: false } })).rejects.toThrow();
    await expect(db.auditLog.deleteMany()).rejects.toThrow();
    const account = await db.user.findUniqueOrThrow({ where: { username: "admin" } });
    expect(account.passwordHash).toMatch(/^\$argon2id/);
    expect(account.pinHash).toMatch(/^\$argon2id/);
  });

  it("checks server-side permissions for all roles and safely retries terminal enrollment", async () => {
    const enrollment = { ...credentials, deviceName: "จุดขาย 2" };
    expect((await call("devices/enroll", { device: deviceTwo, input: enrollment })).status).toBe(204);
    expect((await call("devices/enroll", { device: deviceTwo, input: enrollment })).status).toBe(204);
    expect(await db.device.count()).toBe(2);
    expect(await db.auditLog.count({ where: { event: "DEVICE_ENROLLED" } })).toBe(1);
    expect(await (await call("setup/status", { device: deviceTwo })).json()).toEqual({ initialized: true, registered: true });
    const store = await db.store.findFirstOrThrow();
    const passwordHash = await hashPassword(password);
    const pinHash = await hashPassword(fixture.pin);
    for (const role of ["MANAGER", "CASHIER", "STOCK_STAFF"] as const) {
      const username = role.toLowerCase();
      await db.user.create({ data: {
        username, name: username, passwordHash, pinHash, storeId: store.id,
        roles: { create: { role: { connect: { code: role } } } },
      } });
      const session = await login(deviceOne, { username, password });
      expect(session.profile.user.roles).toEqual([role]);
      expect(session.profile.permissions).toEqual(["session:use"]);
      expect((await call("devices/enroll", { device: newToken(), input: { ...enrollment, username } })).status).toBe(403);
    }
    const session = await login();
    expect(session.profile.user.roles).toEqual(["ADMIN"]);
    expect(session.profile.permissions).toContain("device:enroll");
    expect((await call("auth/login", { input: credentials })).status).toBe(401);
    expect((await call("auth/me", { device: deviceTwo, access: session.accessToken })).status).toBe(401);
    expect((await call("auth/refresh", { device: deviceTwo, refresh: session.refreshToken, post: true })).status).toBe(401);
    const persisted = await db.session.findUniqueOrThrow({ where: { refreshHash: digest(session.refreshToken) } });
    expect(persisted.refreshHash).not.toBe(session.refreshToken);
  });

  it("expires access, rotates refresh only once, and expires the entire session", async () => {
    const session = await login();
    const start = now;
    now += accessMs + 1000;
    expect((await call("auth/me", { device: deviceOne, access: session.accessToken })).status).toBe(401);
    const attempt = () => call("auth/refresh", { device: deviceOne, refresh: session.refreshToken, post: true });
    const rotated = await Promise.all([attempt(), attempt()]);
    expect(rotated.map((response) => response.status).sort()).toEqual([200, 401]);
    const newer = sessionResponseSchema.parse(await rotated.find((response) => response.ok)!.json());
    expect(newer.refreshToken).not.toBe(session.refreshToken);
    const me = await call("auth/me", { device: deviceOne, access: newer.accessToken });
    expect(profileSchema.parse(await me.json()).device.name).toBe(fixture.deviceName);
    now = start + sessionMs + 1000;
    expect((await call("auth/refresh", { device: deviceOne, refresh: newer.refreshToken, post: true })).status).toBe(401);
  });

  it("locks API access, rate limits PIN attempts, and permits PIN unlock after the cooldown", async () => {
    const session = await login();
    const tokenOptions = { device: deviceOne, refresh: session.refreshToken };
    const locked = await call("auth/lock", { ...tokenOptions, post: true });
    expect(await locked.json()).toEqual({ userName: fixture.displayName });
    expect((await call("auth/me", { device: deviceOne, access: session.accessToken })).status).toBe(423);
    expect((await call("auth/refresh", { ...tokenOptions, post: true })).status).toBe(423);
    for (let i = 1; i <= 5; i++) {
      const invalid = await call("auth/unlock", { ...tokenOptions, input: { pin: "111111" } });
      expect(invalid.status).toBe(i === 5 ? 429 : 401);
    }
    const unlock = () => call("auth/unlock", { ...tokenOptions, input: { pin: fixture.pin } });
    expect((await unlock()).status).toBe(429);
    now += lockoutMs + 1000;
    const result = await unlock();
    expect(result.status).toBe(200);
    const active = sessionResponseSchema.parse(await result.json());
    expect((await call("auth/me", { device: deviceOne, access: active.accessToken })).status).toBe(200);
    expect((await call("auth/me", { device: deviceOne, access: session.accessToken })).status).toBe(401);
    expect((await call("auth/logout", { device: deviceOne, refresh: active.refreshToken, post: true })).status).toBe(204);
    expect((await call("auth/me", { device: deviceOne, access: active.accessToken })).status).toBe(401);
  });

  it("serializes concurrent login failures across devices and revokes all sessions on password change", async () => {
    const wrong = { ...credentials, password: "incorrect" };
    const invalid = await Promise.all(Array.from({ length: 5 }, (_, i) =>
      call("auth/login", { device: i % 2 === 0 ? deviceOne : deviceTwo, input: wrong })));
    expect(invalid.map((response) => response.status).sort()).toEqual([401, 401, 401, 401, 429]);
    expect((await call("auth/login", { device: deviceOne, input: credentials })).status).toBe(429);
    now += lockoutMs + 1000;
    const first = await login();
    const second = await login(deviceTwo);
    const result = await call("auth/change-password", {
      device: deviceOne, access: first.accessToken, input: { currentPassword: password, newPassword },
    });
    expect(result.status).toBe(204);
    expect((await call("auth/me", { device: deviceOne, access: first.accessToken })).status).toBe(401);
    expect((await call("auth/refresh", { device: deviceTwo, refresh: second.refreshToken, post: true })).status).toBe(401);
    await login(deviceOne, { username: "admin", password: newPassword });
    expect(await db.auditLog.count({ where: { event: "PASSWORD_CHANGED" } })).toBe(1);
    const audit = JSON.stringify(await db.auditLog.findMany());
    for (const value of [password, fixture.pin, secret, deviceOne, first.refreshToken]) expect(audit).not.toContain('"' + value + '"');
  });

  it("supports per-browser Web Portal sessions with restricted POS capabilities and persists server keys", async () => {
    const signingSecret = "test-signing-secret-at-least-32-chars";
    const sec1 = createServerSecurity({ signingSecret, consoleCode: "CODE-1111-2222", connectKey: "POS-INIT-1111" });
    await sec1.security.initPersistence?.(db);
    const rotated = await sec1.security.rotateConnectKeyPersisted!(db);

    const sec2 = createServerSecurity({ signingSecret, consoleCode: "CODE-1111-2222", connectKey: "POS-INIT-1111" });
    await sec2.security.initPersistence?.(db);
    expect(sec2.security.verifyConnectKey("POS-INIT-1111")).toBeNull();
    const serverToken = sec2.security.verifyConnectKey(rotated.connectKey);
    expect(serverToken).toBeTruthy();

    const webApp = createApp(db, { jwtSecret: newToken(), bootstrapSecret: secret, serverSecurity: sec2.security });
    const webCreds = { username: "admin", password: newPassword };
    expect((await webApp.request("/api/v1/auth/web-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webCreds),
    })).status).toBe(401);

    const webPost = (path: string, bodyObj: unknown, extra: Record<string, string> = {}) => webApp.request(`/api/v1/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-server-token": serverToken!, ...extra },
      body: JSON.stringify(bodyObj),
    });

    const browserA = await webPost("auth/web-login", webCreds);
    expect(browserA.status).toBe(200);
    const sessionA = await browserA.json() as { accessToken: string; deviceToken: string; profile: { device: { id: string; isWebDevice?: boolean }; permissions: string[] } };
    expect(sessionA.deviceToken).toBeTruthy();
    expect(sessionA.profile.device.isWebDevice).toBe(true);
    expect(sessionA.profile.permissions).not.toContain("sales:checkout");
    expect(sessionA.profile.permissions).not.toContain("shift:operate");

    const browserB = await webPost("auth/web-login", webCreds);
    expect(browserB.status).toBe(200);
    const sessionB = await browserB.json() as { deviceToken: string; profile: { device: { id: string } } };
    expect(sessionB.deviceToken).not.toBe(sessionA.deviceToken);
    expect(sessionB.profile.device.id).not.toBe(sessionA.profile.device.id);

    const browserAReused = await webPost("auth/web-login", webCreds, { "x-device-token": sessionA.deviceToken });
    expect(browserAReused.status).toBe(200);
    const reused = await browserAReused.json() as { accessToken: string; deviceToken: string; profile: { device: { id: string } } };
    expect(reused.deviceToken).toBe(sessionA.deviceToken);
    expect(reused.profile.device.id).toBe(sessionA.profile.device.id);

    expect((await webPost("shifts", { openingFloat: "100.00" }, {
      authorization: "Bearer " + reused.accessToken,
      "x-device-token": sessionA.deviceToken,
    })).status).toBe(403);

    const adminSession = await login(deviceOne, webCreds);
    const disableRes = await app.request(`/api/v1/settings/devices/${sessionA.profile.device.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-device-token": deviceOne,
        authorization: "Bearer " + adminSession.accessToken,
      },
      body: JSON.stringify({ name: "เว็บเบราว์เซอร์ A", isActive: false }),
    });
    expect(disableRes.status).toBe(200);

    const deviceListRes = await app.request("/api/v1/settings/devices?limit=50", {
      headers: { "x-device-token": deviceOne, authorization: "Bearer " + adminSession.accessToken },
    });
    expect(deviceListRes.status).toBe(200);
    const deviceList = await deviceListRes.json() as { items: { id: string; isActive: boolean; isWebDevice?: boolean }[] };
    expect(deviceList.items).toContainEqual(expect.objectContaining({ id: sessionA.profile.device.id, isActive: false, isWebDevice: true }));

    expect((await webPost("auth/web-login", webCreds, { "x-device-token": sessionA.deviceToken })).status).toBe(403);
  });
});
