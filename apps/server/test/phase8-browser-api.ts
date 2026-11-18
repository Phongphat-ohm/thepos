import type { SessionResponse } from "@thepos/contracts";
import { seedRoles } from "../prisma/roles";
import { createApp } from "../src/app";
import { newToken } from "../src/security";
import { isolatedDatabase } from "./isolated-db";

const target = new URL(process.env.TEST_DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) throw new Error("Use a local test PostgreSQL server");

const database = isolatedDatabase();
const secret = newToken();
const device = newToken();
const password = "acceptance tests local only";
const app = createApp(database.db, { jwtSecret: newToken(), bootstrapSecret: secret });
const routes = new Map<string, [string, string]>([
  ["dashboard", ["GET", "dashboard"]],
  ["reports", ["GET", "reports"]],
  ["shifts", ["GET", "shifts"]],
  ["open_shift", ["POST", "shifts"]],
  ["shift_detail", ["GET", "shifts/:id"]],
  ["checkout", ["POST", "sales"]],
  ["store_settings", ["GET", "settings/store"]],
  ["update_store_settings", ["PUT", "settings/store"]],
  ["users", ["GET", "settings/users"]],
  ["create_user", ["POST", "settings/users"]],
  ["update_user", ["PUT", "settings/users/:id"]],
  ["devices", ["GET", "settings/devices"]],
  ["update_device", ["PATCH", "settings/devices/:id"]],
  ["change_password", ["POST", "auth/change-password"]],
  ["pos_lookup", ["GET", "sales/products"]],
  ["pos_categories", ["GET", "sales/categories"]],
  ["pos_members", ["GET", "sales/members"]],
  ["sales_history", ["GET", "sales"]],
  ["sale_detail", ["GET", "sales/:id"]],
]);
const headers = {
  "access-control-allow-origin": "http://127.0.0.1:1434",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
type BrowserCommand = {
  kind: string;
  route?: string;
  id?: string;
  key?: string;
  pin?: string;
  input?: unknown;
  query?: Record<string, string | number>;
};
let token = "";
let refresh = "";

async function call<T = unknown>(path: string, method = "GET", input?: unknown, key?: string): Promise<T> {
  const response = await app.request("/api/v1/" + path, {
    method,
    headers: {
      "content-type": "application/json", "x-device-token": device, authorization: "Bearer " + token,
      ...(refresh && { "x-refresh-token": refresh }), ...(key && { "idempotency-key": key }),
    },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;
  if (!response.ok) throw new Error(data?.code ?? "UNAVAILABLE");
  const replayed = response.headers.get("Idempotency-Replayed");
  return (replayed === null ? data : { sale: data, replayed: replayed === "true" }) as T;
}

function acceptSession(session: SessionResponse) {
  token = session.accessToken;
  refresh = session.refreshToken;
  return session.profile;
}

// This adapter is loopback-only and uses the same response shape as Tauri.
async function invoke(command: BrowserCommand) {
  switch (command.kind) {
    case "startup":
      return { url: "http://127.0.0.1:1436", setup: { initialized: true, registered: true }, lockedUser: null };
    case "login":
      return acceptSession(await call<SessionResponse>("auth/login", "POST", command.input));
    case "profile":
      return call("auth/me");
    case "lock":
      return call("auth/lock", "POST");
    case "unlock":
      return acceptSession(await call<SessionResponse>("auth/unlock", "POST", { pin: command.pin }));
    case "business": {
      const route = routes.get(command.route ?? "");
      if (!route) throw new Error("NOT_FOUND");
      const path = route[1].replace(":id", encodeURIComponent(command.id ?? ""));
      const query = new URLSearchParams(Object.entries(command.query ?? {}).map(([name, value]) => [name, String(value)]));
      return call(path + (query.size ? "?" + query : ""), route[0], command.input, command.key);
    }
    default:
      throw new Error("NOT_FOUND");
  }
}

await database.create();
try {
  database.migrate();
  await seedRoles(database.db);
  await call("setup/bootstrap", "POST", {
    secret, username: "admin", password, pin: "012345", displayName: "ผู้ดูแลทดสอบ",
    deviceName: "จุดขายตรวจรับ", storeName: "สหกรณ์ตรวจรับ",
  });
  const admin = await database.db.user.findUniqueOrThrow({ where: { username: "admin" } });
  for (const role of ["MANAGER", "CASHIER", "STOCK_STAFF"] as const) {
    await database.db.user.create({ data: {
      storeId: admin.storeId, username: role.toLowerCase(), name: role, passwordHash: admin.passwordHash, pinHash: admin.pinHash,
      roles: { create: { role: { connect: { code: role } } } },
    } });
  }
  acceptSession(await call<SessionResponse>("auth/login", "POST", { username: "admin", password }));
  const category = await call<{ id: string }>("catalog/categories", "POST", { name: "ของแห้ง" });
  const supplier = await call<{ id: string }>("catalog/suppliers", "POST", { name: "คู่ค้าตรวจรับ" });
  const product = await call<{ id: string }>("catalog/products", "POST", {
    categoryId: category.id, sku: "UAT-RICE", barcodes: ["000123"], name: "ข้าวสารตรวจรับ", baseUnit: "ชิ้น",
    costPrice: "100.00", regularPrice: "10.10", memberPrice: "9.00", trackExpiration: true,
  });
  const expiry = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await call("inventory/receipts", "POST", { supplierId: supplier.id, lines: [{
    productId: product.id, unit: "ชิ้น", quantity: "3", lotNumber: "LOT-UAT", expirationDate: expiry, unitCostPerBaseUnit: "4.00",
  }] }, crypto.randomUUID());
  await call("members", "POST", { name: "สมาชิกตรวจรับ", number: "UAT001", phone: "0810000000", joinedOn: "2025-01-01" });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 1436,
    async fetch(request) {
      if (request.method === "OPTIONS") return new Response(null, { headers });
      if (request.method !== "POST") return new Response(null, { status: 405, headers });
      try {
        return Response.json(await invoke(await request.json() as BrowserCommand), { headers });
      } catch (reason) {
        return Response.json({ code: reason instanceof Error ? reason.message : "UNAVAILABLE" }, { status: 400, headers });
      }
    },
  });
  console.log("ACCEPTANCE READY", server.port);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
  server.stop(true);
} finally {
  await database.drop();
}
