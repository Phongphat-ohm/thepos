import { useEffect, useRef, useState, type FormEvent } from "react";
import { payoutInput, type AccountingPeriod, type Page, type PayoutInput, type PayoutObligation, type PayoutReceipt } from "@thepos/contracts";
import { Field } from "@/components/common/fields";
import { Modal } from "@/components/common/modal";
import { Pagination, Table, toggleSort, type SortDir } from "@/components/data-table/table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { confirmAction, notifyError, notifySuccess } from "@/lib/alerts";
import { business, errorCode, errorMessage } from "@/lib/native";

const dateTime = new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" });
const methods = { CASH: "เงินสดจากสำนักงาน", BANK_TRANSFER: "โอนธนาคาร" };
const labels = { UNPAID: "ยังไม่จ่าย", PARTIAL: "จ่ายบางส่วน", PAID_IN_FULL: "จ่ายครบ" };

export function Payouts({ period, canPay }: { period: AccountingPeriod; canPay: boolean }) {
  const [rows, setRows] = useState<Page<PayoutObligation>>({ items: [], nextCursor: null });
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [status, setStatus] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState("number");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PayoutObligation>();
  const [receipt, setReceipt] = useState<PayoutReceipt>();
  const seqRef = useRef(0);

  async function load(
    q = applied,
    nextStatus = status,
    nextPage = pageNum,
    nextSize = pageSize,
    nextSortBy = sortBy,
    nextSortDir = sortDir,
  ) {
    const seq = ++seqRef.current;
    setBusy(true);
    setError("");
    try {
      const result = await business<Page<PayoutObligation>>("payout_obligations", {
        id: period.id,
        query: {
          q: q.trim() || undefined,
          status: nextStatus || undefined,
          page: nextPage,
          limit: nextSize,
          sortBy: nextSortBy,
          sortDir: nextSortDir,
        },
      });
      if (seq !== seqRef.current) return;
      setApplied(q);
      setRows(result);
    } catch (reason) {
      if (seq === seqRef.current) setError(errorMessage(reason));
    } finally {
      if (seq === seqRef.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load(applied, status, pageNum, pageSize, sortBy, sortDir);
  }, [status, pageNum, pageSize, sortBy, sortDir]);

  return <>
    <div className="stock-section-title"><h3>ยอดค้างจ่ายรายสมาชิก</h3>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}>โหลดสถานะการจ่ายล่าสุด</Button>
    </div>
    <form className="stock-inline stock-search" onSubmit={(event) => {
      event.preventDefault();
      setPageNum(1);
      void load(query.trim(), status, 1, pageSize, sortBy, sortDir);
    }}>
      <Field label="ค้นหายอดค้างจ่าย" placeholder="เลขสมาชิกหรือชื่อ" value={query} maxLength={100}
        onChange={(event) => setQuery(event.target.value)} />
      <Select label="สถานะ" value={status} onChange={(e) => { setStatus(e.target.value); setPageNum(1); }}>
        <option value="">ทั้งหมด</option>
        <option value="UNPAID">ยังไม่จ่าย</option>
        <option value="PARTIAL">จ่ายบางส่วน</option>
        <option value="PAID_IN_FULL">จ่ายครบ</option>
      </Select>
      <Button type="submit" variant="outline" disabled={busy}>ค้นหา</Button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {receipt && <p className="stock-success" role="status">บันทึกการจ่าย {receipt.amount} บาทแล้ว · เลขที่ใบจ่าย {receipt.receiptNumber}</p>}
    <Table
      headings={[
        { label: "สมาชิก", sortKey: "number" },
        { label: "สิทธิ์รวม (บาท)", sortKey: "totalAmount", numeric: true },
        { label: "จ่ายแล้ว", sortKey: "paidAmount", numeric: true },
        { label: "คงค้าง", numeric: true },
        { label: "สถานะ", sortKey: "status" },
        "รายการจ่าย",
      ]}
      sortBy={sortBy}
      sortDir={sortDir}
      onSort={(key) => {
        const next = toggleSort(sortBy, sortDir, key, "asc");
        setSortBy(next.sortBy);
        setSortDir(next.sortDir);
        setPageNum(1);
      }}
      loading={busy && !rows.items.length} empty={!rows.items.length ? "ไม่พบรายการจ่ายในงวดนี้" : undefined}>
      {rows.items.map((row) => <tr key={row.id}>
        <td><strong>{row.number}</strong><small>{row.name}</small></td>
        <td className="report-number">{row.total}</td>
        <td className="report-number">{row.paid}</td>
        <td className="report-number"><strong>{row.remaining}</strong></td>
        <td>{labels[row.status]}</td>
        <td><Button type="button" variant="outline" disabled={busy} onClick={() => setSelected(row)}>เปิดรายการจ่าย</Button></td>
      </tr>)}
    </Table>
    <Pagination
      page={rows.page ?? pageNum}
      pageSize={rows.pageSize ?? pageSize}
      total={rows.total ?? rows.items.length}
      totalPages={rows.totalPages ?? 1}
      onPageChange={setPageNum}
      onPageSizeChange={(next) => { setPageSize(next); setPageNum(1); }}
      disabled={busy}
    />
    {selected && <PayoutDialog obligation={selected} canPay={canPay && selected.status !== "PAID_IN_FULL"} close={() => setSelected(undefined)}
      recorded={(result) => { setSelected(undefined); setReceipt(result); notifySuccess("บันทึกการจ่ายแล้ว"); void load(); }} />}
  </>;
}

function PayoutDialog({ obligation, canPay, close, recorded }: {
  obligation: PayoutObligation; canPay: boolean; close: () => void; recorded: (receipt: PayoutReceipt) => void;
}) {
  const [history, setHistory] = useState<Page<PayoutReceipt>>({ items: [], nextCursor: null });
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState("paidAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [error, setError] = useState("");
  const [method, setMethod] = useState<PayoutInput["method"]>("CASH");
  const [pending, setPending] = useState<{ input: PayoutInput; key: string }>();
  const [uncertain, setUncertain] = useState(false);

  async function load(nextPage = pageNum, nextSize = pageSize, nextSortBy = sortBy, nextSortDir = sortDir) {
    setLoading(true);
    setHistoryError("");
    try {
      const result = await business<Page<PayoutReceipt>>("payout_history", {
        id: obligation.id,
        query: { page: nextPage, limit: nextSize, sortBy: nextSortBy, sortDir: nextSortDir },
      });
      setHistory(result);
    } catch (reason) { setHistoryError(errorMessage(reason)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(pageNum, pageSize, sortBy, sortDir); }, [pageNum, pageSize, sortBy, sortDir]);

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { drawer, ...fields } = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = payoutInput.safeParse({ ...fields, ...(drawer && { drawer: true }) });
    if (!parsed.success) { setError("กรอกจำนวนเงินและเลขอ้างอิงการโอนให้ครบ"); return; }
    setError("");
    setPending({ input: parsed.data, key: crypto.randomUUID() });
  }

  async function post() {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try { recorded(await business<PayoutReceipt>("post_payout", { id: obligation.id, ...pending })); }
    catch (reason) {
      const code = errorCode(reason);
      const unknown = !code || code === "NETWORK_ERROR" || code === "UNAVAILABLE";
      setUncertain(unknown);
      if (unknown) setError("ยังยืนยันผลการบันทึกไม่ได้ กดส่งรายการเดิมอีกครั้งเพื่อตรวจสอบ");
      else void notifyError("บันทึกการจ่ายไม่สำเร็จ", errorMessage(reason));
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (busy) return;
    if (uncertain) {
      const ok = await confirmAction({
        title: "ปิดหน้าต่างรายการจ่าย?",
        text: "ระบบยังไม่ยืนยันผลการส่งคำขอก่อนหน้า หากปิดหน้าต่างควรตรวจสอบประวัติการจ่ายก่อนทำรายการซ้ำ",
        confirmText: "ปิดหน้าต่าง",
        danger: true,
      });
      if (!ok) return;
    }
    close();
  }

  return <Modal title={`รายการจ่าย · ${obligation.number}`} size="lg" busy={busy && "กำลังบันทึกการจ่าย"} close={() => void cancel()}>
    <div className="form-stack">
      <dl className="member-facts">
        <div><dt>สมาชิก</dt><dd>{obligation.name}</dd></div>
        <div><dt>ยอดคงค้าง</dt><dd>{obligation.remaining} บาท</dd></div>
      </dl>
      {canPay && <>
        <form className={pending ? "" : "stock-editor"} hidden={!!pending} onSubmit={review}>
          <h3>บันทึกการจ่าย</h3>
          <div className="field-row">
            <Field autoFocus label="จำนวนเงินที่จะจ่าย (บาท)" name="amount" required inputMode="decimal" maxLength={13} defaultValue={obligation.remaining} />
            <Select label="วิธีจ่าย" name="method" value={method} onChange={(event) => setMethod(event.target.value as PayoutInput["method"])}>
              <option value="CASH">{methods.CASH}</option><option value="BANK_TRANSFER">{methods.BANK_TRANSFER}</option>
            </Select>
          </div>
          {method === "BANK_TRANSFER" && <Field label="เลขอ้างอิงการโอน" name="reference" required maxLength={120} />}
          {method === "CASH" && <label><input type="checkbox" name="drawer" /> จ่ายจากลิ้นชักของเครื่องนี้</label>}
          {!pending && error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions"><Button type="submit">ตรวจสอบการจ่าย</Button></div>
        </form>
        {pending && <div className="stock-editor">
          <h3>ยืนยันการบันทึกการจ่าย</h3>
          <p>{pending.input.amount} บาท · {pending.input.method === "CASH" && pending.input.drawer ? "เงินสดจากลิ้นชัก" : methods[pending.input.method]}</p>
          {pending.input.method === "BANK_TRANSFER" && <p>เลขอ้างอิง {pending.input.reference}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <Button type="button" variant="outline" disabled={busy || uncertain} onClick={() => { setPending(undefined); setError(""); }}>กลับไปแก้ไข</Button>
            <Button type="button" disabled={busy} onClick={() => void post()}>
              {uncertain ? "ส่งรายการเดิมอีกครั้ง" : "ยืนยันบันทึกการจ่าย"}
            </Button>
          </div>
        </div>}
      </>}
      <h3>ประวัติการจ่าย</h3>
      {historyError && <p className="form-error" role="alert">{historyError} <Button type="button" variant="outline" onClick={() => void load()}>ลองอีกครั้ง</Button></p>}
      <Table
        headings={[
          { label: "เลขที่ใบจ่าย", sortKey: "receiptNumber" },
          { label: "วันและเวลา", sortKey: "paidAt" },
          "วิธีจ่าย",
          { label: "จำนวน (บาท)", sortKey: "amount", numeric: true },
          "ผู้บันทึก",
        ]}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={(key) => {
          const next = toggleSort(sortBy, sortDir, key, "desc");
          setSortBy(next.sortBy);
          setSortDir(next.sortDir);
          setPageNum(1);
        }}
        loading={loading && !history.items.length} empty={!history.items.length ? "ยังไม่มีประวัติการจ่าย" : undefined}>
        {history.items.map((row) => <tr key={row.id}><td>{row.receiptNumber}</td><td>{dateTime.format(new Date(row.paidAt))}</td>
          <td>{row.drawer ? "เงินสดจากลิ้นชัก" : methods[row.method]}{row.reference && <small>{row.reference}</small>}</td>
          <td className="report-number">{row.amount}</td><td>{row.operator}</td></tr>)}
      </Table>
      <Pagination
        page={history.page ?? pageNum}
        pageSize={history.pageSize ?? pageSize}
        total={history.total ?? history.items.length}
        totalPages={history.totalPages ?? 1}
        onPageChange={setPageNum}
        onPageSizeChange={(next) => { setPageSize(next); setPageNum(1); }}
        disabled={loading}
      />
    </div>
  </Modal>;
}
