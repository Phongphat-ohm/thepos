import { afterAll, beforeAll, expect, it } from "vitest";
import type { AccountingPeriod, DividendPreview, DividendRule, Page, PayoutObligation, PayoutReceipt, SessionResponse } from "@thepos/contracts";
import { seedRoles } from "../prisma/roles";
import { createApp } from "../src/app";
import { newToken } from "../src/core/security";
import { isolatedDatabase } from "./isolated-db";

const database = isolatedDatabase();
const { db } = database;
const bootstrapSecret = newToken();
const deviceToken = newToken();
const password = "dividend integration password";
const now = () => Date.parse("2026-02-15T05:00:00Z");
const app = createApp(db, { jwtSecret: newToken(), bootstrapSecret, now });
const access = new Map<string, string>();
let storeId: string;
let adminId: string;
let deviceId: string;

function request(path: string, options: { user?: string; input?: unknown; method?: string; key?: string } = {}) {
  const { user = "admin", input, method = input === undefined ? "GET" : "POST", key } = options;
  const headers = new Headers({ "x-device-token": deviceToken, "content-type": "application/json" });
  if (access.has(user)) headers.set("authorization", "Bearer " + access.get(user));
  if (key) headers.set("idempotency-key", key);
  return app.request("/api/v1/" + path, { method, headers, body: input === undefined ? undefined : JSON.stringify(input) });
}

async function json<T = unknown>(pending: Promise<Response> | Response, status: number) {
  const response = await pending;
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(status);
  return body as T;
}

beforeAll(async () => {
  await database.create();
  database.migrate();
  await seedRoles(db);
  expect((await request("setup/bootstrap", { input: {
    username: "admin", password, pin: "123456", secret: bootstrapSecret, storeName: "สหกรณ์ทดสอบ", displayName: "ผู้ดูแล", deviceName: "POS",
  } })).status).toBe(201);
  const admin = await db.user.findUniqueOrThrow({ where: { username: "admin" } });
  storeId = admin.storeId;
  adminId = admin.id;
  deviceId = (await db.device.findFirstOrThrow({ where: { storeId } })).id;
  for (const role of ["MANAGER", "CASHIER"] as const) {
    await db.user.create({ data: { storeId, username: role.toLowerCase(), name: role,
      passwordHash: admin.passwordHash, pinHash: admin.pinHash, roles: { create: { role: { connect: { code: role } } } },
    } });
  }
  for (const username of ["admin", "manager", "cashier"]) {
    const { accessToken } = await json<SessionResponse>(request("auth/login", { input: { username, password } }), 200);
    access.set(username, accessToken);
  }
});

afterAll(() => database.drop());

const rulePath = "dividends/rules";
const periodPath = "dividends/periods";
const period = (id: string) => periodPath + "/" + id;
const payoutPath = (id: string) => `dividends/obligations/${id}/payouts`;
const key = () => crypto.randomUUID();
const ruleInput = { name: "กฎประจำปี", formula: "CLOSING_BALANCE", dividendRate: "5", rebateRate: "2.5" };

async function member(number: string) {
  return json<{ id: string }>(request("members", { input: { number, name: number, joinedOn: "2020-01-01" } }), 201);
}
async function postShares(memberId: string, type: string, effectiveDate: string, quantity: number, unitValue?: string, status = 201) {
  return json(request(`members/${memberId}/shares`, { key: key(), input: { effectiveDate, type, quantity, unitValue, reason: "ข้อมูลทดสอบ" } }), status);
}
async function sale(memberId: string, date: string, amount: string) {
  const completedAt = new Date(date);
  return db.sale.create({ data: { storeId, memberId, cashierId: adminId, terminalId: deviceId, invoiceNumber: key(),
    subtotal: amount, netTotal: amount, completedAt,
    purchaseEntry: { create: { memberId, transactionType: "SALE", grossAmount: amount, netEligibleAmount: amount, recordedAt: completedAt } },
  } });
}
async function refund(saleId: string, memberId: string, date: string, positive: string) {
  const createdAt = new Date(date);
  const negative = "-" + positive;
  await db.saleReturn.create({ data: { saleId, storeId, cashierId: adminId, terminalId: deviceId, idempotencyKey: key(),
    payloadHash: "a".repeat(64), reason: "คืนสินค้า", netTotal: positive, createdAt,
    purchaseEntry: { create: { memberId, transactionType: "RETURN", grossAmount: negative, netEligibleAmount: negative, recordedAt: createdAt } },
  } });
}

it("versions rules, validates calendar periods and averages twelve month-end share balances", async () => {
  const input = { ...ruleInput, name: "รายเดือน", formula: "MONTHLY_AVERAGE", dividendRate: "10", rebateRate: "0" };
  await json(request(rulePath, { input, user: "manager" }), 403);
  await json(request(rulePath, { user: "cashier" }), 403);
  const rule = await json<DividendRule>(request(rulePath, { input }), 201);
  expect(await json(request(rulePath, { input }), 201)).toEqual(rule);
  expect(await json(request(rulePath, { input: { ...input, dividendRate: "9.99" } }), 201)).toMatchObject({ version: 2 });
  await expect(db.dividendRule.update({ where: { id: rule.id }, data: { rebateRate: "1" } })).rejects.toThrow(/append only/);
  const dates = { startDate: "2024-01-01", endDate: "2024-12-31", name: "ปี 2567", ruleId: rule.id };
  await json(request(periodPath, { input: { ...dates, endDate: "2024-11-30" } }), 400);
  const p = await json<AccountingPeriod>(request(periodPath, { input: dates }), 201);
  await json(request(periodPath, { input: dates }), 409);
  const m = await member("MONTHLY");
  await postShares(m.id, "INITIAL", "2024-07-01", 1, "120");
  const calculated = await json<AccountingPeriod>(request(period(p.id) + "/preview", { method: "POST" }), 200);
  const preview = await json<DividendPreview>(request(period(p.id) + "/preview", { user: "manager" }), 200);
  expect(preview).toMatchObject({ id: calculated.currentRunId, dividendTotal: "6.00", rebateTotal: "0.00",
    items: [expect.objectContaining({ memberId: m.id, shareBasis: "60.0000", dividendAmount: "6.00" })] });
});

it("reconciles satang, rejects stale approval, locks results and prevents duplicate or excessive payouts", async () => {
  const rule = await json<DividendRule>(request(rulePath, { input: ruleInput }), 201);
  const p = await json<AccountingPeriod>(request(periodPath, { input: { name: "ปี 2568", startDate: "2025-01-01", endDate: "2025-12-31", ruleId: rule.id } }), 201);
  const [first, second, negative] = await Promise.all([member("FIRST"), member("SECOND"), member("NEGATIVE")]);
  await postShares(first.id, "INITIAL", "2025-01-02", 1, "10.10");
  await postShares(second.id, "INITIAL", "2025-01-02", 1, "10.10");
  // Bangkok midnight is 17:00 UTC on the preceding calendar day.
  const bill = await sale(first.id, "2024-12-31T17:00:00Z", "100");
  await refund(bill.id, first.id, "2025-12-31T16:59:59Z", "10");
  await sale(first.id, "2025-12-31T17:00:00Z", "1000");
  const old = await sale(negative.id, "2024-12-31T16:59:59Z", "50");
  await refund(old.id, negative.id, "2025-01-02T05:00:00Z", "50");
  const previewPath = period(p.id) + "/preview";
  const approvalPath = period(p.id) + "/approve";
  const calc = await json<AccountingPeriod>(request(previewPath, { method: "POST" }), 200);
  const preview = await json<DividendPreview>(request(previewPath), 200);
  expect(preview.negativePurchases).toBe(1);
  expect(preview.rebateTotal).toBe("2.25");
  expect(preview.items.find(({ memberId }) => memberId === negative.id)).toMatchObject({ eligiblePurchases: "-50.00", rebateAmount: "0.00" });
  expect(preview.items.filter(({ memberId }) => [first.id, second.id].includes(memberId)).map(({ dividendAmount }) => dividendAmount).sort())
    .toEqual(["0.50", "0.51"]);
  await json(request(approvalPath, { user: "manager", input: { runId: calc.currentRunId } }), 403);
  await postShares(first.id, "PURCHASE_ADD", "2025-11-01", 1);
  await json(request(approvalPath, { input: { runId: calc.currentRunId } }), 409);
  const refreshed = await json<AccountingPeriod>(request(previewPath, { method: "POST" }), 200);
  const locked = await json<AccountingPeriod>(request(approvalPath, { input: { runId: refreshed.currentRunId } }), 200);
  expect(locked.status).toBe("APPROVED_LOCKED");
  expect(await json(request(approvalPath, { input: { runId: refreshed.currentRunId } }), 200)).toEqual(locked);
  const approved = await json<DividendPreview>(request(previewPath), 200);
  const results = await db.dividendResult.aggregate({ where: { runId: approved.id }, _sum: { amount: true } });
  const rebates = await db.purchaseRebateResult.aggregate({ where: { runId: approved.id }, _sum: { amount: true } });
  const obligations = await db.payoutObligation.aggregate({ where: { periodId: p.id }, _sum: { totalObligation: true } });
  expect(results._sum.amount?.toFixed(2)).toBe(approved.dividendTotal);
  expect(rebates._sum.amount?.toFixed(2)).toBe(approved.rebateTotal);
  expect(obligations._sum.totalObligation?.toFixed(2)).toBe(approved.total);
  await expect(db.dividendResult.updateMany({ where: { runId: approved.id }, data: { amount: "0" } })).rejects.toThrow(/append only/);
  await expect(db.accountingPeriod.update({ where: { id: p.id }, data: { name: "แก้ย้อนหลัง" } })).rejects.toThrow(/immutable/);
  await postShares(first.id, "PURCHASE_ADD", "2025-12-31", 1, undefined, 409);
  await postShares(first.id, "PURCHASE_ADD", "2026-01-01", 1);
  const open = await json<Page<PayoutObligation>>(request(period(p.id) + "/obligations", { user: "manager" }), 200);
  const target = open.items.find(({ memberId }) => memberId === first.id)!;
  expect(target.remaining).toBe("3.26");
  const paid = (id: string, amount: string, replayKey = key(), user = "manager", method = "CASH") => request(payoutPath(id), {
    user, key: replayKey, input: { method, amount, ...(method === "BANK_TRANSFER" && { reference: "BANK-01" }) },
  });
  const replayKey = key();
  await json(paid(target.id, "1.00", replayKey, "cashier"), 403);
  const receipt = await json<PayoutReceipt>(paid(target.id, "1.00", replayKey), 201);
  expect(await json(paid(target.id, "1.0", replayKey), 200)).toEqual(receipt);
  const partialList = await json<Page<PayoutObligation>>(
    request(period(p.id) + "/obligations?status=PARTIAL&sortBy=paidAmount&sortDir=desc", { user: "manager" }),
    200,
  );
  expect(partialList.items.map((item) => item.id)).toEqual([target.id]);
  const unpaidList = await json<Page<PayoutObligation>>(
    request(period(p.id) + "/obligations?status=UNPAID", { user: "manager" }),
    200,
  );
  expect(unpaidList.items.some((item) => item.id === target.id)).toBe(false);
  await json(paid(target.id, "2.00", replayKey), 409);
  await json(request(period(p.id) + "/close", { method: "POST" }), 409);
  const outcomes = await Promise.all([paid(target.id, "2.26", key(), "manager", "BANK_TRANSFER"), paid(target.id, "2.26")]);
  expect(outcomes.map(({ status }) => status).sort()).toEqual([201, 409]);
  const others = open.items.filter(({ id }) => id !== target.id);
  for (const item of others) await json(paid(item.id, item.remaining, key(), "manager", "BANK_TRANSFER"), 201);
  const history = await json<Page<PayoutReceipt>>(request(payoutPath(target.id)), 200);
  expect(history.items).toHaveLength(2);
  expect(await json(request(period(p.id) + "/close", { method: "POST" }), 200)).toMatchObject({ status: "CLOSED" });
  expect(await json(paid(target.id, "1", replayKey), 200)).toEqual(receipt);
  expect(await json(request(previewPath), 200)).toEqual(approved);
});

it("books an approved correction once in the open current period and invalidates the old preview", async () => {
  const rule = await json<DividendRule>(request(rulePath, { input: { ...ruleInput, name: "ปรับยอด", dividendRate: "0", rebateRate: "10" } }), 201);
  const p = await json<AccountingPeriod>(request(periodPath, { input: { name: "งวดปัจจุบัน", startDate: "2026-01-01", endDate: "2026-12-31", ruleId: rule.id } }), 201);
  const m = await member("ADJUSTMENT");
  const previewPath = period(p.id) + "/preview";
  const adjustmentPath = period(p.id) + "/adjustments";
  const calc = await json<AccountingPeriod>(request(previewPath, { method: "POST" }), 200);
  expect(await json(request(period(p.id) + "/approve", { input: { runId: calc.currentRunId } }), 400)).toEqual({ code: "INVALID_PERIOD_DATES" });
  const input = { memberId: m.id, amount: "25.55", direction: "INCREASE", reason: "ปรับยอดตามเอกสารอ้างอิง A-01" };
  const requestKey = key();
  await json(request(adjustmentPath, { key: requestKey, user: "manager", input }), 403);
  const result = await json(request(adjustmentPath, { key: requestKey, input }), 201);
  expect(await json(request(adjustmentPath, { key: requestKey, input }), 201)).toEqual(result);
  await json(request(previewPath), 404);
  await json(request(previewPath, { method: "POST" }), 200);
  const preview = await json<DividendPreview>(request(previewPath), 200);
  expect(preview.items.find(({ memberId }) => memberId === m.id)).toMatchObject({ eligiblePurchases: "25.55", rebateAmount: "2.56" });
  expect(await db.purchaseAdjustment.count({ where: { periodId: p.id } })).toBe(1);
});
