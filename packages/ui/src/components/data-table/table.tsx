import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { Loading } from "@/components/common/loading";
import { Button } from "@/components/ui/button";

export type Reference = { id: string; name: string };
export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
};
export type Run = (action: () => Promise<void>) => Promise<void>;
export type SortDir = "asc" | "desc";
export type TableColumn = { label: string; sortKey?: string; numeric?: boolean };

export function Table({
  headings,
  children,
  empty,
  loading,
  sortBy,
  sortDir,
  onSort,
}: {
  headings: (string | TableColumn)[];
  children: ReactNode;
  empty?: string;
  loading?: boolean;
  sortBy?: string;
  sortDir?: SortDir;
  onSort?: (key: string) => void;
}) {
  const columns: TableColumn[] = headings.map((h) => (typeof h === "string" ? { label: h } : h));
  const ariaLabel = columns.map((c) => c.label).join(", ");
  return (
    <div className="stock-table-scroll" tabIndex={0} role="region" aria-label={ariaLabel}>
      <table className="stock-table">
        <thead>
          <tr>
            {columns.map((col, idx) => {
              const isSorted = Boolean(col.sortKey && sortBy === col.sortKey);
              const ariaSort = col.sortKey
                ? isSorted
                  ? sortDir === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
                : undefined;
              return (
                <th key={`${col.label}-${idx}`} scope="col" aria-sort={ariaSort} className={col.numeric ? "col-num" : undefined}>
                  {col.sortKey && onSort ? (
                    <button
                      type="button"
                      className={`table-sort-btn${isSorted ? " is-sorted" : ""}${col.numeric ? " is-numeric" : ""}`}
                      onClick={() => onSort(col.sortKey!)}
                    >
                      <span>{col.label}</span>
                      {isSorted ? (
                        sortDir === "asc" ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />
                      ) : (
                        <ArrowUpDown size={14} className="table-sort-idle" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={columns.length}><Loading variant="skeleton" /></td></tr>
          ) : empty ? (
            <tr><td colSpan={columns.length}><div className="table-empty"><Inbox size={24} aria-hidden="true" />{empty}</div></td></tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  disabled,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  disabled?: boolean;
}) {
  const safeTotalPages = Math.max(1, totalPages || 1);
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = total === 0 ? 0 : Math.min(total, page * pageSize);

  const pages: (number | "...")[] = [];
  if (safeTotalPages <= 7) {
    for (let i = 1; i <= safeTotalPages; i += 1) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("...");
    for (let i = Math.max(2, page - 1); i <= Math.min(safeTotalPages - 1, page + 1); i += 1) {
      pages.push(i);
    }
    if (page < safeTotalPages - 2) pages.push("...");
    pages.push(safeTotalPages);
  }

  return (
    <div className="table-pagination" role="navigation" aria-label="การแบ่งหน้า">
      <div className="table-pagination-info">
        <span>แสดง {start.toLocaleString("th-TH")}-{end.toLocaleString("th-TH")} จาก {total.toLocaleString("th-TH")} รายการ</span>
        {onPageSizeChange && (
          <label className="table-pagination-size">
            <span>ต่อหน้า</span>
            <select
              className="input"
              value={String(pageSize)}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              disabled={disabled}
              aria-label="จำนวนรายการต่อหน้า"
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
        )}
      </div>
      <div className="table-pagination-controls">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="หน้าก่อนหน้า"
        >
          <ChevronLeft size={16} aria-hidden="true" />
          <span>ก่อนหน้า</span>
        </Button>
        <div className="table-pagination-pages">
          {pages.map((p, i) =>
            p === "..." ? (
              <span key={`ellipsis-${i}`} className="table-pagination-ellipsis" aria-hidden="true">…</span>
            ) : (
              <button
                key={p}
                type="button"
                className={`table-page-btn${p === page ? " is-active" : ""}`}
                onClick={() => onPageChange(p)}
                disabled={disabled || p === page}
                aria-current={p === page ? "page" : undefined}
              >
                {p}
              </button>
            ),
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || page >= safeTotalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="หน้าถัดไป"
        >
          <span>ถัดไป</span>
          <ChevronRight size={16} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export function toggleSort(
  currentBy: string,
  currentDir: SortDir,
  clickedKey: string,
  defaultDir: SortDir = "desc",
): { sortBy: string; sortDir: SortDir } {
  if (currentBy === clickedKey) {
    return { sortBy: clickedKey, sortDir: currentDir === "asc" ? "desc" : "asc" };
  }
  return { sortBy: clickedKey, sortDir: defaultDir };
}

export function LoadMore({ cursor, load }: { cursor: string | null; load: (cursor: string) => void }) {
  return cursor && <Button type="button" variant="outline" onClick={() => load(cursor)}>โหลดเพิ่ม</Button>;
}
