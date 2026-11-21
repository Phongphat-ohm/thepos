import { type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { createServerSecurity } from "../src/core/server-security";
import { createServerAdminApp } from "../src/modules/server-admin/routes";
import { resetServerData, resetTables } from "../src/modules/server-admin/reset";
import { renderHtml } from "../src/modules/server-admin/page";

function setup(bootstrapSecret: string | undefined = "bootstrap-test") {
  const execute = vi.fn().mockResolvedValue(0);
  const transaction = vi.fn(async (run: (tx: unknown) => Promise<void>) => run({ $executeRawUnsafe: execute }));
  const db = { $transaction: transaction } as unknown as PrismaClient;
  const { security } = createServerSecurity({ signingSecret: "server-admin-test-signing-secret", consoleCode: "TEST-CODE" });
  const app = createServerAdminApp(db, { security, bootstrapSecret, host: "127.0.0.1", port: 3000, startedAt: 0, corsEnabled: false, resolveIp: () => "127.0.0.1" });
  const cookie = `thepos_server_admin=${security.createAdminSessionToken()}`;
  const post = (body: unknown, headers: Record<string, string> = {}) => app.request("http://localhost/server-admin/api/reset-data", {
    method: "POST", headers: { origin: "http://localhost", cookie, "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  return { app, db, transaction, execute, post };
}

describe("server-admin reset", () => {
  const valid = { code: "TEST-CODE", confirmation: "ล้างข้อมูลทั้งหมด" };
  it("requires a server-admin session, same-origin request and console reauthentication", async () => {
    const { post, transaction } = setup();
    expect((await post(valid, { cookie: "" })).status).toBe(401);
    expect((await post(valid, { origin: "https://other.example" })).status).toBe(403);
    expect((await post({ ...valid, code: "wrong" })).status).toBe(403);
    expect((await post({ ...valid, confirmation: "yes" })).status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("requires bootstrap credentials so the server can be set up again", async () => {
    const { post, transaction } = setup("");
    expect((await post(valid)).status).toBe(409);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("resets in one transaction and keeps system credentials and grants", async () => {
    const { post, execute, transaction } = setup();
    expect((await post(valid)).status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    const truncate = execute.mock.calls.map(([sql]) => String(sql)).find(sql => sql.startsWith("TRUNCATE"));
    expect(truncate).toContain('"public"."stores"');
    expect(truncate).toContain('"public"."sessions"');
    expect(truncate).toContain('"public"."cash_movements"');
    for (const table of ["roles", "permissions", "role_permissions", "server_security_state", "_prisma_migrations"]) {
      expect(truncate).not.toContain(`"${table}"`);
    }
    expect(truncate).not.toContain("CASCADE");
    expect(execute.mock.calls.filter(([sql]) => String(sql).includes("ENABLE TRIGGER USER"))).toHaveLength(resetTables.length);
  });
  it("reports database failure without reporting success, and permits a later retry", async () => {
    const { post, transaction } = setup();
    transaction.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await post(valid)).status).toBe(503);
    expect((await post(valid)).status).toBe(200);
  });
  it("propagates failures to the transaction instead of swallowing partial resets", async () => {
    const { db, execute } = setup();
    execute.mockRejectedValueOnce(new Error("lock timeout"));
    await expect(resetServerData(db)).rejects.toThrow("lock timeout");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("limits repeated console code attempts", async () => {
    const { post, transaction } = setup();
    for (let i = 0; i < 20; i++) await post({ ...valid, code: "wrong" });
    expect((await post(valid)).status).toBe(429);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("rejects a second reset while a reset is running", async () => {
    const { post, transaction } = setup();
    let finish!: () => void;
    let started!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    transaction.mockImplementationOnce(async () => { started(); await pending; });
    const first = post(valid);
    await entered;
    expect((await post(valid)).status).toBe(409);
    finish();
    expect((await first).status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it("keeps reset controls out of the login page and retains CSP", async () => {
    const { app } = setup();
    const res = await app.request("http://localhost/server-admin");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'nonce-");
    const html = await res.text();
    expect(html).toContain('id="loginForm"');
    expect(html).not.toContain('id="openResetBtn"');
    expect(html).not.toContain("/api/reset-data");
  });
  it.each([true, false])("renders syntactically valid browser JavaScript (authenticated: %s)", authed => {
    const html = renderHtml(authed, "test-nonce");
    const script = html.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  });
});
