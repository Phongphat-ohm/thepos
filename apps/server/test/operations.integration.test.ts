import { afterAll, beforeAll, expect, it } from "vitest";
import { reportKind, type CashShift, type Dashboard, type Report, type StoreSettings } from "@thepos/contracts";
import { seedRoles } from "../prisma/roles";
import { createApp } from "../src/app";
import { newToken } from "../src/core/security";
import { isolatedDatabase } from "./isolated-db";

const database = isolatedDatabase();
const { db } = database;
const secret = newToken();
const terminal = newToken();
const password = "integration operations password";
const now = () => Date.parse("2026-11-16T10:00:00Z");
const app = createApp(db, { jwtSecret: newToken(), bootstrapSecret: secret, now });
const tokens = new Map<string, string>();
const key = () => crypto.randomUUID();

function request(path: string, options: { user?: string; input?: unknown; method?: string; key?: string } = {}) {
  const { user = "admin", input, key, method = input ? "POST" : "GET" } = options;
  const headers = new Headers({ "x-device-token": terminal, "content-type": "application/json" });
  if (tokens.has(user)) headers.set("authorization", "Bearer " + tokens.get(user));
  if (key) headers.set("idempotency-key", key);
  return app.request(`/api/v1/${path}`, { headers, method, body: input ? JSON.stringify(input) : undefined });
}
async function json<T = unknown>(response: Response | Promise<Response>, status: number): Promise<T> {
  const result = await response;
  const body = await result.json();
  expect(result.status, JSON.stringify(body)).toBe(status);
  return body as T;
}

beforeAll(async () => {
  await database.create(); database.migrate(); await seedRoles(db);
  expect((await request("setup/bootstrap", { input: {
    secret, username: "admin", password, pin: "012345", displayName: "ผู้ดูแล", deviceName: "เครื่องทดสอบ", storeName: "สหกรณ์ทดสอบ",
  } })).status).toBe(201);
  const admin = await db.user.findUniqueOrThrow({ where: { username: "admin" } });
  for (const role of ["MANAGER", "CASHIER", "STOCK_STAFF"] as const) await db.user.create({ data: {
    storeId: admin.storeId, username: role.toLowerCase(), name: role, passwordHash: admin.passwordHash, pinHash: admin.pinHash,
    roles: { create: { role: { connect: { code: role } } } },
  } });
  for (const username of ["admin", "manager", "cashier", "stock_staff"]) {
    const login = await json<{ accessToken: string }>(request("auth/login", { input: { username, password } }), 200);
    tokens.set(username, login.accessToken);
  }
});
afterAll(() => database.drop());

it("restricts store and receipt settings to administrators, validates VAT and audits each save", async () => {
  const path = "settings/store";
  await json(request(path, { user: "cashier" }), 403);
  await json(request(path, { user: "manager", method: "PUT", input: { name: "เปลี่ยนชื่อ" } }), 403);
  const before = await json<StoreSettings>(request(path), 200);
  expect(before).toMatchObject({ vatActive: false, vatRate: null, receiptLogo: null });
  await json(request(path, { method: "PUT", input: { name: before.name, vatRate: "101" } }), 400);
  await json(request(path, { method: "PUT", input: { name: before.name, vatActive: true } }), 400);
  const input = { name: before.name, address: "เขตทดสอบ", taxId: "0123456789012", vatRate: "7",
    receiptHeader: "สหกรณ์", receiptFooter: "ขอบคุณ", receiptLogo: null };
  const saved = await json<StoreSettings>(request(path, { method: "PUT", input }), 200);
  expect(saved).toEqual({ ...input, vatRate: "7.00", vatActive: false });
  expect(await json(request(path), 200)).toEqual(saved);
  expect(await db.auditLog.count({ where: { event: "STORE_SETTINGS_UPDATED" } })).toBe(1);

  await json(request("settings/users", { user: "manager" }), 403);
  const createdStaff = await json<{ id: string; username: string; roles: string[]; isActive: boolean }>(
    request("settings/users", {
      input: { username: "cashier_two", name: "แคชเชียร์สำรอง", password, pin: "654321", roles: ["CASHIER"] },
    }),
    201,
  );
  expect(createdStaff).toMatchObject({ username: "cashier_two", roles: ["CASHIER"], isActive: true });
  const updatedStaff = await json<{ id: string; isActive: boolean; roles: string[] }>(
    request(`settings/users/${createdStaff.id}`, {
      method: "PUT",
      input: { name: "แคชเชียร์สำรอง (พักงาน)", roles: ["CASHIER", "STOCK_STAFF"], isActive: false },
    }),
    200,
  );
  expect(updatedStaff).toMatchObject({ id: createdStaff.id, isActive: false, roles: ["CASHIER", "STOCK_STAFF"] });
  const devicesList = await json<{ items: { id: string; name: string; isActive: boolean }[] }>(request("settings/devices"), 200);
  expect(devicesList.items.length).toBeGreaterThanOrEqual(1);
  await json(request(`settings/devices/${devicesList.items[0]!.id}`, {
    method: "PATCH", input: { name: "จุดขายหลัก", isActive: false },
  }), 403);
  const renamedDevice = await json<{ name: string; isActive: boolean }>(
    request(`settings/devices/${devicesList.items[0]!.id}`, {
      method: "PATCH", input: { name: "จุดขายหลัก", isActive: true, pin: "112233" },
    }),
    200,
  );
  expect(renamedDevice).toMatchObject({ name: "จุดขายหลัก", isActive: true, hasPin: true });

  const newDevice = await json<{ id: string; name: string; hasPin: boolean; canDelete: boolean }>(
    request("settings/devices", { input: { name: "จุดขายสำรอง", pin: "223344" } }),
    201,
  );
  expect(newDevice).toMatchObject({ name: "จุดขายสำรอง", hasPin: true, canDelete: true });
  const publicDevices = await json<{ items: { id: string; name: string; hasPin: boolean; inUse: boolean; activeUser: string | null }[] }>(request("setup/devices"), 200);
  expect(publicDevices.items).toContainEqual({ id: newDevice.id, name: "จุดขายสำรอง", hasPin: true, inUse: false, activeUser: null });

  const rebindToken = newToken();
  const noAdminBind = await app.request("/api/v1/devices/enroll", {
    method: "POST",
    headers: { "x-device-token": rebindToken, "content-type": "application/json" },
    body: JSON.stringify({ deviceId: newDevice.id, pin: "223344" }),
  });
  expect(noAdminBind.status).toBe(400);
  const nonAdminBind = await app.request("/api/v1/devices/enroll", {
    method: "POST",
    headers: { "x-device-token": rebindToken, "content-type": "application/json" },
    body: JSON.stringify({ username: "cashier", password, deviceId: newDevice.id, pin: "223344" }),
  });
  expect(nonAdminBind.status).toBe(403);
  const wrongPinBind = await app.request("/api/v1/devices/enroll", {
    method: "POST",
    headers: { "x-device-token": rebindToken, "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password, deviceId: newDevice.id, pin: "999999" }),
  });
  expect(wrongPinBind.status).toBe(401);
  const validBind = await app.request("/api/v1/devices/enroll", {
    method: "POST",
    headers: { "x-device-token": rebindToken, "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password, deviceId: newDevice.id, pin: "223344" }),
  });
  expect(validBind.status).toBe(204);
  const boundStatus = await app.request("/api/v1/setup/status", { headers: { "x-device-token": rebindToken } });
  expect(await boundStatus.json()).toEqual({ initialized: true, registered: true });

  const secondLogin = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "x-device-token": rebindToken, "content-type": "application/json" },
    body: JSON.stringify({ username: "cashier", password }),
  });
  expect(secondLogin.status).toBe(200);

  const duplicateBindAttempt = await app.request("/api/v1/devices/enroll", {
    method: "POST",
    headers: { "x-device-token": newToken(), "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password, deviceId: newDevice.id, pin: "223344" }),
  });
  expect(duplicateBindAttempt.status).toBe(409);
  expect(await duplicateBindAttempt.json()).toEqual({ code: "DEVICE_IN_USE" });

  const adminViewDevices = await json<{ items: { id: string; activeUser: string | null }[] }>(request("settings/devices"), 200);
  expect(adminViewDevices.items.find(({ id }) => id === newDevice.id)?.activeUser).toContain("cashier");

  const releasedDevice = await json<{ id: string; activeUser: string | null }>(
    request(`settings/devices/${newDevice.id}`, {
      method: "PATCH",
      input: { name: "จุดขายสำรอง", isActive: true, revokeSessions: true },
    }),
    200,
  );
  expect(releasedDevice.activeUser).toBeNull();

  expect((await request(`settings/devices/${newDevice.id}`, { method: "DELETE" })).status).toBe(204);
  expect((await request(`settings/users/${createdStaff.id}`, { method: "DELETE" })).status).toBe(204);
});

it("reconciles a shift across split sales, a cash refund, drawer payouts and manager-approved variance", async () => {
  const cashier = { user: "cashier" };
  const category = await json<{ id: string }>(request("catalog/categories", { input: { name: "อาหารแห้ง" } }), 201);
  const supplier = await json<{ id: string }>(request("catalog/suppliers", { input: { name: "ผู้จำหน่าย" } }), 201);
  const item = await json<{ id: string }>(request("catalog/products", { input: { categoryId: category.id, sku: "TEST-LOT", name: "ข้าวสาร", baseUnit: "ชิ้น",
    costPrice: "100.00", regularPrice: "10.10", memberPrice: "9.00", trackExpiration: true } }), 201);
  await json(request("inventory/receipts", { key: key(), input: { supplierId: supplier.id, lines: [
    { productId: item.id, unit: "ชิ้น", quantity: "1", lotNumber: "EARLY", expirationDate: "2026-11-20", unitCostPerBaseUnit: "2.00" },
    { productId: item.id, unit: "ชิ้น", quantity: "2", lotNumber: "LATE", expirationDate: "2026-11-21", unitCostPerBaseUnit: "4.00" },
  ] } }), 201);
  const checkout = { drawer: true, lines: [{ productId: item.id, unit: "ชิ้น", quantity: "2", expectedBasePrice: "10.10" }],
    payments: [{ method: "CASH", amount: "15.20", tendered: "20.00" }, { method: "TRANSFER", amount: "5.00", reference: "BANK-01" }] };
  expect(await json(request("sales", { ...cashier, key: key(), input: checkout }), 409)).toEqual({ code: "SHIFT_REQUIRED" });
  expect(await json(request("sales", { ...cashier, key: key(), input: { lines: checkout.lines, payments: checkout.payments } }), 409)).toEqual({ code: "SHIFT_REQUIRED" });
  const openKey = key();
  const opening = { ...cashier, key: openKey, input: { openingFloat: "100.00" } };
  const shift = await json<CashShift>(request("shifts", opening), 201);
  expect(await json(request("shifts", opening), 201)).toMatchObject({ id: shift.id });
  expect(await json(request("shifts", { key: key(), input: { openingFloat: "1" } }), 409)).toEqual({ code: "SHIFT_CONFLICT" });
  const saleKey = key();
  const sale = await json<{ id: string; netTotal: string; items: { id: string }[] }>(request("sales", { ...cashier, key: saleKey, input: checkout }), 201);
  await json(request("sales", { ...cashier, key: saleKey, input: checkout }), 200);
  const detailPath = `shifts/${shift.id}`;
  const info = () => json<{ shift: CashShift; items: { kind: string }[] }>(request(detailPath, cashier), 200);
  expect((await info()).shift).toMatchObject({ expectedCash: "115.20", cashSales: "15.20" });
  const refundPath = `sales/${sale.id}/returns`;
  const refund = { drawer: true, reason: "คืนสินค้า", lines: [{ saleItemId: sale.items[0]!.id, quantity: "1", disposition: "SELLABLE" }] };
  const quote = await json<{ quote: string; refunds: { method: string; amount: string }[] }>(request(refundPath + "/quote", { ...cashier, input: refund }), 200);
  await json(request(refundPath, { ...cashier, key: key(), input: { ...refund, expectedQuote: quote.quote, approval: { username: "manager", pin: "012345" } } }), 201);
  expect(quote.refunds).toContainEqual(expect.objectContaining({ method: "CASH", amount: "10.10" }));
  const drop = { ...cashier, key: key(), input: { kind: "CASH_DROP", amount: "10.00", reason: "นำเข้าเซฟ" } };
  const moved = await json(request(detailPath + "/movements", drop), 201);
  expect(await json(request(detailPath + "/movements", drop), 201)).toEqual(moved);
  await json(request(detailPath + "/movements", { ...cashier, key: key(), input: { kind: "PETTY_CASH", amount: "1000.00", reason: "เบิกย่อย" } }), 409);

  const member = await json<{ id: string }>(request("members", { input: { name: "สมาชิก", number: "F6", joinedOn: "2025-01-01" } }), 201);
  await json(request(`members/${member.id}/shares`, { key: key(), input: {
    type: "INITIAL", quantity: 10, unitValue: "10.00", effectiveDate: "2025-05-01", reason: "เปิดบัญชี",
  } }), 201);
  const rule = await json<{ id: string }>(request("dividends/rules", { input: { name: "กฎ", formula: "CLOSING_BALANCE", dividendRate: "10", rebateRate: "0" } }), 201);
  const period = await json<{ id: string }>(request("dividends/periods", { input: { name: "งวด 2568", startDate: "2025-01-01", endDate: "2025-12-31", ruleId: rule.id } }), 201);
  const p = `dividends/periods/${period.id}`;
  const preview = await json<{ currentRunId: string }>(request(p + "/preview", { method: "POST" }), 200);
  await json(request(p + "/approve", { input: { runId: preview.currentRunId } }), 200);
  const obligation = await json<{ items: { id: string }[] }>(request(p + "/obligations"), 200);
  const payout = { user: "manager", key: key(), input: { method: "CASH", drawer: true, amount: "5.00" } };
  const payoutPath = `dividends/obligations/${obligation.items[0]!.id}/payouts`;
  const paid = await json(request(payoutPath, payout), 201);
  expect(paid).toMatchObject({ drawer: true });
  expect(await json(request(payoutPath, payout), 200)).toEqual(paid);
  const actual = await info();
  expect(actual.shift).toMatchObject({ expectedCash: "90.10", cashRefunds: "10.10", cashOut: "15.00" });
  expect(actual.items).toHaveLength(4);
  const closePath = detailPath + "/close";
  expect(await json(request(closePath, { ...cashier, input: { expectedCash: "115.20", countedCash: "90" } }), 409)).toEqual({ code: "SHIFT_STALE" });
  const close = { expectedCash: "90.10", countedCash: "90.00" };
  expect(await json(request(closePath, { ...cashier, input: close }), 403)).toEqual({ code: "APPROVAL_REQUIRED" });
  await json(request(closePath, { ...cashier, input: { ...close, approval: { username: "manager", pin: "999999" } } }), 401);
  const closed = await json<CashShift>(request(closePath, { ...cashier, input: { ...close, approval: { username: "manager", pin: "012345" } } }), 200);
  expect(closed).toMatchObject({ countedCash: "90.00", variance: "-0.10", approver: "MANAGER", editable: false });
  expect(await json(request(closePath, { ...cashier, input: close }), 200)).toEqual(closed);
  await expect(db.cashShift.update({ where: { id: shift.id }, data: { openedAt: new Date() } })).rejects.toThrow(/open shift/);
  await json(request("shifts", { user: "stock_staff" }), 403);
  await json(request("sales", { ...cashier, key: key(), input: checkout }), 409);
});

it("reports exact lot profit and keeps dashboard data scoped by permission", async () => {
  const view = (kind: string, query = "") => `reports?kind=${kind}&start=2026-11-16&end=2026-11-30${query}`;
  for (const kind of reportKind.options) await json<Report>(request(view(kind)), 200);
  const profit = await json<Report>(request(view("profit")), 200);
  expect(profit.rows).toEqual([["2026-11-16", "10.10", "4.00", "6.10"]]);
  await json(request(view("profit"), { user: "cashier" }), 403);
  expect((await json<Report>(request(view("expiry", "&q=EARLY")), 200)).rows).toEqual([["TEST-LOT", "ข้าวสาร", "EARLY", "2026-11-20", "1.000"]]);
  const manager = await json<Dashboard>(request("dashboard", { user: "manager" }), 200);
  expect(manager).toMatchObject({ sales: { net: "10.10", receipts: "1", refunds: "1", profit: "6.10", personal: false },
    stock: { expiring: "2" }, payoutBalance: "5.00" });
  const cashier = await json<Dashboard>(request("dashboard", { user: "cashier" }), 200);
  expect(cashier.sales).toEqual({ net: "10.10", receipts: "1", refunds: "1", personal: true });
  expect(cashier).not.toHaveProperty("stock");
  expect(cashier).not.toHaveProperty("payoutBalance");
});

it("serializes a final cash movement against closing the same drawer", async () => {
  const user = "cashier";
  const shift = await json<CashShift>(request("shifts", { user, key: key(), input: { openingFloat: "10.00" } }), 201);
  const path = `shifts/${shift.id}`;
  const [movement, close] = await Promise.all([
    request(path + "/movements", { user, key: key(), input: { kind: "CASH_IN", amount: "1.00", reason: "เติมเงินทอน" } }),
    request(path + "/close", { user, input: { expectedCash: "10.00", countedCash: "10.00" } }),
  ]);
  if (movement.status === 201) {
    expect(close.status).toBe(409);
    expect(await close.json()).toEqual({ code: "SHIFT_STALE" });
    await json(request(path + "/close", { user, input: { expectedCash: "11.00", countedCash: "11.00" } }), 200);
  } else {
    expect(movement.status).toBe(409);
    expect(close.status).toBe(200);
  }
  const detail = await json<{ shift: CashShift; items: unknown[] }>(request(path, { user }), 200);
  expect(detail.shift).toMatchObject({ expectedCash: movement.status === 201 ? "11.00" : "10.00", variance: "0.00" });
  expect(detail.items).toHaveLength(movement.status === 201 ? 1 : 0);
});

it("safely ignores prototype sort keys, supports manager force-close, protects referenced records, and keeps deleted device names in audits", async () => {
  await json(request("settings/users?sortBy=toString&sortDir=desc"), 200);
  await json(request("shifts?sortBy=constructor"), 200);

  // Cashier opens an abandoned shift; admin opens own shift too? No, cashier opens then manager inspects & force-closes.
  const abandoned = await json<CashShift>(request("shifts", { user: "cashier", key: key(), input: { openingFloat: "50.00" } }), 201);
  const managerView = await json<{ shift: CashShift }>(request(`shifts/${abandoned.id}`, { user: "manager" }), 200);
  expect(managerView.shift.canForceClose).toBe(true);

  const forced = await json<CashShift>(request(`shifts/${abandoned.id}/close`, {
    user: "manager",
    input: { expectedCash: "50.00", countedCash: "48.00" },
  }), 200);
  expect(forced).toMatchObject({ countedCash: "48.00", variance: "-2.00", approver: "MANAGER", editable: false });
  const forceAudit = await json<{ items: { event: string }[] }>(request("settings/audit-logs?event=SHIFT_FORCE_CLOSED"), 200);
  expect(forceAudit.items).toHaveLength(1);

  // Cashier cannot close another user's shift.
  const adminShift = await json<CashShift>(request("shifts", { user: "admin", key: key(), input: { openingFloat: "10.00" } }), 201);
  await json(request(`shifts/${adminShift.id}/close`, {
    user: "cashier",
    input: { expectedCash: "10.00", countedCash: "10.00" },
  }), 403);
  await json(request(`shifts/${adminShift.id}/close`, {
    user: "admin",
    input: { expectedCash: "10.00", countedCash: "10.00" },
  }), 200);

  // Referential integrity: referenced user cannot be deleted (409 RECORD_IN_USE).
  const cashierUser = await db.user.findUniqueOrThrow({ where: { username: "cashier" } });
  expect(await json(request(`settings/users/${cashierUser.id}`, { method: "DELETE" }), 409)).toEqual({ code: "RECORD_IN_USE" });

  // Device with an active held bill cannot be deleted until the bill is voided, and audit log retains deviceName after deletion.
  const tempToken = newToken();
  expect((await app.request("/api/v1/devices/enroll", {
    method: "POST",
    headers: { "x-device-token": tempToken, "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password, deviceName: "เครื่องชั่วคราว" }),
  })).status).toBe(204);
  const tempLogin = await json<{ accessToken: string; profile: { device: { id: string } } }>(
    app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "x-device-token": tempToken, "content-type": "application/json" },
      body: JSON.stringify({ username: "cashier", password }),
    }),
    200,
  );
  const tempProduct = await db.product.findFirstOrThrow();
  const heldId = crypto.randomUUID();
  await json<{ id: string; revision: number }>(app.request(`/api/v1/sales/held/${heldId}`, {
    method: "PUT",
    headers: {
      "x-device-token": tempToken,
      authorization: "Bearer " + tempLogin.accessToken,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      note: "บิลค้างทดสอบลบเครื่อง",
      lines: [{ productId: tempProduct.id, quantity: "1", unit: tempProduct.baseUnit, expectedBasePrice: tempProduct.regularPrice.toFixed(2) }],
    }),
  }), 200);

  await json(request(`settings/devices/${tempLogin.profile.device.id}`, {
    method: "PATCH",
    input: { name: "เครื่องชั่วคราว", isActive: true, revokeSessions: true },
  }), 200);
  expect(await json(request(`settings/devices/${tempLogin.profile.device.id}`, { method: "DELETE" }), 409)).toEqual({ code: "DEVICE_IN_USE" });

  // A separate temporary device without sales/held bills can be deleted, while audit logs preserve its snapshot device name.
  const auditToken = newToken();
  expect((await app.request("/api/v1/devices/enroll", {
    method: "POST",
    headers: { "x-device-token": auditToken, "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password, deviceName: "เครื่องลบประวัติ" }),
  })).status).toBe(204);
  const auditLogin = await json<{ accessToken: string; profile: { device: { id: string } } }>(
    app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "x-device-token": auditToken, "content-type": "application/json" },
      body: JSON.stringify({ username: "cashier", password }),
    }),
    200,
  );
  await json(request(`settings/devices/${auditLogin.profile.device.id}`, {
    method: "PATCH",
    input: { name: "เครื่องลบประวัติ", isActive: true, revokeSessions: true },
  }), 200);
  expect((await request(`settings/devices/${auditLogin.profile.device.id}`, { method: "DELETE" })).status).toBe(204);

  const logsAfterDelete = await json<{ items: { event: string; deviceName: string | null }[] }>(
    request("settings/audit-logs?q=เครื่องลบประวัติ"),
    200,
  );
  expect(logsAfterDelete.items.length).toBeGreaterThanOrEqual(1);
  expect(logsAfterDelete.items.some((entry) => entry.deviceName === "เครื่องลบประวัติ")).toBe(true);
});
