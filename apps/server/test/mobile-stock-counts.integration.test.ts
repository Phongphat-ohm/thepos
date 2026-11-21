import { afterAll, beforeAll, expect, it } from "vitest";
import { sessionResponseSchema, type SessionResponse } from "@thepos/contracts";
import { seedRoles } from "../prisma/roles";
import { createApp } from "../src/app";
import { newToken } from "../src/core/security";
import { isolatedDatabase } from "./isolated-db";

const testDatabase = isolatedDatabase();
const { db } = testDatabase;
const secret = newToken();
const device = newToken();
const password = "mobile count integration password";

const app = createApp(db, {
  jwtSecret: newToken(),
  bootstrapSecret: secret,
  clientIp: (req) => req.headers.get("x-test-ip") ?? "192.168.1.50",
});

const clients = new Map<string, SessionResponse>();
let categoryId: string;
let supplierId: string;
let lotAId: string;
let lotBId: string;

function request(
  path: string,
  options: {
    input?: unknown;
    username?: string;
    method?: string;
    key?: string;
    mobileToken?: string;
    testIp?: string;
  } = {},
) {
  const { input, username = "stock", method = input ? "POST" : "GET", key, mobileToken, testIp } = options;
  const headers = new Headers({ "content-type": "application/json" });
  if (testIp) headers.set("x-test-ip", testIp);
  if (mobileToken !== undefined) {
    if (mobileToken) headers.set("x-mobile-count-token", mobileToken);
  } else {
    headers.set("x-device-token", device);
    const access = clients.get(username)?.accessToken;
    if (access) headers.set("authorization", `Bearer ${access}`);
  }
  if (key) headers.set("idempotency-key", key);
  return app.request(`/api/v1/${path}`, {
    headers,
    method,
    body: input === undefined ? undefined : JSON.stringify(input),
  });
}

async function json<T>(response: Response | Promise<Response>, status: number): Promise<T> {
  const result = await response;
  const payload = await result.json();
  expect(result.status, JSON.stringify(payload)).toBe(status);
  return payload as T;
}

beforeAll(async () => {
  await testDatabase.create();
  testDatabase.migrate();
  await seedRoles(db);

  // Bootstrap store & admin
  const boot = await app.request("/api/v1/setup/bootstrap", {
    method: "POST",
    headers: { "x-device-token": device, "content-type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password,
      pin: "123456",
      secret,
      storeName: "ร้านสหกรณ์ทดสอบ",
      deviceName: "POS-1",
      displayName: "ผู้ดูแลระบบ",
    }),
  });
  expect(boot.status).toBe(201);

  const adminSession = sessionResponseSchema.parse(
    await json(
      app.request("/api/v1/auth/login", {
        method: "POST",
        headers: { "x-device-token": device, "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password }),
      }),
      200,
    ),
  );
  clients.set("admin", adminSession);

  // Create STOCK_STAFF user (maker) and MANAGER user (checker)
  await json(
    request("settings/users", {
      username: "admin",
      input: { username: "stock", name: "พนักงานคลัง", password, pin: "222222", roles: ["STOCK_STAFF"] },
    }),
    201,
  );
  await json(
    request("settings/users", {
      username: "admin",
      input: { username: "manager", name: "ผู้จัดการ", password, pin: "333333", roles: ["MANAGER"] },
    }),
    201,
  );

  for (const username of ["stock", "manager"]) {
    const sess = sessionResponseSchema.parse(
      await json(
        app.request("/api/v1/auth/login", {
          method: "POST",
          headers: { "x-device-token": device, "content-type": "application/json" },
          body: JSON.stringify({ username, password }),
        }),
        200,
      ),
    );
    clients.set(username, sess);
  }

  // Create category, supplier, product with 2 lots
  const cat = await json<{ id: string }>(request("catalog/categories", { username: "admin", input: { name: "เครื่องดื่ม" } }), 201);
  categoryId = cat.id;
  const sup = await json<{ id: string }>(request("catalog/suppliers", { username: "admin", input: { name: "บริษัททดสอบ" } }), 201);
  supplierId = sup.id;

  const prod = await json<{ id: string }>(
    request("catalog/products", {
      username: "admin",
      input: {
        sku: "DRK-001",
        name: "น้ำดื่ม 600ml",
        categoryId,
        baseUnit: "ขวด",
        costPrice: "4.0000",
        regularPrice: "7.00",
        memberPrice: "6.50",
        barcodes: ["8850000111222"],
        units: [{ name: "แพ็ค", multiplier: "12" }],
        trackStock: true,
        trackExpiration: true,
      },
    }),
    201,
  );

  const receipt = await json<{ lots: { id: string; lotNumber: string }[] }>(
    request("inventory/receipts", {
      username: "admin",
      key: crypto.randomUUID(),
      input: {
        supplierId,
        lines: [
          { productId: prod.id, lotNumber: "LOT-A", expirationDate: "2027-01-31", unit: "แพ็ค", quantity: "2", unitCostPerBaseUnit: "4.0000" },
          { productId: prod.id, lotNumber: "LOT-B", expirationDate: "2027-06-30", unit: "แพ็ค", quantity: "1", unitCostPerBaseUnit: "4.0000" },
        ],
      },
    }),
    201,
  );
  lotAId = receipt.lots.find((l) => l.lotNumber === "LOT-A")!.id;
  lotBId = receipt.lots.find((l) => l.lotNumber === "LOT-B")!.id;
});

afterAll(async () => {
  await testDatabase.drop();
});

it("supports full LAN mobile stock count lifecycle with Blind Count, Pause, Revoke, and Maker-Checker approval", async () => {
  // 1. Desktop creates a Blind Count session
  const created = await json<{ id: string; joinCode: string; rawJoinCode: string; status: string }>(
    request("inventory/count-sessions", {
      username: "stock",
      input: { title: "นับสต๊อก พ.ย.", reason: "ตรวจนับประจำเดือน", showExpectedQty: false },
    }),
    201,
  );
  expect(created.status).toBe("OPEN");

  // 2. Public IP is rejected with 403 LAN_ONLY
  const publicJoin = await json<{ code: string }>(
    request("mobile-count/join", {
      mobileToken: "",
      testIp: "203.0.113.5",
      input: { code: created.joinCode, displayName: "คนนอก" },
    }),
    403,
  );
  expect(publicJoin.code).toBe("LAN_ONLY");

  // 3. Two phones on LAN join the same session without POS login
  const phone1 = await json<{ token: string; participant: { id: string } }>(
    request("mobile-count/join", {
      mobileToken: "",
      testIp: "192.168.1.21",
      input: { code: created.joinCode, displayName: "บี - หน้าชั้น" },
    }),
    201,
  );
  const phone2 = await json<{ token: string; participant: { id: string } }>(
    request("mobile-count/join", {
      mobileToken: "",
      testIp: "192.168.1.22",
      input: { code: created.rawJoinCode, displayName: "เอ - หลังร้าน" },
    }),
    201,
  );

  // 4. Lookup barcode on mobile: Blind Count hides expectedQuantity
  const lookup = await json<{
    exactBarcode: boolean;
    items: { lots: { id: string; expectedQuantity?: string }[] }[];
  }>(request("mobile-count/lookup?q=8850000111222", { mobileToken: phone1.token }), 200);
  expect(lookup.exactBarcode).toBe(true);
  expect(lookup.items[0]!.lots).toHaveLength(2);
  expect(lookup.items[0]!.lots[0]!.expectedQuantity).toBeUndefined();

  // 5. Both phones count LOT-A additively (10 ขวด + 1 แพ็ค [12 ขวด] = 22 ขวด vs expected 24)
  await json(
    request("mobile-count/entries", {
      mobileToken: phone1.token,
      input: { lotId: lotAId, unit: "ขวด", quantity: "10", note: "ชั้นหน้า" },
    }),
    201,
  );
  await json(
    request("mobile-count/entries", {
      mobileToken: phone2.token,
      input: { lotId: lotAId, unit: "แพ็ค", quantity: "1", note: "หลังร้าน" },
    }),
    201,
  );

  // 6. Desktop pauses the session -> mobile cannot submit
  await json(
    request(`inventory/count-sessions/${created.id}/status`, {
      username: "stock",
      method: "PATCH",
      input: { status: "PAUSED" },
    }),
    200,
  );
  const pausedAttempt = await json<{ code: string }>(
    request("mobile-count/entries", {
      mobileToken: phone1.token,
      input: { lotId: lotBId, unit: "ขวด", quantity: "5" },
    }),
    409,
  );
  expect(pausedAttempt.code).toBe("COUNT_SESSION_PAUSED");

  // 7. Desktop reopens & revokes phone2 -> phone2 blocked, phone1 works
  await json(
    request(`inventory/count-sessions/${created.id}/status`, {
      username: "stock",
      method: "PATCH",
      input: { status: "OPEN" },
    }),
    200,
  );
  await json(
    request(`inventory/count-sessions/${created.id}/revoke-participant`, {
      username: "stock",
      input: { participantId: phone2.participant.id },
    }),
    200,
  );
  const revokedAttempt = await json<{ code: string }>(
    request("mobile-count/entries", {
      mobileToken: phone2.token,
      input: { lotId: lotBId, unit: "ขวด", quantity: "1" },
    }),
    401,
  );
  expect(revokedAttempt.code).toBe("PARTICIPANT_REVOKED");

  // 8. Desktop checks detail summary
  const detail = await json<{
    summary: { lotId: string; expected: string; counted: string; variance: string }[];
  }>(request(`inventory/count-sessions/${created.id}`, { username: "stock" }), 200);
  expect(detail.summary).toHaveLength(1);
  expect(detail.summary[0]!.expected).toBe("24.000");
  expect(detail.summary[0]!.counted).toBe("22.000");
  expect(detail.summary[0]!.variance).toBe("-2.000");

  // 9. Desktop finalizes -> creates StockCount (PENDING) -> Manager approves
  const finalized = await json<{ stockCountId: string; status: string }>(
    request(`inventory/count-sessions/${created.id}/finalize`, {
      username: "stock",
      key: crypto.randomUUID(),
      input: {
        lines: [{ lotId: lotAId, expected: "24.000", counted: "22.000" }],
      },
    }),
    201,
  );
  expect(finalized.status).toBe("SUBMITTED");

  const approved = await json<{ status: string }>(
    request(`inventory/counts/${finalized.stockCountId}/review`, {
      username: "manager",
      input: { decision: "APPROVED" },
    }),
    200,
  );
  expect(approved.status).toBe("APPROVED");

  const updatedLot = await db.stockLot.findUniqueOrThrow({ where: { id: lotAId } });
  expect(updatedLot.remainingQuantity.toFixed(3)).toBe("22.000");
});
