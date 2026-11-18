import assert from "node:assert/strict";
import { seedRoles } from "../prisma/roles";
import { createApp } from "../src/app";
import { newToken } from "../src/security";
import { isolatedDatabase } from "./isolated-db";

const target = new URL(process.env.TEST_DATABASE_URL ?? "");
assert(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname), "Use a local test PostgreSQL server");
const database = isolatedDatabase();
const secret = newToken();
const device = newToken();
const unregistered = newToken();
const password = newToken();
const timestamp = Date.now();

// In a single reverse-proxy deployment the backend socket sees one peer.
// Forward two distinct client addresses through that peer to test the current limiter.
const app = createApp(database.db, {
  jwtSecret: newToken(), bootstrapSecret: secret, now: () => timestamp,
  clientIp: (request) => upstream.requestIP(request)?.address,
});
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
const proxy = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    return fetch(`http://127.0.0.1:${upstream.port}${new URL(request.url).pathname}`, {
      method: request.method, headers, body: await request.text(),
    });
  },
});

function post(route: string, input: unknown, deviceToken: string, origin: string) {
  return fetch(`http://127.0.0.1:${proxy.port}/api/v1/${route}`, {
    method: "POST", headers: {
      "content-type": "application/json", "x-device-token": deviceToken, "x-forwarded-for": origin,
    }, body: JSON.stringify(input),
  });
}

await database.create();
try {
  database.migrate();
  await seedRoles(database.db);
  assert.equal((await post("setup/bootstrap", {
    secret, username: "admin", password, pin: "012345", displayName: "Security fixture", deviceName: "Local fixture",
    storeName: "Security fixture",
  }, device, "192.0.2.21")).status, 201);
  const login = () => post("auth/login", { username: "admin", password }, device, "192.0.2.21");
  const baseline = await login();
  assert.equal(baseline.status, 200);
  await baseline.arrayBuffer();
  for (let index = 0; index < 60; index++) {
    const rejected = await post("auth/login", { username: "outsider", password }, unregistered, "192.0.2.21, 192.0.2.22");
    assert.equal(rejected.status, 401);
    await rejected.arrayBuffer();
  }
  const attackerExhausted = await post("auth/login", { username: "outsider", password }, unregistered, "192.0.2.22");
  assert.equal(attackerExhausted.status, 429);
  assert.deepEqual(await attackerExhausted.json(), { code: "RATE_LIMITED" });
  const validTerminal = await login();
  assert.equal(validTerminal.status, 200);
  await validTerminal.arrayBuffer();
  console.log("Verified per-client proxy limiter: invalid requests from 192.0.2.22 are rate-limited while 192.0.2.21 remains allowed.");
} finally {
  proxy.stop(true);
  upstream.stop(true);
  await database.drop();
}
