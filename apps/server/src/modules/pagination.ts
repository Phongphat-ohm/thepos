export type PageQuery = {
  limit: number;
  after?: string;
  page?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

export function pageMeta(total: number, page: number, pageSize: number) {
  return {
    nextCursor: null,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function resolveOrder<T extends Record<string, unknown>>(
  sortMap: Record<string, (dir: "asc" | "desc") => T[]>,
  fallback: T[],
  sortBy?: string,
  sortDir?: "asc" | "desc",
): T[] {
  if (!sortBy || !Object.hasOwn(sortMap, sortBy)) return fallback;
  return sortMap[sortBy]!(sortDir ?? "asc");
}
