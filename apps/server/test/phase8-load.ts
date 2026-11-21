import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import type { AccountingPeriod, DividendPreview, PayoutObligation, SessionResponse } from "@thepos/contracts";
import { seedRoles } from "../prisma/roles";
import { createApp } from "../src/app";
import { newToken } from "../src/core/security";
import { isolatedDatabase } from "./isolated-db";

const target = new URL(process.env.TEST_DATABASE_URL ?? "");
assert(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname), "Use a local test PostgreSQL server");
const database = isolatedDatabase();
const { db } = database;
const secret = newToken();
const password = newToken();
const businessDay = "2026-11-17";
let clock = Date.parse(businessDay + "T08:00:00Z");
const app = createApp(db, { jwtSecret: newToken(), bootstrapSecret: secret, now: () => clock });
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
const api = `http://127.0.0.1:${server.port}/api/v1/`;
const cashierCount = 5;
const billsPerCashier = 2_000;
const bills = cashierCount * billsPerCashier;
type Terminal = { device: string; access?: string };
const admin: Terminal = { device: newToken() };

async function request<T>(terminal: Terminal, path: string, expected: number, input?: unknown, key?: string, method = input === undefined ? "GET" : "POST") {
  const response = await fetch(api + path, {
    method,
    headers: {
      "content-type": "application/json", "x-device-token": terminal.device,
      ...(terminal.access && { authorization: "Bearer " + terminal.access }),
      ...(key && { "idempotency-key": key }),
    },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const content = await response.text();
  const data = content ? JSON.parse(content) : null;
  assert.equal(response.status, expected, `${method} ${path} · ${data?.code ?? "unexpected HTTP status"}`);
  return data as T;
}

async function login(terminal: Terminal, username: string) {
  terminal.access = (await request<SessionResponse>(terminal, "auth/login", 200, { username, password })).accessToken;
}

function p95(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * .95) - 1]! * 100) / 100;
}

await database.create();
try {
  database.migrate();
  await seedRoles(db);
  await request(admin, "setup/bootstrap", 201, {
    secret, username: "admin", password, pin: "012345", displayName: "ผู้ดูแลตรวจรับ",
    deviceName: "เครื่องจัดการ", storeName: "สหกรณ์ตรวจรับ Phase 8",
  });
  await login(admin, "admin");
  const owner = await db.user.findUniqueOrThrow({ where: { username: "admin" } });
  const cashiers: Terminal[] = [];
  for (let index = 1; index <= cashierCount; index++) {
    const username = `cashier${index}`;
    await db.user.create({ data: {
      storeId: owner.storeId, username, name: `แคชเชียร์ ${index}`, passwordHash: owner.passwordHash, pinHash: owner.pinHash,
      roles: { create: { role: { connect: { code: "CASHIER" } } } },
    } });
    const terminal: Terminal = { device: newToken() };
    await request(terminal, "devices/enroll", 204, { username: "admin", password, deviceName: `จุดขาย ${index}` });
    await login(terminal, username);
    await request(terminal, "shifts", 201, { openingFloat: "0.00" }, crypto.randomUUID());
    cashiers.push(terminal);
  }
  const category = await request<{ id: string }>(admin, "catalog/categories", 201, { name: "สินค้า" });
  const supplier = await request<{ id: string }>(admin, "catalog/suppliers", 201, { name: "คู่ค้าตรวจรับ" });
  async function product(sku: string, name: string, quantity: string) {
    const item = await request<{ id: string }>(admin, "catalog/products", 201, {
      categoryId: category.id, sku, name, baseUnit: "ชิ้น", costPrice: "4.00", regularPrice: "10.10", memberPrice: "9.05",
    });
    await request(admin, "inventory/receipts", 201, { supplierId: supplier.id, lines: [
      { productId: item.id, unit: "ชิ้น", quantity, lotNumber: sku, unitCostPerBaseUnit: "4.00" },
    ] }, crypto.randomUUID());
    return item;
  }
  const last = await product("LAST-UNIT", "สินค้าชิ้นสุดท้าย", "1");
  const item = await product("PHASE8-LOAD", "ข้าวสารตรวจรับ", String(bills));
  await db.product.createMany({ data: Array.from({ length: 3_000 }, (_, index) => ({
    storeId: owner.storeId, categoryId: category.id, sku: `CATALOG-${index}`, name: `สินค้าในทะเบียน ${index}`,
    baseUnit: "ชิ้น", costPrice: "4.00", regularPrice: "10.10", memberPrice: "9.05",
  })) });
  const member = await request<{ id: string }>(admin, "members", 201, { name: "สมาชิกตรวจรับ", number: "LOAD001", joinedOn: "2025-01-01" });
  await request(admin, `members/${member.id}/shares`, 201, {
    type: "INITIAL", effectiveDate: "2025-01-02", quantity: 10, unitValue: "12.51", reason: "เปิดบัญชีทดสอบ",
  }, crypto.randomUUID());
  const saleInput = (productId: string, amount: string, memberId?: string) => ({
    drawer: true, memberId,
    lines: [{ productId, unit: "ชิ้น", quantity: "1", expectedBasePrice: amount }],
    payments: [{ method: "CASH", amount, tendered: amount }],
  });
  const race = await Promise.all(cashiers.map(async (terminal) => {
    const key = crypto.randomUUID();
    const input = saleInput(last.id, "10.10");
    const response = await fetch(api + "sales", {
      method: "POST", headers: { "content-type": "application/json", "x-device-token": terminal.device,
        authorization: "Bearer " + terminal.access, "idempotency-key": key }, body: JSON.stringify(input),
    });
    return { terminal, input, key, status: response.status, result: await response.json() };
  }));
  assert.deepEqual(race.map(({ status }) => status).sort(), [201, 409, 409, 409, 409]);
  assert(race.filter(({ status }) => status === 409).every(({ result }) => result.code === "INSUFFICIENT_STOCK"));
  const winner = race.find(({ status }) => status === 201)!;
  const replay = await request<{ id: string }>(
    winner.terminal, "sales", 200, winner.input, winner.key,
  );
  assert.equal(replay.id, winner.result.id);
  console.log("Five devices raced for the last unit. One sale and four insufficient-stock responses.");

  const lookup: number[] = [];
  const checkout: number[] = [];
  const workloadStarted = performance.now();
  let posted = 0;
  const workers = await Promise.allSettled(cashiers.map(async (terminal) => {
    const input = saleInput(item.id, "9.05", member.id);
    const search = "sales/products?mode=search&q=PHASE8-LOAD";
    for (let index = 0; index < billsPerCashier; index++) {
      if (index % 10 === 0) {
        const at = performance.now();
        const result = await request<{ items: { id: string }[] }>(terminal, search, 200);
        lookup.push(performance.now() - at);
        assert.equal(result.items[0]?.id, item.id);
      }
      const at = performance.now();
      await request(terminal, "sales", 201, input, crypto.randomUUID());
      checkout.push(performance.now() - at);
      posted++;
      if (posted % 1_000 === 0) console.log(`Posted ${posted}/${bills} member sales`);
    }
  }));
  const failures = workers.filter((worker) => worker.status === "rejected");
  if (failures.length) throw new AggregateError(failures.map(({ reason }) => reason), "Cashier workload failed");
  const elapsedSeconds = Math.round((performance.now() - workloadStarted) / 1_000);
  assert.equal(posted, bills);

  const sales = await db.sale.aggregate({ where: { memberId: member.id }, _count: true, _sum: { netTotal: true } });
  const ledger = await db.memberPurchaseLedger.aggregate({ where: { memberId: member.id }, _count: true, _sum: { netEligibleAmount: true } });
  const lots = await db.stockLot.findMany({ where: { productId: { in: [last.id, item.id] } } });
  const expectedSales = new Prisma.Decimal("9.05").times(bills).toFixed(2);
  assert.equal(await db.sale.count(), bills + 1);
  assert.equal(sales._count, bills);
  assert.equal(ledger._count, bills);
  assert.equal(sales._sum.netTotal?.toFixed(2), expectedSales);
  assert.equal(ledger._sum.netEligibleAmount?.toFixed(2), expectedSales);
  assert.equal(lots.length, 2);
  assert(lots.every((lot) => lot.remainingQuantity.isZero()));

  clock += 86_400_000;
  await login(admin, "admin");
  const rule = await request<{ id: string }>(admin, "dividends/rules", 201, {
    name: "กฎตรวจรับ", formula: "CLOSING_BALANCE", dividendRate: "10", rebateRate: "2",
  });
  const period = await request<AccountingPeriod>(admin, "dividends/periods", 201, {
    name: "งวดตรวจรับ 10,000 บิล", startDate: businessDay, endDate: businessDay, ruleId: rule.id,
  });
  const periodPath = `dividends/periods/${period.id}`;
  const calculated = await request<AccountingPeriod>(admin, periodPath + "/preview", 200, undefined, undefined, "POST");
  await request(admin, periodPath + "/approve", 200, { runId: calculated.currentRunId });
  const preview = await request<DividendPreview>(admin, periodPath + "/preview", 200);
  const obligations = await request<{ items: PayoutObligation[] }>(admin, periodPath + "/obligations", 200);
  const dividend = new Prisma.Decimal("12.51").times(10).times("0.10");
  const rebate = new Prisma.Decimal(expectedSales).times("0.02");
  const expectedObligation = dividend.plus(rebate);
  assert.equal(preview.dividendTotal, dividend.toFixed(2));
  assert.equal(preview.rebateTotal, rebate.toFixed(2));
  assert.equal(preview.items.find((row) => row.memberId === member.id)?.eligiblePurchases, expectedSales);
  assert.equal(obligations.items.length, 1);
  const difference = expectedObligation.minus(obligations.items[0]!.total).toFixed(2);
  assert.equal(difference, "0.00");

  const evidence = {
    cashierCount, catalogProducts: 3_002, memberBills: posted, elapsedSeconds,
    lastUnitRace: { committed: 1, rejected: 4, replayedWithoutDuplicate: true },
    lookup: { samples: lookup.length, p95Ms: p95(lookup) },
    checkout: { samples: checkout.length, p95Ms: p95(checkout) },
    reconciliation: { sales: expectedSales, dividend: dividend.toFixed(2), rebate: rebate.toFixed(2),
      obligation: expectedObligation.toFixed(2), difference },
  };
  await mkdir("output/playwright", { recursive: true });
  await Bun.write("output/playwright/phase8-load.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
  assert(evidence.lookup.p95Ms < 300, "Lookup P95 must be below 300ms");
  assert(evidence.checkout.p95Ms < 2_000, "Checkout P95 must be below 2,000ms");
} finally {
  server.stop(true);
  await database.drop();
}
