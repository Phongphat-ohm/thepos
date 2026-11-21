import { describe, expect, it } from "vitest";
import { resolveOrder } from "../src/core/pagination";

describe("pagination order resolution", () => {
  const sortMap: Record<string, (dir: "asc" | "desc") => Record<string, "asc" | "desc">[]> = {
    name: (dir) => [{ name: dir }],
    createdAt: (dir) => [{ createdAt: dir }],
  };
  const fallback: Record<string, "asc" | "desc">[] = [{ createdAt: "desc" }];

  it("uses own sort keys and falls back on unknown or Object.prototype keys", () => {
    expect(resolveOrder(sortMap, fallback, "name", "asc")).toEqual([{ name: "asc" }]);
    expect(resolveOrder(sortMap, fallback, "createdAt")).toEqual([{ createdAt: "asc" }]);
    expect(resolveOrder(sortMap, fallback, "unknown", "desc")).toEqual(fallback);
    expect(resolveOrder(sortMap, fallback, "toString", "desc")).toEqual(fallback);
    expect(resolveOrder(sortMap, fallback, "constructor", "asc")).toEqual(fallback);
    expect(resolveOrder(sortMap, fallback, "__proto__", "asc")).toEqual(fallback);
    expect(resolveOrder(sortMap, fallback, "valueOf", "desc")).toEqual(fallback);
  });
});
