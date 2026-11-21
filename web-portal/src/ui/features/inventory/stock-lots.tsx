import { useCallback, useRef, useState, type FormEvent } from "react";
import { stockCountInput } from "@thepos/contracts";
import { Field } from "@/components/common/fields";
import { Loading } from "@/components/common/loading";
import { Pagination, Table, toggleSort, type Page, type Run, type SortDir } from "@/components/data-table/table";
import { Button } from "@/components/ui/button";
import type { Product } from "@/features/catalog/types";
import { confirmAction, notifyError } from "@/lib/alerts";
import { retryKey, thaiDate } from "@/lib/format";
import { business, errorMessage } from "@/lib/native";
import { StockProductFilter } from "./product-filter";
import type { Lot } from "./types";

export function StockLots({
  count,
  busy,
  run,
  report,
  warn,
}: {
  count: boolean;
  busy: boolean;
  run: Run;
  report: (message: string) => void;
  warn: (message: string) => void;
}) {
  const [product, setProduct] = useState<Product | null>(null);
  const [lots, setLots] = useState<Page<Lot>>();
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState("receivedAt");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [counted, setCounted] = useState<Record<string, { expected: string; counted: string }>>({});
  const [reason, setReason] = useState("");
  const retry = useRef<{ payload: string; key: string }>(undefined);
  const confirming = useRef(false);
  const seqRef = useRef(0);
  const debounceRef = useRef<number | undefined>(undefined);

  const fetchLots = useCallback(
    async (selected: Product, nextQ: string, nextPage: number, nextSize: number, nextSortBy: string, nextSortDir: SortDir) => {
      const seq = ++seqRef.current;
      setLoading(true);
      try {
        const result = await business<Page<Lot>>("lots", {
          query: {
            productId: selected.id,
            q: nextQ.trim() || undefined,
            page: nextPage,
            limit: nextSize,
            sortBy: nextSortBy,
            sortDir: nextSortDir,
          },
        });
        if (seq === seqRef.current) setLots(result);
      } catch (reason) {
        if (seq === seqRef.current) void notifyError("โหลดข้อมูลล็อตไม่สำเร็จ", errorMessage(reason));
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [],
  );

  const enteredLines = Object.entries(counted)
    .filter(([, entry]) => entry.counted.trim())
    .map(([lotId, entry]) => ({ lotId, expected: entry.expected, counted: entry.counted.trim() }));

  async function choose(selected: Product | null) {
    if (count && selected?.id !== product?.id && enteredLines.length > 0) {
      const ok = await confirmAction({
        title: "เปลี่ยนสินค้าและล้างจำนวนที่นับไว้",
        text: `มีจำนวนที่กรอกไว้ ${enteredLines.length} ล็อต หากเปลี่ยนสินค้าค่าที่ยังไม่ส่งจะถูกล้าง`,
        confirmText: "เปลี่ยนสินค้า",
        danger: true,
      });
      if (!ok) return;
    }
    window.clearTimeout(debounceRef.current);
    setProduct(selected);
    setLots(undefined);
    setCounted({});
    setPageNum(1);
    if (selected) void fetchLots(selected, q, 1, pageSize, sortBy, sortDir);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!count || busy || confirming.current || !lots) return;
    const parsed = stockCountInput.safeParse({ reason, lines: enteredLines });
    if (!parsed.success) {
      warn("ระบุเหตุผลและจำนวนที่นับได้ 1–50 ล็อต โดยใช้ทศนิยมไม่เกิน 3 ตำแหน่ง");
      return;
    }
    confirming.current = true;
    try {
      if (
        !(await confirmAction({
          title: "ส่งใบตรวจนับให้ผู้จัดการ",
          text: `${parsed.data.lines.length} ล็อต · ${parsed.data.reason}`,
          confirmText: "ส่งใบตรวจนับ",
        }))
      )
        return;
      await run(async () => {
        await business("submit_count", { input: parsed.data, key: retryKey(retry, parsed.data) });
        setCounted({});
        setReason("");
        retry.current = undefined;
        report("ส่งใบตรวจนับให้ผู้จัดการแล้ว");
      });
    } finally {
      confirming.current = false;
    }
  }

  return (
    <div className="form-stack">
      <h2>{count ? "บันทึกผลตรวจนับสินค้า" : "ยอดคงเหลือแยกตามล็อต"}</h2>
      <StockProductFilter
        product={product}
        busy={busy || loading}
        choose={(selected) => void choose(selected)}
        refresh={() => void choose(product)}
      />
      {!product && <p className="stock-help">เลือกสินค้าเพื่อ{count ? "ระบุจำนวนที่นับได้ตามล็อต" : "ดูยอดคงเหลือและข้อมูลล็อต"}</p>}
      {product && (lots || loading) && (
        <form className="form-stack" noValidate onSubmit={(event) => void submit(event)}>
          <div className="stock-inline">
            <p className="stock-help">หน่วยหลัก · {product.baseUnit}</p>
            <Field
              label="ค้นหาล็อต / ผู้จัดจำหน่าย"
              value={q}
              onChange={(e) => {
                const nextQ = e.target.value;
                setQ(nextQ);
                setPageNum(1);
                window.clearTimeout(debounceRef.current);
                debounceRef.current = window.setTimeout(() => {
                  void fetchLots(product, nextQ, 1, pageSize, sortBy, sortDir);
                }, 220);
              }}
              placeholder="เลขล็อต หรือชื่อผู้จัดจำหน่าย"
            />
          </div>
          {loading && !!lots?.items.length && <Loading label="กำลังค้นหาล็อต" variant="inline" />}
          <Table
            headings={[
              { label: "ล็อต", sortKey: "lotNumber" },
              "ผู้จัดจำหน่าย",
              { label: "วันที่รับเข้า", sortKey: "receivedAt" },
              { label: "จำนวนรับเข้า", numeric: true },
              { label: "คงเหลือ", sortKey: "remainingQuantity", numeric: true },
              { label: "ต้นทุนต่อหน่วย", numeric: true },
              { label: "หมดอายุ", sortKey: "expirationDate" },
              ...(count ? ["จำนวนที่ตรวจนับ"] : []),
            ]}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={(key) => {
              const next = toggleSort(sortBy, sortDir, key, "asc");
              setSortBy(next.sortBy);
              setSortDir(next.sortDir);
              setPageNum(1);
              void fetchLots(product, q, 1, pageSize, next.sortBy, next.sortDir);
            }}
            loading={loading && !lots}
            empty={lots?.items.length ? undefined : "ยังไม่มีล็อตสินค้า"}
          >
            {lots?.items.map((lot) => (
              <tr key={lot.id}>
                <td>{lot.lotNumber}</td>
                <td>{lot.supplierName ?? "—"}</td>
                <td>{thaiDate(lot.receivedAt)}</td>
                <td className="report-number">{lot.initialQuantity}</td>
                <td className="report-number">{lot.remainingQuantity}</td>
                <td className="report-number">{lot.unitCost}</td>
                <td>{lot.expirationDate ? thaiDate(lot.expirationDate) : "—"}</td>
                {count && (
                  <td>
                    <input
                      className="input count-input"
                      aria-label={`จำนวนที่นับได้ ล็อต ${lot.lotNumber}`}
                      inputMode="decimal"
                      maxLength={13}
                      disabled={busy}
                      value={counted[lot.id]?.counted ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        setCounted((current) => {
                          if (!value) {
                            const { [lot.id]: _removed, ...rest } = current;
                            return rest;
                          }
                          return { ...current, [lot.id]: { expected: lot.remainingQuantity, counted: value } };
                        });
                      }}
                    />
                  </td>
                )}
              </tr>
            ))}
          </Table>
          {lots && (
            <Pagination
              page={lots.page ?? pageNum}
              pageSize={lots.pageSize ?? pageSize}
              total={lots.total ?? lots.items.length}
              totalPages={lots.totalPages ?? 1}
              onPageChange={(nextPage) => {
                setPageNum(nextPage);
                void fetchLots(product, q, nextPage, pageSize, sortBy, sortDir);
              }}
              onPageSizeChange={(nextSize) => {
                setPageSize(nextSize);
                setPageNum(1);
                void fetchLots(product, q, 1, nextSize, sortBy, sortDir);
              }}
              disabled={busy || loading}
            />
          )}
          {count && !!lots?.items.length && (
            <div className="stock-inline">
              <Field
                label="เหตุผลที่ตรวจนับ"
                required
                value={reason}
                maxLength={400}
                disabled={busy}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button type="submit" loading={busy} disabled={!enteredLines.length}>
                ส่งใบตรวจนับ ({enteredLines.length})
              </Button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
