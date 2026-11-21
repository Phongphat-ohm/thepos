import { useCallback, useEffect, useRef, useState } from "react";
import type { Profile } from "@thepos/contracts";
import { Field } from "@/components/common/fields";
import { Loading } from "@/components/common/loading";
import { toggleSort, type Page, type Run, type SortDir } from "@/components/data-table/table";
import type { CatalogView } from "@/components/layout/navigation";
import { Button } from "@/components/ui/button";
import { notifyError, notifySuccess } from "@/lib/alerts";
import { business, errorMessage } from "@/lib/native";
import { Catalog } from "./catalog";
import { ImportProducts } from "./import-products";
import { Suppliers } from "./suppliers";
import type { Product } from "./types";

export type ProductRequest = {
  q: string;
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: SortDir;
  version: number;
};

export function applyProductSearch(current: ProductRequest, rawQuery: string): ProductRequest {
  return { ...current, q: rawQuery.trim(), page: 1, version: current.version + 1 };
}

export function CatalogWorkspace({ profile, view }: { profile: Profile; view: CatalogView }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page<Product>>({ items: [], nextCursor: null });
  const [request, setRequest] = useState<ProductRequest>({
    q: "",
    page: 1,
    pageSize: 25,
    sortBy: "name",
    sortDir: "asc",
    version: 0,
  });
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

  const load = useCallback(async (next: ProductRequest) => {
    const seq = ++loadSeq.current;
    setBusy(true);
    try {
      const result = await business<Page<Product>>("products", {
        query: {
          q: next.q,
          page: next.page,
          limit: next.pageSize,
          sortBy: next.sortBy,
          sortDir: next.sortDir,
        },
      });
      if (seq !== loadSeq.current) return;
      setPage(result);
    } catch (reason) {
      if (seq === loadSeq.current) void notifyError("โหลดสินค้าไม่สำเร็จ", errorMessage(reason));
    } finally {
      if (seq === loadSeq.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (view !== "products") return;
    void load(request);
    return () => {
      loadSeq.current++;
    };
  }, [load, view, request]);

  const report = (message: string) => notifySuccess(message);
  const warn = (message: string) => void notifyError("ตรวจสอบข้อมูล", message);
  const can = (permission: NonNullable<Profile["capabilities"]>[number]) =>
    profile.capabilities?.includes(permission) ?? false;

  return (
    <section className="stock-workspace" aria-label="สินค้าและผู้จัดจำหน่าย" aria-busy={busy}>
      {busy && (view === "products" || view === "import") && <Loading label="กำลังดำเนินการ" />}
      <div className="stock-content">
        {view === "products" && (
          <>
            <form
              className="stock-inline stock-search"
              onSubmit={(event) => {
                event.preventDefault();
                setRequest((current) => applyProductSearch(current, query));
              }}
            >
              <Field
                label="ค้นหาสินค้า"
                placeholder="ชื่อสินค้า รหัส SKU หรือบาร์โค้ด"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                maxLength={255}
              />
              <Button type="submit" variant="outline" loading={busy}>ค้นหา</Button>
            </form>
            <Catalog
              products={page.items}
              page={page.page ?? request.page}
              pageSize={page.pageSize ?? request.pageSize}
              total={page.total ?? page.items.length}
              totalPages={page.totalPages ?? 1}
              sortBy={request.sortBy}
              sortDir={request.sortDir}
              onPageChange={(nextPage) => setRequest((current) => ({ ...current, page: nextPage }))}
              onPageSizeChange={(next) => setRequest((current) => ({ ...current, pageSize: next, page: 1 }))}
              onSort={(key) => {
                setRequest((current) => {
                  const next = toggleSort(current.sortBy, current.sortDir, key, "asc");
                  return { ...current, sortBy: next.sortBy, sortDir: next.sortDir, page: 1 };
                });
              }}
              run={run}
              report={report}
              warn={warn}
              write={can("catalog:write")}
              busy={busy}
              refresh={() => load(request)}
            />
          </>
        )}
        {view === "suppliers" && <Suppliers write={can("catalog:write")} busy={busy} run={run} report={report} />}
        {view === "import" && can("catalog:write") && (
          <ImportProducts run={run} report={report} warn={warn} busy={busy} />
        )}
      </div>
    </section>
  );
}
