import type { Profile } from "@thepos/contracts";
import { describe, expect, it } from "vitest";
import { canOpenRoute, NAV_ITEMS, routeDescriptions } from "@/components/layout/navigation";

function profileWith(capabilities: NonNullable<Profile["capabilities"]>): Profile {
  return {
    user: { id: "u1", username: "tester", name: "ผู้ทดสอบ", roles: ["STOCK_STAFF"] },
    store: { id: "s1", name: "ร้านสหกรณ์ทดสอบ" },
    device: { id: "d1", name: "Web Portal", isWebDevice: true },
    capabilities,
  };
}

describe("web-portal stock count navigation and permissions", () => {
  it("exposes stock count entry and count sheet routes under stock group with descriptions", () => {
    const countEntry = NAV_ITEMS.find((item) => item.route === "stock-counts:count-entry");
    const countSheets = NAV_ITEMS.find((item) => item.route === "stock-counts:counts");

    expect(countEntry).toBeDefined();
    expect(countEntry?.group).toBe("stock");
    expect(countEntry?.permission).toBe("inventory:count");

    expect(countSheets).toBeDefined();
    expect(countSheets?.group).toBe("stock");
    expect(countSheets?.permission).toBe("inventory:read");

    expect(routeDescriptions["stock-counts:count-entry"]).toBeTruthy();
    expect(routeDescriptions["stock-counts:counts"]).toBeTruthy();
  });

  it("enforces inventory:count and inventory:read per role capabilities", () => {
    const stockStaff = profileWith(["session:use", "inventory:read", "inventory:receive", "inventory:count"]);
    const manager = profileWith(["session:use", "inventory:read", "inventory:approve"]);
    const cashier = profileWith(["session:use", "sales:read", "sales:return"]);

    expect(canOpenRoute("stock-counts:count-entry", stockStaff)).toBe(true);
    expect(canOpenRoute("stock-counts:counts", stockStaff)).toBe(true);

    expect(canOpenRoute("stock-counts:count-entry", manager)).toBe(false);
    expect(canOpenRoute("stock-counts:counts", manager)).toBe(true);

    expect(canOpenRoute("stock-counts:count-entry", cashier)).toBe(false);
    expect(canOpenRoute("stock-counts:counts", cashier)).toBe(false);
  });
});
