import { describe, expect, it } from "vitest";
import {
  auditEventLabels, bindDeviceSchema, bootstrapSchema, loginSchema, receiptInput, returnInput, returnQuoteInput,
  setupStatusSchema, stockCountInput, tokenSchema, unlockSchema, verifyAdminSchema,
} from "./index";

describe("authentication contracts", () => {
  it("normalizes the username and preserves a valid password unchanged", () => {
    expect(loginSchema.parse({ username: "  ADMIN  ", password: " some password " }))
      .toEqual({ username: "admin", password: " some password " });
  });

  it("rejects unrelated properties, invalid secrets and malformed device tokens", () => {
    expect(loginSchema.safeParse({ username: "admin", password: "password", role: "ADMIN" }).success).toBe(false);
    expect(bootstrapSchema.safeParse({
      username: "admin", password: "password123456", pin: "012345", secret: "short",
      storeName: "สหกรณ์", displayName: "แอดมิน", deviceName: "จุดขาย",
    }).success).toBe(false);
    expect(tokenSchema.safeParse("abc").success).toBe(false);
  });

  it("validates a six-digit PIN as text, including leading zeroes", () => {
    expect(unlockSchema.parse({ pin: "012345" }).pin).toBe("012345");
    expect(unlockSchema.safeParse({ pin: 123456 }).success).toBe(false);
  });

  it("requires both setup status flags", () => {
    expect(setupStatusSchema.safeParse({ initialized: true }).success).toBe(false);
  });

  it("normalizes UUIDs to lowercase and rejects mixed-case duplicates in stock counts", () => {
    const upper = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
    const lower = upper.toLowerCase();
    const parsed = receiptInput.parse({
      supplierId: upper,
      lines: [{ productId: upper, unit: "ชิ้น", quantity: "1", lotNumber: "L1", unitCostPerBaseUnit: "1.00" }],
    });
    expect(parsed.supplierId).toBe(lower);
    expect(parsed.lines[0]?.productId).toBe(lower);

    expect(stockCountInput.safeParse({
      reason: "ตรวจนับ",
      lines: [
        { lotId: upper, expected: "1", counted: "1" },
        { lotId: lower, expected: "1", counted: "1" },
      ],
    }).success).toBe(false);
  });

  it("requires expectedQuote on return submission while allowing quote preview without it", () => {
    const lineId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const quotePayload = { reason: "คืนสินค้า", lines: [{ saleItemId: lineId, quantity: "1", disposition: "SELLABLE" }] };
    expect(returnQuoteInput.safeParse(quotePayload).success).toBe(true);
    expect(returnInput.safeParse(quotePayload).success).toBe(false);
    expect(returnInput.safeParse({ ...quotePayload, expectedQuote: "" }).success).toBe(false);
    expect(returnInput.safeParse({ ...quotePayload, expectedQuote: "a".repeat(64) }).success).toBe(true);
    expect(auditEventLabels.SHIFT_FORCE_CLOSED).toBeTruthy();
    expect(auditEventLabels.ADMIN_VERIFIED).toBeTruthy();
  });

  it("requires admin credentials when binding an existing POS device or verifying admin", () => {
    const deviceId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    expect(bindDeviceSchema.safeParse({ deviceId, pin: "123456" }).success).toBe(false);
    expect(bindDeviceSchema.safeParse({
      username: "admin", password: "secret-password", deviceId, pin: "123456",
    }).success).toBe(true);
    expect(verifyAdminSchema.safeParse({ username: "admin", password: "secret-password" }).success).toBe(true);
  });
});
