import type { Dashboard, Report } from "@thepos/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyProductSearch, type ProductRequest } from "@/features/catalog/workspace";
import { nextDashboardAfterError, type DashboardSnapshot } from "@/features/dashboard/store-dashboard";
import { applyMemberSearch, type MemberRequest } from "@/features/members/workspace";
import { canExportReport, nextLoadedAfterError, type LoadedReport } from "@/features/reports/workspace";
import { webExecute } from "@/lib/api/web-transport";

describe("Issue 2 regression: atomic search request reset from page 2 / last page", () => {
  it("updates query and resets to page 1 atomically in catalog search", () => {
    const page2: ProductRequest = { q: "", page: 2, pageSize: 25, sortBy: "name", sortDir: "asc", version: 1 };
    const searched = applyProductSearch(page2, "  NEW  ");
    expect(searched).toEqual({ q: "NEW", page: 1, pageSize: 25, sortBy: "name", sortDir: "asc", version: 2 });

    // Searching empty string from last page resets cleanly to page 1 with empty query
    const lastPage: ProductRequest = { ...searched, page: 5 };
    const cleared = applyProductSearch(lastPage, "   ");
    expect(cleared).toEqual({ q: "", page: 1, pageSize: 25, sortBy: "name", sortDir: "asc", version: 3 });

    // Submitting identical query on page 1 still increments version to trigger reload
    const repeated = applyProductSearch(cleared, "");
    expect(repeated.version).toBe(4);
  });

  it("updates query and resets to page 1 atomically in member search", () => {
    const page2: MemberRequest = { q: "", page: 2, pageSize: 25, sortBy: "number", sortDir: "asc", version: 1 };
    const searched = applyMemberSearch(page2, " NEW ");
    expect(searched).toEqual({ q: "NEW", page: 1, pageSize: 25, sortBy: "number", sortDir: "asc", version: 2 });

    const repeated = applyMemberSearch(searched, "NEW");
    expect(repeated.version).toBe(3);
  });
});

describe("Issue 3 regression: reports and dashboard stale/error handling", () => {
  const sampleReport: Report = {
    store: "ร้านทดสอบ",
    title: "ยอดขายตามวันที่",
    start: "2026-11-01",
    end: "2026-11-21",
    columns: [{ label: "วันที่" }, { label: "ขาย (บาท)", number: "money" }],
    rows: [["2026-11-21", "1234.50"]],
    limited: false,
    total: 26,
    page: 1,
    pageSize: 25,
    totalPages: 2,
  };

  const loaded: LoadedReport = {
    report: sampleReport,
    criteria: { kind: "daily", start: "2026-11-01", end: "2026-11-21", q: "" },
    page: 1,
    pageSize: 25,
    sortCol: undefined,
    sortDir: "desc",
  };

  it("disables report export whenever an error occurred or while busy, and keeps last confirmed sort/page on 503", () => {
    expect(canExportReport({ loaded, error: "", busy: false })).toBe(true);
    expect(canExportReport({ loaded, error: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้", busy: false })).toBe(false);
    expect(canExportReport({ loaded, error: "", busy: true })).toBe(false);
    expect(canExportReport({ loaded: undefined, error: "", busy: false })).toBe(false);

    // Transient 503 preserves previously confirmed snapshot without mutating sortCol/page
    const after503 = nextLoadedAfterError(loaded, "NETWORK_ERROR");
    expect(after503).toBe(loaded);
    expect(after503?.sortCol).toBeUndefined();
    expect(after503?.page).toBe(1);

    // Expired session clears stale report data completely
    expect(nextLoadedAfterError(loaded, "SESSION_REQUIRED")).toBeUndefined();
    expect(nextLoadedAfterError(loaded, "SESSION_LOCKED")).toBeUndefined();
    expect(nextLoadedAfterError(loaded, "FORBIDDEN")).toBeUndefined();
  });

  it("retains timestamped dashboard snapshot on 503 (so UI flags stale) and clears it on expired session", () => {
    const dashboard: Dashboard = {
      date: "2026-11-21",
      sales: { net: "1234.50", receipts: "2", refunds: "0", personal: false, profit: "234.50" },
    };
    const snapshot: DashboardSnapshot = { data: dashboard, updatedAt: new Date("2026-11-21T05:00:00.000Z") };

    expect(nextDashboardAfterError(snapshot, "NETWORK_ERROR")).toBe(snapshot);
    expect(nextDashboardAfterError(snapshot, "SESSION_REQUIRED")).toEqual({ data: undefined, updatedAt: null });
    expect(nextDashboardAfterError(snapshot, "SESSION_LOCKED")).toEqual({ data: undefined, updatedAt: null });
    expect(nextDashboardAfterError(snapshot, "FORBIDDEN")).toEqual({ data: undefined, updatedAt: null });
  });
});

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
}

describe("Web portal server switching and full reset without admin gate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows connecting to a new server without prior admin verification and resets all saved thepos/* storage", async () => {
    const local = memoryStorage();
    const session = memoryStorage();
    local.setItem("thepos/web/server-url", "https://old.example");
    local.setItem("thepos/web/server-token/https://old.example", "old-token");
    local.setItem("thepos/web/device/https://old.example", "old-device");
    local.setItem("unrelated-key", "keep-me");
    session.setItem("thepos/web/refresh/https://old.example", "old-refresh");

    vi.stubGlobal("window", { location: { origin: "https://portal.example", protocol: "https:" } });
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.endsWith("/setup/verify-connection")) {
          return new Response(JSON.stringify({ ok: true, serverToken: "new-token" }), { status: 200 });
        }
        if (input.endsWith("/health")) {
          return new Response(JSON.stringify({ ready: true }), { status: 200 });
        }
        if (input.endsWith("/setup/status")) {
          return new Response(JSON.stringify({ initialized: true, registered: false }), { status: 200 });
        }
        return new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 });
      }),
    );

    // Switching from old.example -> new.example must succeed without calling verify_admin
    const connected = (await webExecute("connect", {
      url: "https://new.example",
      server_key: "POS-AAAA-BBBB-CCCC",
    })) as { url: string | null };
    expect(connected.url).toBe("https://new.example");
    expect(local.getItem("thepos/web/server-url")).toBe("https://new.example");
    expect(session.getItem("thepos/web/refresh/https://old.example")).toBeNull();

    // Full reset wipes all thepos/* keys in both storages while leaving unrelated keys intact
    const reset = await webExecute("reset_connection", {});
    expect(reset).toEqual({ url: null, setup: null, lockedUser: null });
    expect(local.getItem("thepos/web/server-url")).toBeNull();
    expect(local.getItem("thepos/web/server-token/https://new.example")).toBeNull();
    expect(local.getItem("thepos/web/device/https://old.example")).toBeNull();
    expect(local.getItem("unrelated-key")).toBe("keep-me");
  });
});
