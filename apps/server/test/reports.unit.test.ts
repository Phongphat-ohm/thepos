import { Prisma, type PrismaClient } from "@prisma/client";
import type { ReportQuery } from "@thepos/contracts";
import { describe, expect, it } from "vitest";
import { createReports, reportOrder } from "../src/modules/reports/service";

function captureReports(rowsToReturn: { cells: string[]; total_count?: bigint }[] = [{ cells: ["A"], total_count: 1n }]) {
  const queries: Prisma.Sql[] = [];
  const db = {
    store: {
      findUniqueOrThrow: async () => ({ name: "ร้านทดสอบ" }),
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push(Prisma.sql(strings, ...values));
      return rowsToReturn;
    },
  } as unknown as PrismaClient;

  return {
    reports: createReports(db, Date.now),
    queries,
  };
}

function outerClause(query: Prisma.Sql) {
  const idx = query.text.lastIndexOf(") report_rows");
  expect(idx).toBeGreaterThan(-1);
  return query.text.slice(idx);
}

describe("reports SQL ordering and export parity", () => {
  const storeId = "11111111-1111-4111-8111-111111111111";
  const base: ReportQuery = {
    kind: "product",
    start: "2026-10-31",
    end: "2026-11-01",
    q: "",
  };

  it("applies the exact same numeric ORDER BY and deterministic tie-breaker to both paged and export queries", async () => {
    const { reports, queries } = captureReports();

    await reports.report(storeId, { ...base, page: 1, limit: 25, sortCol: 4, sortDir: "desc" });
    const paged = queries.pop()!;

    await reports.report(storeId, { ...base, sortCol: 4, sortDir: "desc" });
    const exported = queries.pop()!;

    const pagedTail = outerClause(paged);
    const exportTail = outerClause(exported);

    expect(pagedTail).toContain("ORDER BY CASE WHEN cells[");
    expect(pagedTail).toContain("DESC NULLS LAST, cells ASC, row_ord ASC");
    expect(exportTail).toContain("ORDER BY CASE WHEN cells[");
    expect(exportTail).toContain("DESC NULLS LAST, cells ASC, row_ord ASC");

    // ORDER BY must execute before LIMIT 10001 on export so >10,000 rows take the first sorted window
    expect(exportTail.indexOf("ORDER BY")).toBeLessThan(exportTail.indexOf("LIMIT"));
  });

  it("supports ascending numeric, ascending/descending text, and default ordering with parity", async () => {
    const cases: Array<Pick<ReportQuery, "sortCol" | "sortDir"> & { expected: string }> = [
      { sortCol: 4, sortDir: "asc", expected: "::numeric END ASC NULLS LAST, cells ASC, row_ord ASC" },
      { sortCol: 1, sortDir: "desc", expected: "DESC NULLS LAST, cells ASC, row_ord ASC" },
      { sortCol: 1, sortDir: "asc", expected: "ASC NULLS LAST, cells ASC, row_ord ASC" },
      { sortCol: undefined, sortDir: undefined, expected: "ORDER BY row_ord ASC" },
    ];

    for (const testCase of cases) {
      const { reports, queries } = captureReports();
      await reports.report(storeId, { ...base, page: 2, limit: 10, sortCol: testCase.sortCol, sortDir: testCase.sortDir });
      const paged = outerClause(queries.pop()!);
      await reports.report(storeId, { ...base, sortCol: testCase.sortCol, sortDir: testCase.sortDir });
      const exported = outerClause(queries.pop()!);

      expect(paged).toContain(testCase.expected);
      expect(exported).toContain(testCase.expected);
    }
  });

  it("falls back safely to default row_ord ordering when sortCol is out of range", () => {
    const cols = [{ label: "SKU" }, { label: "ยอด", number: "money" as const }];
    expect(reportOrder(cols, { sortCol: 99, sortDir: "desc" }).text).toBe("ORDER BY row_ord ASC");
    expect(reportOrder(cols, { sortCol: -1, sortDir: "asc" }).text).toBe("ORDER BY row_ord ASC");
  });

  it("marks export as limited and caps at 10,000 rows when 10,001 rows are returned", async () => {
    const rows = Array.from({ length: 10001 }, (_, i) => ({ cells: [`SKU-${i}`] }));
    const { reports } = captureReports(rows);

    const result = await reports.report(storeId, { ...base, sortCol: 4, sortDir: "desc" });
    expect(result.limited).toBe(true);
    expect(result.rows).toHaveLength(10000);
    expect(result.rows[0]).toEqual(["SKU-0"]);
    expect(result.rows[9999]).toEqual(["SKU-9999"]);
  });

  it("uses Asia/Bangkok calendar range across month boundaries and filters returns by return date", async () => {
    const { reports, queries } = captureReports();
    await reports.report(storeId, { ...base, page: 1, limit: 25 });
    const paged = queries.pop()!;

    const dates = paged.values.filter((v): v is Date => v instanceof Date).map((d) => d.toISOString());
    expect(dates.slice(0, 2)).toEqual(["2026-10-30T17:00:00.000Z", "2026-11-01T17:00:00.000Z"]);
    expect(paged.text).toContain("r.created_at >=");
    expect(paged.text).toContain("s.completed_at >=");
  });
});
