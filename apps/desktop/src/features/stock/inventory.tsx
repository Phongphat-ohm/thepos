import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { stockCountInput } from "@thepos/contracts";
import { Field } from "@/components/fields";
import { Loading } from "@/components/loading";
import { Modal } from "@/components/modal";
import { Autocomplete } from "@/components/autocomplete";
import { Button } from "@/components/ui/button";
import { confirmAction, notifyError } from "@/lib/alerts";
import { business, errorMessage } from "@/lib/native";
import { Pagination, productText, retryKey, Select, Table, thaiDate, toggleSort, type Lot, type Page, type Product, type Run, type SortDir } from "./shared";

const searchProducts = (q: string, after?: string) =>
  business<Page<Product>>("products", { query: { q, after, stockTracked: "true" } });

type Movement = { id: string; lotNumber: string; kind: string; quantity: string; createdAt: string };
const movementTime = new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" });
const kindLabel: Record<string, string> = {
  RECEIPT: "รับเข้า",
  SALE: "ขาย",
  ADJUSTMENT: "ปรับจากการตรวจนับ",
  RETURN: "รับคืน",
  RETURN_DAMAGED: "รับคืนชำรุด · แยกจากยอดพร้อมขาย",
};
type Adjustment = {
  lotId: string;
  lotNumber: string;
  sku: string;
  productName: string;
  baseUnit: string;
  expected: string;
  counted: string;
  variance: string;
};
type Count = {
  id: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedBy: string;
  reviewedBy: string | null;
  createdAt: string;
  adjustments: Adjustment[];
};
const statuses = { PENDING: "รออนุมัติ", APPROVED: "อนุมัติแล้ว", REJECTED: "ไม่อนุมัติ" };
function StockProductFilter({ product, busy, choose, refresh }: {
  product: Product | null;
  busy: boolean;
  choose: (product: Product | null) => void;
  refresh: () => void;
}) {
  return <div className="stock-inline stock-search">
    <Autocomplete label="สินค้า" placeholder="ชื่อสินค้า รหัส SKU หรือบาร์โค้ด" value={product}
      onChange={choose} maxLength={255} text={productText} load={searchProducts} disabled={busy} />
    {product && <Button type="button" variant="outline" loading={busy} onClick={refresh}>
      <RefreshCw size={15} /> โหลดข้อมูลล่าสุด
    </Button>}
  </div>;
}

export function StockLots({ count, busy, run, report, warn }: {
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

  const fetchLots = useCallback(async (
    selected: Product,
    nextQ: string,
    nextPage: number,
    nextSize: number,
    nextSortBy: string,
    nextSortDir: SortDir,
  ) => {
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
  }, []);

  function choose(selected: Product | null) {
    window.clearTimeout(debounceRef.current);
    setProduct(selected);
    setLots(undefined);
    setCounted({});
    setPageNum(1);
    if (selected) void fetchLots(selected, q, 1, pageSize, sortBy, sortDir);
  }

  const enteredLines = Object.entries(counted)
    .filter(([, entry]) => entry.counted.trim())
    .map(([lotId, entry]) => ({ lotId, expected: entry.expected, counted: entry.counted.trim() }));

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
      if (!await confirmAction({ title: "ส่งใบตรวจนับให้ผู้จัดการ", text: `${parsed.data.lines.length} ล็อต · ${parsed.data.reason}`, confirmText: "ส่งใบตรวจนับ" })) return;
      await run(async () => {
        await business("submit_count", { input: parsed.data, key: retryKey(retry, parsed.data) });
        setCounted({});
        setReason("");
        retry.current = undefined;
        report("ส่งใบตรวจนับให้ผู้จัดการแล้ว");
      });
    } finally { confirming.current = false; }
  }

  return <div className="form-stack">
    <h2>{count ? "บันทึกผลตรวจนับสินค้า" : "ยอดคงเหลือแยกตามล็อต"}</h2>
    <StockProductFilter product={product} busy={busy || loading} choose={choose} refresh={() => choose(product)} />
    {!product && <p className="stock-help">เลือกสินค้าเพื่อ{count ? "ระบุจำนวนที่นับได้ตามล็อต" : "ดูยอดคงเหลือและข้อมูลล็อต"}</p>}
    {product && (lots || loading) && <form className="form-stack" noValidate onSubmit={(event) => void submit(event)}>
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
        loading={loading && !lots} empty={lots?.items.length ? undefined : "ยังไม่มีล็อตสินค้า"}>
        {lots?.items.map((lot) => <tr key={lot.id}>
          <td>{lot.lotNumber}</td>
          <td>{lot.supplierName ?? "—"}</td>
          <td>{thaiDate(lot.receivedAt)}</td>
          <td className="report-number">{lot.initialQuantity}</td>
          <td className="report-number">{lot.remainingQuantity}</td>
          <td className="report-number">{lot.unitCost}</td>
          <td>{lot.expirationDate ? thaiDate(lot.expirationDate) : "—"}</td>
          {count && <td><input className="input count-input" aria-label={`จำนวนที่นับได้ ล็อต ${lot.lotNumber}`}
            inputMode="decimal" maxLength={13} disabled={busy} value={counted[lot.id]?.counted ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setCounted((current) => {
                if (!value) {
                  const { [lot.id]: _removed, ...rest } = current;
                  return rest;
                }
                return { ...current, [lot.id]: { expected: lot.remainingQuantity, counted: value } };
              });
            }} /></td>}
        </tr>)}
      </Table>
      {lots && <Pagination
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
      />}
      {count && !!lots?.items.length && <div className="stock-inline">
        <Field label="เหตุผลที่ตรวจนับ" required value={reason} maxLength={400} disabled={busy}
          onChange={(event) => setReason(event.target.value)} />
        <Button type="submit" loading={busy} disabled={!enteredLines.length}>ส่งใบตรวจนับ ({enteredLines.length})</Button>
      </div>}
    </form>}
  </div>;
}

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

  const load = useCallback(async (
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
  }, []);

  function choose(selected: Product | null) {
    window.clearTimeout(debounceRef.current);
    setProduct(selected);
    setPage(undefined);
    setPageNum(1);
    if (selected) void load(selected, q, kind, 1, pageSize, sortBy, sortDir);
  }

  return <div className="form-stack">
    <h2>ประวัติการเคลื่อนไหวสต็อก</h2>
    <StockProductFilter product={product} busy={busy || loading} choose={choose} refresh={() => choose(product)} />
    {!product && <p className="stock-help">เลือกสินค้าเพื่อดูรายการรับเข้า ขาย คืน และปรับยอด</p>}
    {product && (page || loading) && <>
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
        loading={loading && !page} empty={page?.items.length ? undefined : "ยังไม่มีการเคลื่อนไหว"}>
        {page?.items.map((row) => <tr key={row.id}>
          <td>{movementTime.format(new Date(row.createdAt))}</td>
          <td>{kindLabel[row.kind] ?? row.kind}</td>
          <td>{row.lotNumber}</td>
          <td className="report-number">{row.quantity}</td>
        </tr>)}
      </Table>
      {page && <Pagination
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
      />}
    </>}
  </div>;
}

export function StockCounts({
  approve,
  busy,
  run,
  report,
}: {
  approve: boolean;
  busy: boolean;
  run: Run;
  report: (message: string) => void;
}) {
  const [page, setPage] = useState<Page<Count>>();
  const [selected, setSelected] = useState<Count>();
  const [loading, setLoading] = useState(false);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const seqRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(qInput);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [qInput]);

  const load = useCallback(async (
    nextQ = q,
    nextStatus = status,
    nextPage = pageNum,
    nextSize = pageSize,
    nextSortBy = sortBy,
    nextSortDir = sortDir,
  ) => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const next = await business<Page<Count>>("stock_counts", {
        query: {
          q: nextQ.trim() || undefined,
          status: nextStatus || undefined,
          page: nextPage,
          limit: nextSize,
          sortBy: nextSortBy,
          sortDir: nextSortDir,
        },
      });
      if (seq === seqRef.current) {
        setPage(next);
        setSelected(undefined);
      }
    } catch (reason) {
      if (seq === seqRef.current) void notifyError("โหลดใบตรวจนับไม่สำเร็จ", errorMessage(reason));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [q, status, pageNum, pageSize, sortBy, sortDir]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(decision: "APPROVED" | "REJECTED") {
    if (!selected) return;
    const ok = await confirmAction({
      title: decision === "APPROVED" ? "อนุมัติใบตรวจนับนี้?" : "ไม่อนุมัติใบตรวจนับนี้?",
      text: selected.reason,
      confirmText: decision === "APPROVED" ? "อนุมัติปรับยอด" : "ยืนยันไม่อนุมัติ",
      danger: decision === "REJECTED",
    });
    if (!ok) return;

    void run(async () => {
      const updated = await business<Count>("review_count", { id: selected.id, input: { decision } });
      setSelected(updated);
      setPage((current) =>
        current && {
          ...current,
          items: current.items.map((item) => (item.id === updated.id ? updated : item)),
        },
      );
      report(decision === "APPROVED" ? "อนุมัติใบตรวจนับและบันทึกผลต่างแล้ว" : "บันทึกผลไม่อนุมัติแล้ว");
    });
  }

  const detail = selected && (
      <Modal title="รายละเอียดใบตรวจนับ" size="lg" close={() => setSelected(undefined)} busy={busy && "กำลังบันทึกผลตรวจนับ"}>
        <div className="form-stack">
        <div className="stock-section-title">
          <h3>{selected.reason}</h3>
          <span className="shell-meta-pill">{statuses[selected.status]}</span>
        </div>
        {selected.reviewedBy && <p className="stock-help">ผู้ตรวจรับ · {selected.reviewedBy}</p>}
        <Table headings={["สินค้า", "ล็อต", { label: "ตามระบบ", numeric: true }, { label: "นับได้", numeric: true }, { label: "ผลต่าง", numeric: true }, "หน่วย"]}>
          {selected.adjustments.map((row) => (
            <tr key={row.lotId}>
              <td>{row.sku} · {row.productName}</td>
              <td>{row.lotNumber}</td>
              <td className="report-number">{row.expected}</td>
              <td className="report-number">{row.counted}</td>
              <td className="report-number">{row.variance}</td>
              <td>{row.baseUnit}</td>
            </tr>
          ))}
        </Table>
        {approve && selected.status === "PENDING" && (
          <div className="stock-inline">
            <Button onClick={() => void review("APPROVED")}>อนุมัติปรับยอด</Button>
            <Button variant="outline" onClick={() => void review("REJECTED")}>ไม่อนุมัติ</Button>
          </div>
        )}
        </div>
      </Modal>
  );

  return (
    <div className="form-stack">
      <div className="stock-section-title">
        <h2>ใบตรวจนับ</h2>
        <Button variant="outline" loading={loading && !selected} onClick={() => void load()}>
          <RefreshCw size={15} /> รีเฟรช
        </Button>
      </div>
      <div className="stock-toolbar">
        <Field label="ค้นหาเหตุผล" value={qInput} onChange={(e) => { setQInput(e.target.value); setPageNum(1); }} placeholder="เหตุผลใบตรวจนับ" />
        <Select label="สถานะ" value={status} onChange={(e) => { setStatus(e.target.value); setPageNum(1); }}>
          <option value="">ทั้งหมด</option>
          <option value="PENDING">รออนุมัติ</option>
          <option value="APPROVED">อนุมัติแล้ว</option>
          <option value="REJECTED">ไม่อนุมัติ</option>
        </Select>
      </div>
      {loading && !!page?.items.length && <Loading label="กำลังค้นหาใบตรวจนับ" variant="inline" />}
      <Table
        loading={loading && !page?.items.length}
        headings={[
          { label: "วันที่", sortKey: "createdAt" },
          "ผู้ส่ง",
          "เหตุผล",
          { label: "สถานะ", sortKey: "status" },
          "รายละเอียด",
        ]}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={(key) => {
          const next = toggleSort(sortBy, sortDir, key, "desc");
          setSortBy(next.sortBy);
          setSortDir(next.sortDir);
          setPageNum(1);
        }}
        empty={page?.items.length ? undefined : "ยังไม่มีใบตรวจนับ"}
      >
        {page?.items.map((count) => (
          <tr key={count.id}>
            <td>{thaiDate(count.createdAt)}</td>
            <td>{count.submittedBy}</td>
            <td>{count.reason}</td>
            <td>{statuses[count.status]}</td>
            <td>
              <Button variant="ghost" disabled={busy || loading} aria-label={`เปิดใบตรวจนับ ${count.reason}`} onClick={() => setSelected(count)}>
                เปิดใบตรวจนับ
              </Button>
            </td>
          </tr>
        ))}
      </Table>
      {page && <Pagination
        page={page.page ?? pageNum}
        pageSize={page.pageSize ?? pageSize}
        total={page.total ?? page.items.length}
        totalPages={page.totalPages ?? 1}
        onPageChange={setPageNum}
        onPageSizeChange={(next) => { setPageSize(next); setPageNum(1); }}
        disabled={busy || loading}
      />}
      {detail}
    </div>
  );
}
