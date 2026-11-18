import { describe, expect, it } from "vitest";
import { basePrice, baseQuantity, emptyCart, lineGross, pendingNeedsApproval, totals, type CartLine, type RegisterProduct } from "./model";

const testProduct: RegisterProduct = {
  id: "prod-1",
  sku: "SKU-001",
  name: "ข้าวหอมมะลิ 5 กก.",
  baseUnit: "ถุง",
  regularPrice: "210.00",
  memberPrice: "195.00",
  units: [
    { name: "ถุง", multiplier: "1" },
    { name: "กระสอบ", multiplier: "5" },
    { name: "แบ่งขาย", multiplier: "0.5" },
  ],
};

function createLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: "line-1",
    product: testProduct,
    unit: "ถุง",
    quantity: "1",
    discount: "0.00",
    ...overrides,
  };
}

describe("POS model & calculation invariants", () => {
  it("determines regular vs member price correctly", () => {
    const line = createLine();
    expect(basePrice(line, false)).toBe("210.00");
    expect(basePrice(line, true)).toBe("195.00");
  });

  it("calculates base quantity for base and alternate units", () => {
    const baseLine = createLine({ unit: "ถุง", quantity: "2" });
    expect(baseQuantity(baseLine).toFixed(3)).toBe("2.000");

    const sackLine = createLine({ unit: "กระสอบ", quantity: "3" });
    expect(baseQuantity(sackLine).toFixed(3)).toBe("15.000");

    const halfLine = createLine({ unit: "แบ่งขาย", quantity: "3" });
    expect(baseQuantity(halfLine).toFixed(3)).toBe("1.500");

    const invalidUnit = createLine({ unit: "ถัง", quantity: "1" });
    expect(() => baseQuantity(invalidUnit)).toThrow("ไม่พบหน่วยขาย");
  });

  it("calculates line gross using Decimal Half-Up rounding", () => {
    const line = createLine({ unit: "แบ่งขาย", quantity: "1" }); // 0.5 * 210.00 = 105.00
    expect(lineGross(line, false).toFixed(2)).toBe("105.00");

    // Member price: 0.5 * 195.00 = 97.50
    expect(lineGross(line, true).toFixed(2)).toBe("97.50");
  });

  it("calculates cart totals, net total, and enforces manager approval threshold", () => {
    const cart = emptyCart();
    const line1 = createLine({ id: "l1", quantity: "2", discount: "0.00" }); // 2 * 210 = 420.00
    cart.lines.push(line1);

    // No discounts
    const res1 = totals(cart);
    expect(res1.subtotal.toFixed(2)).toBe("420.00");
    expect(res1.net.toFixed(2)).toBe("420.00");
    expect(res1.discount.toFixed(2)).toBe("0.00");
    expect(res1.needsApproval).toBe(false);
    expect(res1.invalid).toBe(false);

    // Apply 5% discount (21.00 THB on 420.00 THB) -> at 5% threshold (no approval required)
    cart.discount = "21.00";
    const res2 = totals(cart);
    expect(res2.subtotal.toFixed(2)).toBe("420.00");
    expect(res2.net.toFixed(2)).toBe("399.00");
    expect(res2.discount.toFixed(2)).toBe("21.00");
    expect(res2.needsApproval).toBe(false);

    // Apply just over 5% discount (21.01 THB on 420.00 THB) -> requires manager approval
    cart.discount = "21.01";
    expect(totals(cart).needsApproval).toBe(true);

    // Apply 15% discount (63.00 THB on 420.00 THB) -> over 5% threshold -> requires manager approval
    cart.discount = "63.00";
    const res3 = totals(cart);
    expect(res3.needsApproval).toBe(true);

    // Excessive discount making net < 0 -> invalid
    cart.discount = "500.00";
    const res4 = totals(cart);
    expect(res4.invalid).toBe(true);
  });

  it("handles malformed draft values without throwing and detects pending approval thresholds", () => {
    const cart = emptyCart();
    cart.lines.push(createLine({ id: "l1", quantity: "", discount: "abc" }));
    cart.discount = "bad-value";
    const safe = totals(cart);
    expect(safe.invalid).toBe(true);

    expect(pendingNeedsApproval({
      lines: [{ productId: "p1", unit: "ถุง", quantity: "1", discount: "5.00", expectedBasePrice: "100.00" }],
      billDiscount: "0.00",
    })).toBe(false);
    expect(pendingNeedsApproval({
      lines: [{ productId: "p1", unit: "ถุง", quantity: "1", discount: "5.01", expectedBasePrice: "100.00" }],
      billDiscount: "0.00",
    })).toBe(true);
    expect(pendingNeedsApproval({
      lines: [{ productId: "p1", unit: "ถุง", quantity: "1", discount: "0.00", expectedBasePrice: "100.00" }],
      billDiscount: "6.00",
    })).toBe(true);
  });
});
