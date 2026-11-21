import { expect, it, beforeAll, afterAll } from "vitest";
import { createDecipheriv, randomBytes } from "node:crypto";
import { sessionResponseSchema, type MemberProfile, type MemberShares, type SessionResponse, type ShareEntry, type Supplier } from "@thepos/contracts";
import { seedRoles } from "../prisma/roles";
import { createApp } from "../src/app";
import { deductStock } from "../src/modules/inventory/service";
import { newToken } from "../src/core/security";
import { isolatedDatabase } from "./isolated-db";

const testDatabase = isolatedDatabase();
const { db } = testDatabase;
const secret = newToken();
const device = newToken();
const password = "phase 2 integration password";
const memberEncryptionKey = randomBytes(32);
const app = createApp(db, { jwtSecret: newToken(), bootstrapSecret: secret, memberEncryptionKey: memberEncryptionKey.toString("hex") });
const clients = new Map<string, SessionResponse>();
let categoryId: string;
let supplierId: string;
let storeId: string;

function request(path: string, options: {
  input?: unknown; username?: string; method?: string; key?: string;
  terminal?: { device: string; access?: string };
} = {}) {
  const { input, username = "admin", method = input ? "POST" : "GET", key, terminal } = options;
  const access = terminal ? terminal.access : clients.get(username)?.accessToken;
  const headers = new Headers({ "x-device-token": terminal?.device ?? device, "content-type": "application/json" });
  if (access) headers.set("authorization", "Bearer " + access);
  if (key) headers.set("idempotency-key", key);
  return app.request("/api/v1/" + path, {
    headers, method, body: input === undefined ? undefined : JSON.stringify(input),
  });
}

async function json<T>(response: Response | Promise<Response>, status: number): Promise<T> {
  const result = await response;
  const payload = await result.json();
  expect(result.status, JSON.stringify(payload)).toBe(status);
  return payload as T;
}

type Product = { id: string; sku: string; barcodes: string[]; regularPrice: string; memberPrice: string };
type Lot = {
  id: string; lotNumber: string; unitCost: string; remainingQuantity: string; expirationDate: string | null;
};
type Receipt = { id: string; lots: Lot[] };
function item(sku: string, trackExpiration = false, barcodes: string[] = []) {
  return {
    sku, categoryId, name: "ข้าวสาร", baseUnit: "ชิ้น", costPrice: "2.3456",
    regularPrice: "10.10", memberPrice: "9.05", barcodes, trackExpiration,
    units: [{ name: "ลัง", multiplier: "12" }, { name: "ส่วน", multiplier: "0.333" }],
  };
}

function line(productId: string, lotNumber: string, expirationDate: string | null = null) {
  return { productId, lotNumber, expirationDate, unit: "ลัง", quantity: "1", unitCostPerBaseUnit: "2.3456" };
}

const receive = (lines: ReturnType<typeof line>[], key = crypto.randomUUID()) =>
  request("inventory/receipts", { key, input: { supplierId, lines } });

beforeAll(async () => {
  await testDatabase.create();
  testDatabase.migrate();
  await seedRoles(db);
  const bootstrap = await request("setup/bootstrap", { input: {
    username: "admin", password, secret, pin: "012345", storeName: "สหกรณ์ทดสอบสินค้า",
    displayName: "ผู้ดูแล", deviceName: "เครื่องทดสอบ",
  } });
  expect(bootstrap.status).toBe(201);
  const admin = await db.user.findUniqueOrThrow({ where: { username: "admin" } });
  storeId = admin.storeId;
  for (const role of ["MANAGER", "CASHIER", "STOCK_STAFF"] as const) {
    await db.user.create({ data: {
      storeId, username: role.toLowerCase(), name: role, passwordHash: admin.passwordHash, pinHash: admin.pinHash,
      roles: { create: { role: { connect: { code: role } } } },
    } });
  }
  for (const username of ["admin", "manager", "cashier", "stock_staff"]) {
    clients.set(username, sessionResponseSchema.parse(await json(request(
      "auth/login", { input: { username, password } },
    ), 200)));
  }
  categoryId = (await json<{ id: string }>(request("catalog/categories", { input: { name: "ของแห้ง" } }), 201)).id;
  supplierId = (await json<{ id: string }>(request("catalog/suppliers", { input: { name: "โรงสี" } }), 201)).id;
});

afterAll(() => testDatabase.drop());

it("enforces catalog and inventory permissions while preserving the auth response for existing clients", async () => {
  expect(clients.get("admin")?.profile.permissions).toEqual(expect.arrayContaining(["session:use", "device:enroll"]));
  expect(clients.get("stock_staff")?.profile.capabilities).toContain("inventory:receive");
  await json(request("catalog/products", { username: "manager" }), 200);
  await json(request("catalog/products", { username: "manager", input: item("DENIED") }), 403);
  await json(request("catalog/products", { username: "cashier" }), 403);
  await json(request("inventory/receipts", {
    username: "manager", key: crypto.randomUUID(), input: { supplierId, lines: [] },
  }), 403);
  await json(request("catalog/products", { username: "stock_staff", input: item("STAFF") }), 201);
});

it("manages suppliers without breaking existing receipt references or retries", async () => {
  const input = { name: "ผู้จัดจำหน่ายทดสอบ", contactName: "คุณสมใจ", phone: "0812345678", email: "orders@example.test", address: "ตลาดชุมชน" };
  const supplier = await json<Supplier>(request("catalog/suppliers", { username: "stock_staff", input }), 201);
  expect(supplier).toMatchObject({ ...input, isActive: true });
  await json(request("catalog/suppliers", { input }), 409);
  await json(request("catalog/suppliers", { username: "cashier" }), 403);
  await json(request(`catalog/suppliers/${supplier.id}`, { method: "PUT", input, username: "manager" }), 403);
  const matches = await json<{ items: Supplier[] }>(request("catalog/suppliers?q=0812345"), 200);
  expect(matches.items.map(({ id }) => id)).toEqual([supplier.id]);

  const product = await json<Product>(request("catalog/products", { input: item("SUPPLIER-RECEIPT") }), 201);
  const key = crypto.randomUUID();
  const receiptInput = { supplierId: supplier.id, lines: [line(product.id, "SUPPLIER-LOT")] };
  const receipt = await json<Receipt>(request("inventory/receipts", { input: receiptInput, key }), 201);
  const statusPath = `catalog/suppliers/${supplier.id}/status`;
  const paused = await json<Supplier>(request(statusPath, { method: "PATCH", input: { isActive: false } }), 200);
  expect(paused.isActive).toBe(false);
  const updated = await json<Supplier>(request(`catalog/suppliers/${supplier.id}`, { method: "PUT", input: { ...input, name: "ชื่อใหม่" } }), 200);
  expect(updated).toMatchObject({ id: supplier.id, name: "ชื่อใหม่", isActive: false });
  const active = await json<{ items: Supplier[] }>(request("catalog/suppliers"), 200);
  expect(active.items).not.toContainEqual(expect.objectContaining({ id: supplier.id }));
  const inactive = await json<{ items: Supplier[] }>(request("catalog/suppliers?status=inactive"), 200);
  expect(inactive.items).toContainEqual(updated);

  const blocked = await json<{ code: string }>(request("inventory/receipts", { input: receiptInput, key: crypto.randomUUID() }), 409);
  expect(blocked.code).toBe("SUPPLIER_INACTIVE");
  const replay = await json<Receipt>(request("inventory/receipts", { input: receiptInput, key }), 200);
  expect(replay.id).toBe(receipt.id);
  const lots = await json<{ items: (Lot & { supplierName: string })[] }>(request(`inventory/lots?productId=${product.id}`), 200);
  expect(lots.items).toEqual([expect.objectContaining({ lotNumber: "SUPPLIER-LOT", supplierName: updated.name, remainingQuantity: "12.000" })]);
  await json(request(statusPath, { method: "PATCH", input: { isActive: true } }), 200);
  await json(request("inventory/receipts", { input: receiptInput, key: crypto.randomUUID() }), 201);
});

it("creates, searches, edits and deactivates products with exact prices and optional unique barcodes", async () => {
  const payload = item(" rice-001 ", false, ["000123", "000456"]);
  const product = await json<Product>(request("catalog/products", { input: payload }), 201);
  expect(product).toMatchObject({ sku: "RICE-001", regularPrice: "10.10", memberPrice: "9.05" });
  expect(product.barcodes).toEqual(["000123", "000456"]);
  const search = await json<{ items: Product[] }>(request("catalog/products?q=000123"), 200);
  expect(search.items.map(({ id }) => id)).toEqual([product.id]);
  const untagged = await json<Product>(request("catalog/products", { input: item("RICE-002") }), 201);
  expect(untagged.barcodes).toEqual([]);
  await json(request("catalog/products", { input: item("rice-001") }), 409);
  await json(request("catalog/products", { input: { ...item("bad-price"), regularPrice: 9.05 } }), 400);
  await json(request("catalog/products/" + untagged.id, {
    method: "PUT", input: { ...item("RICE-002"), barcodes: ["000123"] },
  }), 409);
  const edited = await json<Product>(request("catalog/products/" + product.id, {
    method: "PUT", input: { ...payload, isActive: false, memberPrice: "8.25" },
  }), 200);
  expect(edited).toMatchObject({ isActive: false, memberPrice: "8.25" });
  expect(edited.barcodes).toEqual(product.barcodes);
});

it("filters autocomplete records before pagination and lets cashiers browse a category without exposing costs", async () => {
  const category = await json<{ id: string; name: string }>(request("catalog/categories", { input: { name: "กลุ่มทดสอบตัวเลือก" } }), 201);
  const make = (sku: string, settings: object) => json<Product>(request("catalog/products", {
    input: { ...item(sku), categoryId: category.id, ...settings },
  }), 201);
  await make("PICKER-01", { isActive: false });
  const untracked = await make("PICKER-02", { trackStock: false });
  const tracked = await make("PICKER-03", { barcodes: ["009977"], name: "สินค้ารับเข้า" });
  const options = await json<{ items: Product[]; nextCursor: string | null }>(request("catalog/products?q=PICKER&receivable=true&limit=1"), 200);
  expect(options.items.map(({ id }) => id)).toEqual([tracked.id]);
  expect(options.nextCursor).toBeNull();
  expect(options.items[0]).toHaveProperty("categoryName", category.name);
  expect(await json(request("sales/categories?q=" + encodeURIComponent("ตัวเลือก"), { username: "cashier" }), 200))
    .toMatchObject({ items: [category] });
  const browse = await json<{ items: Product[] }>(request(`sales/products?q=&mode=browse&categoryId=${category.id}`, { username: "cashier" }), 200);
  expect(browse.items.map(({ id }) => id)).toEqual([untracked.id, tracked.id]);
  expect(browse.items[1]).toMatchObject({ barcodes: ["009977"], memberPrice: "9.05" });
  for (const result of browse.items) expect(result).not.toHaveProperty("costPrice");

  const current = await json<MemberProfile>(request("members", { input: { number: "PICKER-01", name: "สมาชิกต้นทาง" } }), 201);
  await json(request("members", { input: { number: "PICKER-02", name: "สมาชิกปิดใช้งาน", isActive: false } }), 201);
  const recipient = await json<MemberProfile>(request("members", { input: { number: "PICKER-03", name: "สมาชิกปลายทาง" } }), 201);
  expect(await json(request(`members?q=PICKER&activeOnly=true&excludeId=${current.id}&limit=1`, { username: "manager" }), 200))
    .toMatchObject({ items: [{ id: recipient.id }], nextCursor: null });
});

it("receives lots atomically, validates expiration and conversions, and deduplicates concurrent retries", async () => {
  const product = await json<Product>(request("catalog/products", { input: item("RECEIVE", true) }), 201);
  const correct = line(product.id, "LOT-1", "2027-02-01");
  await json(receive([correct, line(product.id, "MISSING-DATE")]), 400);
  await json(receive([{ ...correct, unit: "ส่วน", quantity: "0.333" }]), 400);
  expect(await db.stockLot.count({ where: { productId: product.id } })).toBe(0);
  const key = crypto.randomUUID();
  const results = await Promise.all([receive([correct], key), receive([correct], key)]);
  expect(results.map(({ status }) => status).sort()).toEqual([200, 201]);
  const receipts = await Promise.all(results.map(async (result) => await result.json() as Receipt));
  expect(receipts[0].id).toBe(receipts[1].id);
  expect(receipts[0].lots[0]).toMatchObject({
    remainingQuantity: "12.000", unitCost: "2.3456", expirationDate: "2027-02-01",
  });
  expect(await db.stockMovement.count({ where: { lotId: receipts[0].lots[0].id } })).toBe(1);
  await json(receive([{ ...correct, quantity: "2" }], key), 409);
  await json(request("catalog/products/" + product.id, {
    method: "PUT", input: { ...item("RECEIVE", true), baseUnit: "แพ็ค" },
  }), 409);
  await json(request("inventory/lots?productId=" + product.id), 200);
  await json(request("inventory/movements?productId=" + product.id), 200);
  await expect(db.stockLot.update({
    where: { id: receipts[0].lots[0].id }, data: { remainingQuantity: "-1.000" },
  })).rejects.toThrow();
  await expect(db.stockMovement.deleteMany({
    where: { lotId: receipts[0].lots[0].id },
  })).rejects.toThrow();
});

it("deducts FEFO by Bangkok business date and FIFO by arrival, atomically across concurrent requests", async () => {
  const fefo = await json<Product>(request("catalog/products", { input: item("FEFO", true) }), 201);
  const fifo = await json<Product>(request("catalog/products", { input: item("FIFO") }), 201);
  const late = (await json<Receipt>(receive([line(fefo.id, "LATE", "2027-02-02")]), 201)).lots[0];
  const early = (await json<Receipt>(receive([line(fefo.id, "EARLY", "2027-01-01")]), 201)).lots[0];
  const expired = (await json<Receipt>(receive([line(fefo.id, "EXPIRED", "2026-12-31")]), 201)).lots[0];
  const oldest = (await json<Receipt>(receive([line(fifo.id, "FIRST")]), 201)).lots[0];
  await json(receive([line(fifo.id, "SECOND")]), 201);
  const midnightBangkok = new Date("2026-12-31T17:00:00.000Z");
  const allocation = await db.$transaction((tx) => deductStock(tx, storeId, fefo.id, "13", midnightBangkok));
  expect(allocation.map(({ lotId, quantity, unitCost }) => [lotId, quantity.toFixed(3), unitCost.toFixed(4)]))
    .toEqual([[early.id, "12.000", "2.3456"], [late.id, "1.000", "2.3456"]]);
  expect((await db.stockLot.findUniqueOrThrow({ where: { id: expired.id } })).remainingQuantity.toFixed(3)).toBe("12.000");
  const fifoDeduction = await db.$transaction((tx) => deductStock(tx, storeId, fifo.id, "1"));
  expect(fifoDeduction[0].lotId).toBe(oldest.id);

  const take = () => db.$transaction((tx) => deductStock(tx, storeId, fefo.id, "11", midnightBangkok));
  const raced = await Promise.allSettled([take(), take()]);
  expect(raced.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
  expect(raced.find((result) => result.status === "rejected")).toMatchObject({
    reason: { code: "INSUFFICIENT_STOCK" },
  });
  expect((await db.stockLot.findUniqueOrThrow({ where: { id: late.id } })).remainingQuantity.toFixed(3)).toBe("0.000");
});

it("previews imports without writes, validates conflicts at commit, and replays a valid batch once", async () => {
  const { name: category } = await db.category.findUniqueOrThrow({ where: { id: categoryId } });
  const productRow = (row: number, sku: string, code: string) => ({
    row, cells: [sku, "ข้าวกล้อง", category, "ถุง", "2.3456", "10.10", "9.05", code, "ลัง=12", "true", "false"],
  });
  const first = productRow(2, "IMPORT-A", "000019");
  const second = productRow(3, "IMPORT-B", "000020");
  const preview = (rows: typeof first[]) => request("catalog/import/preview", { input: { rows } });
  const commit = (rows: typeof first[], key = crypto.randomUUID()) =>
    request("catalog/import/commit", { key, input: { rows } });
  expect(await json(preview([first, second]), 200)).toMatchObject({ valid: true });
  expect(await db.product.count({ where: { sku: { startsWith: "IMPORT-" } } })).toBe(0);

  const duplicate = productRow(3, "import-a", "000019");
  expect(await json(preview([first, duplicate]), 200)).toMatchObject({
    valid: false,
    rows: [{ row: 2, issues: ["duplicateSku", "duplicateBarcode"] }, { row: 3, issues: ["duplicateSku", "duplicateBarcode"] }],
  });
  await json(commit([first, duplicate]), 409);
  expect(await db.product.count({ where: { sku: { startsWith: "IMPORT-" } } })).toBe(0);

  await json(request("catalog/products", { input: item("IMPORT-B") }), 201);
  await json(commit([first, second]), 409);
  expect(await db.product.findFirst({ where: { sku: "IMPORT-A" } })).toBeNull();

  const key = crypto.randomUUID();
  const results = await Promise.all([commit([first], key), commit([first], key)]);
  for (const result of results) expect(await json(result, 201)).toEqual({ createdCount: 1 });
  expect(await db.product.count({ where: { sku: "IMPORT-A" } })).toBe(1);
  expect(await db.productBarcode.findUnique({ where: { code: "000019" } })).not.toBeNull();
  await json(commit([second], key), 409);
});

it("requires separate authorization and adjusts each counted lot once, rejecting stale counts", async () => {
  const product = await json<Product>(request("catalog/products", { input: item("COUNT-ITEM") }), 201);
  const lot = (await json<Receipt>(receive([line(product.id, "COUNT-LOT")]), 201)).lots[0];
  const key = crypto.randomUUID();
  const input = { reason: "ตรวจนับประจำวัน", lines: [{ lotId: lot.id, expected: "12.000", counted: "10.500" }] };
  const submit = (options = { key, input, username: "stock_staff" }) => request("inventory/counts", options);
  const review = (id: string, decision: "APPROVED" | "REJECTED", username = "manager") =>
    request(`inventory/counts/${id}/review`, { username, input: { decision } });
  const pending = await json<{ id: string }>(submit(), 201);
  expect(await json(submit(), 201)).toMatchObject({ id: pending.id, status: "PENDING" });
  const stale = await json<{ id: string }>(submit({
    key: crypto.randomUUID(), input: { ...input, reason: "ตรวจนับอีกครั้ง" }, username: "stock_staff",
  }), 201);
  await json(review(pending.id, "APPROVED", "stock_staff"), 403);
  expect((await db.stockLot.findUniqueOrThrow({ where: { id: lot.id } })).remainingQuantity.toFixed(3)).toBe("12.000");
  const reviewed = await Promise.all([review(pending.id, "APPROVED"), review(pending.id, "APPROVED")]);
  for (const response of reviewed) expect(await json(response, 200)).toMatchObject({ status: "APPROVED" });
  await json(review(pending.id, "REJECTED"), 409);
  await json(review(stale.id, "APPROVED"), 409);
  await json(review(stale.id, "REJECTED"), 200);
  expect((await db.stockLot.findUniqueOrThrow({ where: { id: lot.id } })).remainingQuantity.toFixed(3)).toBe("10.500");
  const movements = await db.stockMovement.findMany({ where: { lotId: lot.id, kind: "ADJUSTMENT" } });
  expect(movements).toHaveLength(1);
  expect(movements[0].quantity.toFixed(3)).toBe("-1.500");
  expect(movements[0].adjustmentId).not.toBeNull();
});

it("checks cashier lookup scope and posts split payment, FEFO allocations, and exact snapshots once", async () => {
  const input = { ...item("SALE-TEA", true, ["000088"]), regularPrice: "2.01" };
  const product = await json<Product>(request("catalog/products", { input }), 201);
  const disabled = await json<Product>(request("catalog/products", {
    input: { ...item("SALE-DISABLED", false, ["000089"]), isActive: false },
  }), 201);
  const lookup = (q: string) => request("sales/products?mode=barcode&q=" + q, { username: "cashier" });
  const result = await json<{ items: Record<string, unknown>[] }>(lookup("000088"), 200);
  expect(result.items).toEqual([expect.objectContaining({ id: product.id, sku: "SALE-TEA", regularPrice: "2.01" })]);
  expect(result.items[0]).not.toHaveProperty("costPrice");
  expect(await json(lookup("000089"), 200)).toEqual({ items: [] });
  expect(disabled.id).not.toBe(product.id);
  await json(request("sales/products?mode=barcode&q=000088", { username: "stock_staff" }), 403);

  const later = (await json<Receipt>(receive([{ ...line(product.id, "LATER", "2099-01-02"), unit: "ชิ้น", quantity: "3" }]), 201)).lots[0];
  const earlier = (await json<Receipt>(receive([{
    ...line(product.id, "EARLIER", "2099-01-01"), unit: "ชิ้น", quantity: "1", unitCostPerBaseUnit: "1.0123",
  }]), 201)).lots[0];
  const sale = {
    lines: [{ productId: product.id, unit: "ชิ้น", quantity: "1.500", expectedBasePrice: "2.01" }],
    payments: [
      { method: "CASH", amount: "2.02", tendered: "5.00" },
      { method: "PROMPTPAY", amount: "1.00", reference: "SLIP-TEST" },
    ],
  };
  const place = (input: typeof sale, key = crypto.randomUUID(), username = "cashier") =>
    request("sales", { username, key, input });
  await json(place(sale, crypto.randomUUID(), "stock_staff"), 403);
  await json(place({ ...sale, payments: [{ method: "CASH", amount: "3.02", tendered: "3.01" }] }), 400);
  await json(place({ ...sale, lines: [{ ...sale.lines[0], expectedBasePrice: "2.11" }] }), 409);
  expect(await db.sale.count()).toBe(0);

  await json(request("shifts", {
    username: "cashier", key: crypto.randomUUID(), input: { openingFloat: "100.00" },
  }), 201);
  const key = crypto.randomUUID();
  const outcomes = await Promise.all([place(sale, key), place(sale, key)]);
  expect(outcomes.map(({ status }) => status).sort()).toEqual([200, 201]);
  const invoices = await Promise.all(outcomes.map((response) =>
    json<{ id: string; netTotal: string; items: { id: string }[] }>(response, response.status)));
  expect(invoices[0]).toEqual(invoices[1]);
  expect(invoices[0]).toMatchObject({
    netTotal: "3.02",
    payments: [{ amount: "2.02", change: "2.98" }, { amount: "1.00", reference: "SLIP-TEST" }],
  });
  const saleItemId = invoices[0].items[0].id;
  const allocations = await db.saleItemLotAllocation.findMany({ where: { saleItemId }, orderBy: { unitCostSnapshot: "asc" } });
  expect(allocations.map(({ lotId, quantityAllocated, unitCostSnapshot }) =>
    [lotId, quantityAllocated.toFixed(3), unitCostSnapshot.toFixed(4)])).toEqual([
    [earlier.id, "1.000", "1.0123"], [later.id, "0.500", "2.3456"],
  ]);
  expect(await db.stockMovement.count({ where: { saleItemId } })).toBe(2);
  await json(place({ ...sale, payments: [{ method: "CASH", amount: "3.02", tendered: "5.00" }] }, key), 409);
  await json(request("catalog/products/" + product.id, {
    method: "PUT", input: { ...input, name: "ชื่อแก้ไขแล้ว", regularPrice: "3.00", costPrice: "9.9999" },
  }), 200);
  expect(await json(place(sale, key), 200)).toEqual(invoices[0]);
  expect((await db.saleItemLotAllocation.findUniqueOrThrow({ where: { id: allocations[0].id } })).unitCostSnapshot.toFixed(4)).toBe("1.0123");
});

it("commits one last-unit sale across terminals and rolls back a failed multi-line sale", async () => {
  const first = await json<Product>(request("catalog/products", { input: item("SALE-RACE") }), 201);
  const second = await json<Product>(request("catalog/products", { input: item("SALE-NO-STOCK") }), 201);
  const lot = (await json<Receipt>(receive([{ ...line(first.id, "LAST"), unit: "ชิ้น", quantity: "1" }]), 201)).lots[0];
  const terminal = { device: newToken() };
  const enrollment = await request("devices/enroll", {
    terminal, input: { username: "admin", password, deviceName: "เครื่องขายที่สอง" },
  });
  expect(enrollment.status).toBe(204);
  const login = await json<SessionResponse>(request("auth/login", { terminal, input: { username: "cashier", password } }), 200);
  const secondTerminal = { ...terminal, access: login.accessToken };
  await json(request("shifts", {
    terminal: secondTerminal, key: crypto.randomUUID(), input: { openingFloat: "50.00" },
  }), 201);
  const saleLine = (product: Product) =>
    ({ productId: product.id, unit: "ชิ้น", quantity: "1", expectedBasePrice: product.regularPrice });
  const cash = (amount: string) => ({ method: "CASH", amount, tendered: amount });

  const before = await db.sale.count();
  await json(request("sales", {
    username: "cashier", key: crypto.randomUUID(),
    input: { lines: [saleLine(first), saleLine(second)], payments: [cash("20.20")] },
  }), 409);
  expect(await db.sale.count()).toBe(before);
  expect(await db.saleItem.count({ where: { productId: first.id } })).toBe(0);
  expect(await db.stockMovement.count({ where: { lotId: lot.id, kind: "SALE" } })).toBe(0);

  const one = { lines: [saleLine(first)], payments: [cash("10.10")] };
  const outcomes = await Promise.all([
    request("sales", { username: "cashier", key: crypto.randomUUID(), input: one }),
    request("sales", { terminal: secondTerminal, key: crypto.randomUUID(), input: one }),
  ]);
  expect(outcomes.map(({ status }) => status).sort()).toEqual([201, 409]);
  expect(await db.sale.count()).toBe(before + 1);
  expect(await db.stockMovement.count({ where: { lotId: lot.id, kind: "SALE" } })).toBe(1);
  expect((await db.stockLot.findUniqueOrThrow({ where: { id: lot.id } })).remainingQuantity.toFixed(3)).toBe("0.000");
});

it("claims a held bill once and consumes its revision only after a successful member checkout", async () => {
  const product = await json<Product>(request("catalog/products", {
    input: { ...item("HOLD-MEMBER"), trackStock: false },
  }), 201);
  const member = await json<{ id: string }>(request("sales/members", {
    username: "manager", input: { number: "M001", name: "สมาชิกทดสอบ", barcode: "000510", phone: "0812345678" },
  }), 201);
  await json(request("sales/members", { username: "cashier", input: { number: "M002", name: "ไม่ได้รับสิทธิ์" } }), 403);
  expect(await json(request("sales/members?q=000510", { username: "cashier" }), 200)).toEqual({
    items: [{ id: member.id, number: "M001", name: "สมาชิกทดสอบ" }],
  });
  const id = crypto.randomUUID();
  const draft = {
    memberId: member.id, note: "พักไว้ก่อน",
    lines: [{ productId: product.id, unit: "ชิ้น", quantity: "1", expectedBasePrice: "9.05" }],
  };
  for (let retry = 0; retry < 2; retry++) expect(await json(request("sales/held/" + id, {
    method: "PUT", username: "cashier", input: draft,
  }), 200)).toMatchObject({ revision: 1, held: true });
  const adminDevice = { device: newToken() };
  expect((await request("devices/enroll", {
    terminal: adminDevice, input: { username: "admin", password, deviceName: "เครื่องผู้จัดการ" },
  })).status).toBe(204);
  const adminLogin = await json<SessionResponse>(request("auth/login", { terminal: adminDevice, input: { username: "admin", password } }), 200);
  const adminTerminal = { ...adminDevice, access: adminLogin.accessToken };
  await json(request("shifts", {
    terminal: adminTerminal, key: crypto.randomUUID(), input: { openingFloat: "50.00" },
  }), 201);

  const claims = await Promise.all([
    request(`sales/held/${id}/resume`, { username: "cashier", input: { revision: 1 } }),
    request(`sales/held/${id}/resume`, { terminal: adminTerminal, input: { revision: 1 } }),
  ]);
  expect(claims.map(({ status }) => status).sort()).toEqual([200, 409]);
  const winner = claims[0].status === 200 ? "cashier" : "admin";
  const winnerTarget = winner === "cashier" ? { username: "cashier" } : { terminal: adminTerminal };
  const active = await json<{ revision: number }>(claims.find(({ status }) => status === 200)!, 200);
  expect(active).toMatchObject({ revision: 2, held: false });
  const { note: _note, ...payload } = draft;
  const checkout = {
    ...payload, hold: { id, revision: active.revision },
    payments: [{ method: "CASH", amount: "9.05", tendered: "10.00" }],
  };
  await json(request("sales", { ...winnerTarget, key: crypto.randomUUID(), input: { ...checkout, payments: [] } }), 400);
  const key = crypto.randomUUID();
  const receipt = await json<{ id: string }>(request("sales", { ...winnerTarget, key, input: checkout }), 201);
  expect(await json(request("sales", { ...winnerTarget, key, input: checkout }), 200)).toEqual(receipt);
  expect(await db.heldSale.findUnique({ where: { id } })).toMatchObject({ consumed: true });
  expect(await json(request("sales/held", winnerTarget), 200)).toMatchObject({ items: [] });
  const entry = await db.memberPurchaseLedger.findUniqueOrThrow({ where: { saleId: receipt.id } });
  expect(entry.netEligibleAmount.toFixed(2)).toBe("9.05");
});

it("approves discounted sales and reconciles partial returns across the original tender and lots", async () => {
  const product = await json<Product>(request("catalog/products", { input: item("RETURN-MEMBER") }), 201);
  const lot = (await json<Receipt>(receive([{ ...line(product.id, "RETURN-LOT"), unit: "ชิ้น", quantity: "3" }]), 201)).lots[0];
  const member = await db.member.findFirstOrThrow({ where: { storeId, number: "M001" } });
  const approval = { username: "manager", pin: "012345" };
  const payload = {
    memberId: member.id, billDiscount: "1.00",
    lines: [{ productId: product.id, unit: "ชิ้น", quantity: "3", expectedBasePrice: "9.05", discount: "1.15" }],
    payments: [{ method: "CASH", amount: "10.00", tendered: "10.00" }, { method: "TRANSFER", amount: "15.00", reference: "TRANSFER-1" }],
  };
  const key = crypto.randomUUID();
  await json(request("sales", { username: "cashier", key, input: payload }), 403);
  await json(request("sales", { username: "cashier", key, input: { ...payload, approval: { ...approval, pin: "999999" } } }), 401);
  const sold = await json<{ id: string; netTotal: string; items: { id: string }[] }>(
    request("sales", { username: "cashier", key, input: { ...payload, approval } }), 201);
  expect(sold.netTotal).toBe("25.00");
  expect(await json(request("sales", { username: "cashier", key, input: payload }), 200)).toEqual(sold);
  const saleApproval = await db.approvalDecision.findUniqueOrThrow({ where: { saleId: sold.id }, include: { manager: true } });
  expect(saleApproval.manager.username).toBe("manager");

  const route = `sales/${sold.id}/returns`;
  const prepare = async (disposition: string) => {
    const input = { reason: "คืนทดสอบ", lines: [{ saleItemId: sold.items[0].id, quantity: "1", disposition }] };
    const quote = await json<{ quote: string; total: string; refunds: unknown[] }>(request(route + "/quote", { username: "cashier", input }), 200);
    return { quote, input: { ...input, expectedQuote: quote.quote } };
  };
  const damaged = await prepare("DAMAGED");
  expect(damaged.quote).toMatchObject({ total: "8.33", refunds: [{ method: "CASH", amount: "8.33" }] });
  const returnKey = crypto.randomUUID();
  await json(request(route, { username: "cashier", key: returnKey, input: damaged.input }), 403);
  const first = await json<{ id: string }>(request(route, { username: "cashier", key: returnKey, input: { ...damaged.input, approval } }), 201);
  expect(await json(request(route, { username: "cashier", key: returnKey, input: damaged.input }), 200)).toEqual(first);
  expect((await db.stockLot.findUniqueOrThrow({ where: { id: lot.id } })).remainingQuantity.toFixed(3)).toBe("0.000");
  const good = await prepare("SELLABLE");
  expect(good.quote).toMatchObject({ total: "8.34", refunds: [{ method: "CASH", amount: "1.67" }, { method: "TRANSFER", amount: "6.67" }] });
  const results = await Promise.all([1, 2].map(() =>
    request(route, { username: "cashier", key: crypto.randomUUID(), input: { ...good.input, approval } })));
  expect(results.map(({ status }) => status).sort()).toEqual([201, 409]);
  const last = await prepare("SELLABLE");
  expect(last.quote).toMatchObject({ total: "8.33", refunds: [{ method: "TRANSFER", amount: "8.33" }] });
  await json(request(route, { username: "cashier", key: crypto.randomUUID(), input: { ...last.input, approval } }), 201);
  await json(request(route + "/quote", { username: "cashier", input: last.input }), 409);
  expect((await db.stockLot.findUniqueOrThrow({ where: { id: lot.id } })).remainingQuantity.toFixed(3)).toBe("2.000");
  const reversal = await db.memberPurchaseLedger.aggregate({
    _sum: { netEligibleAmount: true }, where: { saleReturn: { saleId: sold.id } },
  });
  expect(reversal._sum.netEligibleAmount?.toFixed(2)).toBe("-25.00");
  const purchasePath = `members/${member.id}/purchases`;
  const firstPage = await json<{ nextCursor: string; netTotal: string; items: { id: string }[] }>(
    request(purchasePath + "?limit=2", { username: "manager" }), 200,
  );
  expect(firstPage.netTotal).toBe("9.05");
  const rest = await json<{ items: { id: string; transactionType: string; netEligibleAmount: string }[] }>(
    request(purchasePath + "?after=" + firstPage.nextCursor, { username: "manager" }), 200,
  );
  expect(new Set([...firstPage.items, ...rest.items].map(({ id }) => id)).size).toBe(5);
  await json(request(purchasePath, { username: "cashier" }), 403);
  const allocations = await db.saleReturnAllocation.findMany({
    where: { saleAllocation: { saleItemId: sold.items[0].id } },
    include: { saleAllocation: true, movement: true },
  });
  expect(allocations).toHaveLength(3);
  expect(allocations.map(({ movement }) => movement?.kind).sort()).toEqual(["RETURN", "RETURN", "RETURN_DAMAGED"]);
  expect(allocations.every(({ saleAllocation }) => saleAllocation.unitCostSnapshot.eq("2.3456"))).toBe(true);
});

it("registers and edits profiles with encrypted IDs and active-only cashier lookup", async () => {
  const input = { number: "REG-001", name: "สมาชิกทะเบียน", phone: "0898765432", barcode: "00005923",
    address: "ที่อยู่ทดสอบ", nationalId: "1234567890123", joinedOn: "2020-01-01" };
  const member = await json<MemberProfile>(request("members", { username: "manager", input }), 201);
  const path = `members/${member.id}`;
  expect(member).toMatchObject({ name: input.name, hasNationalId: true, joinedOn: input.joinedOn, isActive: true });
  expect(member).not.toHaveProperty("nationalId");
  expect(member).not.toHaveProperty("nationalIdEncrypted");
  const directory = await json<{ items: { id: string; phone: string | null }[] }>(request("members?q=REG-001", { username: "manager" }), 200);
  expect(directory.items).toEqual([expect.objectContaining({ id: member.id, phone: "089-XXX-5432" })]);
  const detail = await json<MemberProfile>(request(path, { username: "manager" }), 200);
  expect(detail.phone).toBe(input.phone);
  expect(await db.auditLog.count({ where: { event: "MEMBER_VIEWED", reason: member.id } })).toBe(1);
  const encrypted = (await db.member.findUniqueOrThrow({ where: { id: member.id } })).nationalIdEncrypted!;
  const [version, iv, tag, ciphertext] = encrypted.split(":");
  expect(version).toBe("v1");
  const decipher = createDecipheriv("aes-256-gcm", memberEncryptionKey, Buffer.from(iv, "hex"));
  decipher.setAAD(Buffer.from(member.id));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  expect(Buffer.concat([decipher.update(Buffer.from(ciphertext, "hex")), decipher.final()]).toString()).toBe(input.nationalId);
  await json(request(path, { username: "cashier" }), 403);
  await json(request("members", { username: "manager", input }), 409);
  for (const q of [input.barcode, input.phone]) {
    expect(await json(request(`sales/members?q=${q}`, { username: "cashier" }), 200)).toEqual({
      items: [{ id: member.id, name: input.name, number: input.number }],
    });
  }
  const { nationalId: _nationalId, ...rest } = input;
  expect(await json(request(path, { username: "manager", method: "PUT", input: { ...rest, address: null, isActive: false } }), 200))
    .toMatchObject({ hasNationalId: true, isActive: false, address: null });
  expect((await db.member.findUniqueOrThrow({ where: { id: member.id } })).nationalIdEncrypted).toBe(encrypted);
  expect(await json(request(`sales/members?q=${input.phone}`, { username: "cashier" }), 200)).toEqual({ items: [] });
  const missing = crypto.randomUUID();
  await json(request(`members/${missing}`, { username: "manager" }), 404);
  await json(request(`members/${missing}/purchases`, { username: "manager" }), 404);
});

it("records shares once, transfers atomically, and prevents concurrent overdrafts and edits to history", async () => {
  async function make(number: string) {
    return json<MemberProfile>(request("members", { username: "manager", input: { number, name: number, joinedOn: "2020-01-01" } }), 201);
  }
  const [source, recipient, incompatible] = await Promise.all([make("SH-A"), make("SH-B"), make("SH-C")]);
  const path = (id: string) => `members/${id}/shares`;
  const base = { effectiveDate: "2020-01-02", reason: "ทดสอบบัญชีหุ้น" };
  const open = { ...base, type: "INITIAL", quantity: 10, unitValue: "12.51" };
  const post = (id: string, input: object, key = crypto.randomUUID(), username = "manager") => request(path(id), { input, key, username });
  const get = (id: string) => json<MemberShares>(request(path(id), { username: "manager" }), 200);
  const key = crypto.randomUUID();
  await json(post(source.id, open, key, "cashier"), 403);
  const first = await json<ShareEntry>(post(source.id, open, key), 201);
  expect(first).toMatchObject({ unitValue: "12.51", totalAmount: "125.10", shareQuantity: 10, approvedBy: "MANAGER" });
  expect(await json(post(source.id, open, key), 200)).toEqual(first);
  await json(post(source.id, { ...open, quantity: 11 }, key), 409);
  await json(post(source.id, open), 409);
  await json(post(incompatible.id, { ...open, unitValue: "10" }), 201);
  await json(post(source.id, { ...base, type: "PURCHASE_ADD", quantity: 2 }), 201);
  const transfer = { ...base, type: "TRANSFER", quantity: 3, toMemberId: recipient.id };
  await json(post(source.id, { ...transfer, toMemberId: incompatible.id }), 409);
  await json(post(source.id, { ...transfer, toMemberId: crypto.randomUUID() }), 404);
  expect((await get(source.id)).account?.totalShares).toBe(12);
  const transferKey = crypto.randomUUID();
  const moved = await json<ShareEntry>(post(source.id, transfer, transferKey), 201);
  expect(await json(post(source.id, transfer, transferKey), 200)).toEqual(moved);
  const received = await get(recipient.id);
  expect(received.account).toEqual({ totalShares: 3, shareValue: "12.51", currentBalance: "37.53" });
  expect(received.items).toEqual([expect.objectContaining({ transferId: moved.transferId, totalAmount: "37.53" })]);
  expect(moved).toMatchObject({ totalAmount: "-37.53", shareQuantity: -3 });
  const withdraw = { ...base, type: "WITHDRAWAL", quantity: 8 };
  const competing = await Promise.all([post(source.id, withdraw), post(source.id, withdraw)]);
  expect(competing.map((result) => result.status).sort()).toEqual([201, 409]);
  await json(post(source.id, { ...base, effectiveDate: "2020-01-01", type: "CORRECTION", direction: "ADD", quantity: 2 }), 400);
  await json(post(source.id, { ...base, type: "CORRECTION", direction: "ADD", quantity: 2 }), 201);
  const balance = await get(source.id);
  expect(balance.account?.currentBalance).toBe("37.53");
  expect(balance.items).toHaveLength(5);
  await expect(db.shareTransaction.update({ where: { id: first.id }, data: { reason: "เขียนทับ" } })).rejects.toThrow(/append only/);
  await expect(db.shareTransaction.delete({ where: { id: first.id } })).rejects.toThrow(/append only/);
});

it("rate limits repeated manager PIN failures on a terminal", async () => {
  const product = await json<Product>(request("catalog/products", {
    input: { ...item("PIN-RATE-LIMIT"), trackStock: false },
  }), 201);
  const base = {
    billDiscount: "1.00",
    lines: [{ productId: product.id, quantity: "1", unit: "ชิ้น", expectedBasePrice: "10.10" }],
    payments: [{ method: "CASH", amount: "9.10", tendered: "10.00" }],
  };
  for (let attempt = 1; attempt <= 6; attempt++) {
    const pin = attempt === 6 ? "012345" : "999999";
    await json(request("sales", {
      username: "cashier", key: crypto.randomUUID(), input: { ...base, approval: { username: "manager", pin } },
    }), attempt < 5 ? 401 : 429);
  }
  expect(await db.saleItem.count({ where: { productId: product.id } })).toBe(0);
});

it("persists manager PIN lockouts across terminals, blocks self-approval, and requires expectedQuote on returns", async () => {
  const noStock = await json<Product>(request("catalog/products", {
    input: { ...item("SELF-APPROVAL"), trackStock: false },
  }), 201);

  const secondToken = newToken();
  const enrollRes = await request("devices/enroll", {
    terminal: { device: secondToken },
    input: { username: "admin", password, deviceName: "จุดขายรอง" },
  });
  expect(enrollRes.status).toBe(204);
  const cashierTwo = await json<SessionResponse>(request("auth/login", {
    terminal: { device: secondToken },
    input: { username: "cashier", password },
  }), 200);

  // Manager is already locked out from the previous test: valid PIN on a second terminal must remain rate-limited.
  await json(request("sales", {
    terminal: { device: secondToken, access: cashierTwo.accessToken },
    key: crypto.randomUUID(),
    input: {
      billDiscount: "1.00",
      lines: [{ productId: noStock.id, quantity: "1", unit: "ชิ้น", expectedBasePrice: "10.10" }],
      payments: [{ method: "TRANSFER", amount: "9.10", reference: "RATE-CROSS" }],
      approval: { username: "manager", pin: "012345" },
    },
  }), 429);

  // Manager/Admin cannot self-approve a discounted sale.
  await json(request("sales", {
    username: "admin",
    key: crypto.randomUUID(),
    input: {
      billDiscount: "1.00",
      lines: [{ productId: noStock.id, quantity: "1", unit: "ชิ้น", expectedBasePrice: "10.10" }],
      payments: [{ method: "TRANSFER", amount: "9.10", reference: "SELF-DISC" }],
      approval: { username: "admin", pin: "012345" },
    },
  }), 403);

  // Sale succeeds with non-cash transfer without discount, and return submission requires expectedQuote.
  const sale = await json<{ id: string; items: { id: string }[] }>(request("sales", {
    username: "admin",
    key: crypto.randomUUID(),
    input: {
      lines: [{ productId: noStock.id, quantity: "1", unit: "ชิ้น", expectedBasePrice: "10.10" }],
      payments: [{ method: "TRANSFER", amount: "10.10", reference: "NO-QUOTE-RET" }],
    },
  }), 201);
  await json(request(`sales/${sale.id}/returns`, {
    username: "admin",
    key: crypto.randomUUID(),
    input: { reason: "ไม่มี quote", lines: [{ saleItemId: sale.items[0]!.id, quantity: "1", disposition: "SELLABLE" }] },
  }), 400);
});
