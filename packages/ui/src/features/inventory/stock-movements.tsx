import { useCallback, useRef, useState } from "react";
import { Field } from "@/components/common/fields";
import { Loading } from "@/components/common/loading";
import { Pagination, Table, toggleSort, type Page, type Run, type SortDir } from "@/components/data-table/table";
import { Select } from "@/components/ui/select";
import type { Product } from "@/features/catalog/types";
import { notifyError } from "@/lib/alerts";
import { business, errorMessage } from "@/lib/native";
import { StockProductFilter } from "./product-filter";

type Movement = { id: string; lotNumber: string; kind: string; quantity: string; createdAt: string };
const movementTime = new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" });
const kindLabel: Record<string, string> = {
  RECEIPT: "รับเข้า",
  SALE: "ขาย",
  ADJUSTMENT: "ปรับจากการตรวจนับ",
  RETURN: "รับคืน",
  RETURN_DAMAGED: "รับคืนชำรุด · แยกจากยอดพร้อมขาย",
};

export function StockMovements({ busy }: { busy: boolean; run: Run }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [page, setPage] = useState<Page<Movement>>();
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const seqRef = useRef(0);
  const debounceRef = useRef<number | undefined>(undefined);

  const load = useCallback(
    async (
      selected: Product,
      nextQ: string,
      nextKind: string,
      nextPage: number,
      nextSize: number,
      nextSortBy: string,
      nextSortDir: SortDir,
    ) => {
      const seq = ++seqRef.current;
      setLoading(true);
      try {
        const next = await business<Page<Movement>>("movements", {
          query: {
            productId: selected.id,
            q: nextQ.trim() || undefined,
            kind: nextKind || undefined,
            page: nextPage,
            limit: nextSize,
            sortBy: nextSortBy,
            sortDir: nextSortDir,
          },
        });
        if (seq === seqRef.current) setPage(next);
      } catch (reason) {
        if (seq === seqRef.current) void notifyError("โหลดประวัติการเคลื่อนไหวไม่สำเร็จ", errorMessage(reason));
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [],
  );

  function choose(selected: Product | null) {
    window.clearTimeout(debounceRef.current);
    setProduct(selected);
    setPage(undefined);
    setPageNum(1);
    if (selected) void load(selected, q, kind, 1, pageSize, sortBy, sortDir);
  }

  return (
    <div className="form-stack">
      <h2>ประวัติการเคลื่อนไหวสต็อก</h2>
      <StockProductFilter
        product={product}
        busy={busy || loading}
        choose={(selected) => void choose(selected)}
        refresh={() => void choose(product)}
      />
      {!product && <p className="stock-help">เลือกสินค้าเพื่อดูรายการรับเข้า ขาย คืน และปรับยอด</p>}
      {product && (page || loading) && (
        <>
          <div className="stock-toolbar">
            <Field
              label="ค้นหาเลขล็อต"
              value={q}
              onChange={(e) => {
                const nextQ = e.target.value;
                setQ(nextQ);
                setPageNum(1);
                window.clearTimeout(debounceRef.current);
                debounceRef.current = window.setTimeout(() => {
                  void load(product, nextQ, kind, 1, pageSize, sortBy, sortDir);
                }, 220);
              }}
              placeholder="เลขล็อต"
            />
            <Select
              label="ประเภทการเคลื่อนไหว"
              value={kind}
              onChange={(e) => {
                const nextKind = e.target.value;
                setKind(nextKind);
                setPageNum(1);
                void load(product, q, nextKind, 1, pageSize, sortBy, sortDir);
              }}
            >
              <option value="">ทั้งหมด</option>
              <option value="RECEIPT">รับเข้า</option>
              <option value="SALE">ขาย</option>
              <option value="ADJUSTMENT">ปรับจากการตรวจนับ</option>
              <option value="RETURN">รับคืน</option>
              <option value="RETURN_DAMAGED">รับคืนชำรุด</option>
            </Select>
          </div>
          <p className="stock-help">หน่วยหลัก · {product.baseUnit}</p>
          {loading && !!page?.items.length && <Loading label="กำลังค้นหาความเคลื่อนไหว" variant="inline" />}
          <Table
            headings={[
              { label: "วันและเวลา", sortKey: "createdAt" },
              { label: "ประเภท", sortKey: "kind" },
              "ล็อต",
              { label: "เปลี่ยนแปลง", sortKey: "quantity", numeric: true },
            ]}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={(key) => {
              const next = toggleSort(sortBy, sortDir, key, "desc");
              setSortBy(next.sortBy);
              setSortDir(next.sortDir);
              setPageNum(1);
              void load(product, q, kind, 1, pageSize, next.sortBy, next.sortDir);
            }}
            loading={loading && !page}
            empty={page?.items.length ? undefined : "ยังไม่มีการเคลื่อนไหว"}
          >
            {page?.items.map((row) => (
              <tr key={row.id}>
                <td>{movementTime.format(new Date(row.createdAt))}</td>
                <td>{kindLabel[row.kind] ?? row.kind}</td>
                <td>{row.lotNumber}</td>
                <td className="report-number">{row.quantity}</td>
              </tr>
            ))}
          </Table>
          {page && (
            <Pagination
              page={page.page ?? pageNum}
              pageSize={page.pageSize ?? pageSize}
              total={page.total ?? page.items.length}
              totalPages={page.totalPages ?? 1}
              onPageChange={(nextPage) => {
                setPageNum(nextPage);
                void load(product, q, kind, nextPage, pageSize, sortBy, sortDir);
              }}
              onPageSizeChange={(nextSize) => {
                setPageSize(nextSize);
                setPageNum(1);
                void load(product, q, kind, 1, nextSize, sortBy, sortDir);
              }}
              disabled={busy || loading}
            />
          )}
        </>
      )}
    </div>
  );
}
