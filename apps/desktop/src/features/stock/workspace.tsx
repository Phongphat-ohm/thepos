import { useCallback, useEffect, useRef, useState } from "react";
import type { Profile } from "@thepos/contracts";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/fields";
import { Loading } from "@/components/loading";
import { notifyError, notifySuccess } from "@/lib/alerts";
import { business, errorMessage } from "@/lib/native";
import { Catalog } from "./catalog";
import { ImportProducts } from "./import-products";
import { StockCounts, StockLots, StockMovements } from "./inventory";
import { Receive } from "./receive";
import { Suppliers } from "./suppliers";
import { type Page, type Product, type Run, type SortDir, toggleSort } from "./shared";

export type StockView = "products" | "suppliers" | "receive" | "lots" | "movements" | "count-entry" | "counts" | "import";

export function StockWorkspace({
  profile,
  view,
}: {
  profile: Profile;
  view: StockView;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page<Product>>({ items: [], nextCursor: null });
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const actualQuery = useRef("");
  const pending = useRef(false);
  const loadSeq = useRef(0);
  const [busy, setBusy] = useState(false);

  const run: Run = useCallback(async (action) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await action();
    } catch (reason) {
      void notifyError("ดำเนินการไม่สำเร็จ", errorMessage(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, []);

  const load = useCallback(async (
    q: string,
    nextPage = 1,
    nextLimit = 25,
    nextSortBy = "name",
    nextSortDir: SortDir = "asc",
  ) => {
    const seq = ++loadSeq.current;
    setBusy(true);
    try {
      const result = await business<Page<Product>>("products", {
        query: { q, page: nextPage, limit: nextLimit, sortBy: nextSortBy, sortDir: nextSortDir },
      });
      if (seq !== loadSeq.current) return;
      actualQuery.current = q;
      setPage(result);
    } catch (reason) {
      if (seq === loadSeq.current) void notifyError("โหลดสินค้าไม่สำเร็จ", errorMessage(reason));
    } finally {
      if (seq === loadSeq.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (view === "products") void load(actualQuery.current, pageNum, pageSize, sortBy, sortDir);
  }, [load, view, pageNum, pageSize, sortBy, sortDir]);

  function report(message: string) {
    notifySuccess(message);
  }

  function warn(message: string) {
    void notifyError("ตรวจสอบข้อมูล", message);
  }

  const can = (permission: NonNullable<Profile["capabilities"]>[number]) =>
    profile.capabilities?.includes(permission) ?? false;

  return (
    <section className="stock-workspace" aria-label="จัดการสินค้าและคลัง" aria-busy={busy}>
      {busy && ["products", "receive", "import"].includes(view) && <Loading label="กำลังดำเนินการในระบบคลัง" />}
      <div className="stock-content">
        {view === "products" && (
          <form
            className="stock-inline stock-search"
            onSubmit={(event) => {
              event.preventDefault();
              setPageNum(1);
              void load(query, 1, pageSize, sortBy, sortDir);
            }}
          >
            <Field
              label="ค้นหาสินค้า"
              placeholder="ชื่อสินค้า รหัส SKU หรือบาร์โค้ด"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={255}
            />
            <Button type="submit" variant="outline" loading={busy}>
              ค้นหา
            </Button>
          </form>
        )}

        {view === "products" && (
          <Catalog
            products={page.items}
            page={page.page ?? pageNum}
            pageSize={page.pageSize ?? pageSize}
            total={page.total ?? page.items.length}
            totalPages={page.totalPages ?? 1}
            sortBy={sortBy}
            sortDir={sortDir}
            onPageChange={setPageNum}
            onPageSizeChange={(next) => { setPageSize(next); setPageNum(1); }}
            onSort={(key) => {
              const next = toggleSort(sortBy, sortDir, key, "asc");
              setSortBy(next.sortBy);
              setSortDir(next.sortDir);
              setPageNum(1);
            }}
            run={run}
            report={report}
            warn={warn}
            write={can("catalog:write")}
            busy={busy}
            refresh={() => load(actualQuery.current, pageNum, pageSize, sortBy, sortDir)}
          />
        )}
        {view === "receive" && can("inventory:receive") && (
          <Receive run={run} report={report} warn={warn} busy={busy} />
        )}
        {view === "suppliers" && (
          <Suppliers write={can("catalog:write")} busy={busy} run={run} report={report} />
        )}
        {(view === "lots" || view === "count-entry") && (
          <StockLots count={view === "count-entry"} busy={busy} run={run} report={report} warn={warn} />
        )}
        {view === "movements" && (
          <StockMovements busy={busy} run={run} />
        )}
        {view === "counts" && can("inventory:read") && (
          <StockCounts approve={can("inventory:approve")} busy={busy} run={run} report={report} />
        )}
        {view === "import" && can("catalog:write") && (
          <ImportProducts run={run} report={report} warn={warn} busy={busy} />
        )}
      </div>
    </section>
  );
}
