import { afterAll, beforeAll, expect, it } from "vitest";
import { seedRoles } from "../prisma/roles";
import { createApp } from "../src/app";
import { createServerSecurity } from "../src/core/server-security";
import { createServerAdminApp } from "../src/modules/server-admin/routes";
import { isolatedDatabase } from "./isolated-db";
import { newToken } from "../src/core/security";

const database = isolatedDatabase();
const { db } = database;
const bootstrapSecret = newToken();
const deviceToken = newToken();
const { security } = createServerSecurity({ signingSecret: "isolated-server-reset-signing-secret", consoleCode: "RESET-TEST" });
const app = createServerAdminApp(db, { security, bootstrapSecret, host: "localhost", port: 3000, startedAt: Date.now(), corsEnabled: false });
const setupApp = createApp(db, { jwtSecret: newToken(), bootstrapSecret });
const bootstrap = () => setupApp.request("/api/v1/setup/bootstrap", {
  method: "POST", headers: { "content-type": "application/json", "x-device-token": deviceToken },
  body: JSON.stringify({ secret: bootstrapSecret, username: "admin", password: "integration password", pin: "012345", displayName: "ผู้ดูแล", deviceName: "เครื่องทดสอบ", storeName: "ร้านทดสอบ" }),
});
beforeAll(async () => { await database.create(); database.migrate(); await seedRoles(db); await security.initPersistence!(db); });
afterAll(() => database.drop());

it("clears an isolated database, preserves system setup and restores append-only guards", async () => {
  expect((await bootstrap()).status).toBe(201);
  const state = await db.serverSecurityState.findFirstOrThrow();
  const grants = await db.rolePermission.count();
  expect(await db.auditLog.count()).toBeGreaterThan(0);
  const reset = () => app.request("http://localhost/server-admin/api/reset-data", {
    method: "POST", headers: { origin: "http://localhost", cookie: `thepos_server_admin=${security.createAdminSessionToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ code: "RESET-TEST", confirmation: "ล้างข้อมูลทั้งหมด" }),
  });
  // An unexpected referencing table must fail safely instead of being cascaded away.
  await db.$executeRawUnsafe('CREATE TABLE reset_failure_probe (store_id uuid REFERENCES stores(id))');
  expect((await reset()).status).toBe(503);
  expect(await db.store.count()).toBe(1);
  await expect(db.auditLog.deleteMany()).rejects.toThrow();
  await db.$executeRawUnsafe('DROP TABLE reset_failure_probe');
  const response = await reset();
  expect(await response.json()).toEqual({ ok: true });
  expect(await db.store.count()).toBe(0);
  expect(await db.user.count()).toBe(0);
  expect(await db.device.count()).toBe(0);
  expect(await db.session.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
  expect(await db.role.count()).toBe(4);
  expect(await db.rolePermission.count()).toBe(grants);
  expect(await db.serverSecurityState.findFirstOrThrow()).toEqual(state);
  expect((await bootstrap()).status).toBe(201);
  await expect(db.$executeRawUnsafe('TRUNCATE TABLE "audit_logs"')).rejects.toThrow();
  await expect(db.auditLog.deleteMany()).rejects.toThrow();
  const disabled = await db.$queryRaw<{ tgname: string }[]>`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'D'`;
  expect(disabled).toEqual([]);
});
