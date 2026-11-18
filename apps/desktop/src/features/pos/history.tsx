import { useCallback, useEffect, useState, type FormEvent } from "react";
import { returnInput, returnQuoteInput, type ReturnInput, type ReturnQuoteInput } from "@thepos/contracts";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/fields";
import { Loading } from "@/components/loading";
import { Modal } from "@/components/modal";
import { confirmAction, notifyError, notifySuccess } from "@/lib/alerts";
import { business, errorCode, errorMessage } from "@/lib/native";
import { Pagination, Select, Table, toggleSort, type Page, type SortDir } from "../stock/shared";
import { approvalFrom, ManagerFields, ReceiptView } from "./dialogs";
import { decimal, paymentLabels, printerDate, readStored, type Receipt, type ReturnQuote, type ReturnReceipt, type SaleSummary } from "./model";
import type { PrintSettings } from "./printing";

export function SalesHistory({ canReturn, drawer, storage, settings, configure }: {
  canReturn: boolean; drawer?: boolean; storage: string; settings: PrintSettings; configure: () => void;
}) {
  const [data, setData] = useState<Page<SaleSummary>>();
  const [active, setActive] = useState<Receipt>();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [invoiceInput, setInvoiceInput] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState("completedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const load = useCallback(async (nextQ: string, nextPage: number, nextSize: number, nextSortBy: string, nextSortDir: SortDir) => {
    setBusy(true); setError("");
    try {
      const updated = await business<Page<SaleSummary>>("sales_history", {
        query: {
          q: nextQ.trim() || undefined,
          page: nextPage,
          limit: nextSize,
          sortBy: nextSortBy,
          sortDir: nextSortDir,
        },
      });
      setData(updated);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    void load(q, page, pageSize, sortBy, sortDir);
  }, [load, q, page, pageSize, sortBy, sortDir]);

  async function open(id: string) {
    setBusy(true); setError("");
    try { setActive(await business<Receipt>("sale_detail", { id })); setEditing(false); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <div className="form-stack">
    {error && <p role="alert" className="notice">{error}</p>}
    {busy && !!data?.items.length && <Loading label="กำลังโหลดข้อมูลบิล" variant="inline" />}
    <>
      <form className="stock-inline" onSubmit={(event) => {
        event.preventDefault();
        setPage(1);
        setQ(invoiceInput);
      }}>
        <Field name="invoice" label="เลขที่ใบเสร็จ" value={invoiceInput} onChange={(e) => setInvoiceInput(e.target.value)} autoFocus maxLength={50} />
        <Button type="submit" loading={busy}>ค้นหาบิล</Button>
      </form>
      <Table
        headings={[
          { label: "เลขที่ใบเสร็จ", sortKey: "invoiceNumber" },
          { label: "เวลา", sortKey: "completedAt" },
          { label: "ยอดขาย", sortKey: "netTotal", numeric: true },
          "คืนแล้ว",
          "",
        ]}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={(key) => {
          const next = toggleSort(sortBy, sortDir, key, "desc");
          setSortBy(next.sortBy);
          setSortDir(next.sortDir);
          setPage(1);
        }}
        loading={busy && !data?.items.length}
        empty={data?.items.length ? undefined : "ไม่พบบิลขาย"}
      >
        {data?.items.map((row) => <tr key={row.id}><td>{row.invoiceNumber}</td><td>{printerDate(row.completedAt)}</td>
          <td className="report-number">{row.netTotal}</td><td className="report-number">{row.returnedTotal}</td>
          <td><Button variant="ghost" disabled={busy} onClick={() => void open(row.id)}>เปิดบิล {row.invoiceNumber}</Button></td></tr>)}
      </Table>
      <Pagination
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? pageSize}
        total={data?.total ?? data?.items.length ?? 0}
        totalPages={data?.totalPages ?? 1}
        onPageChange={setPage}
        onPageSizeChange={(next) => { setPageSize(next); setPage(1); }}
        disabled={busy}
      />
    </>
    {active && !editing && <Modal title={`ใบเสร็จ · ${active.invoiceNumber}`} size="lg" close={() => setActive(undefined)}><div className="form-stack">
      <div className="register-inline">
        {canReturn && <Button variant="outline" onClick={() => setEditing(true)}>คืนสินค้า</Button>}
      </div>
      <ReceiptView receipt={active} settings={settings} configure={configure} />
    </div></Modal>}
    {active && editing && <ReturnEditor receipt={active} drawer={drawer} storage={storage} close={() => setEditing(false)}
      refresh={() => business<Receipt>("sale_detail", { id: active.id }).then(setActive)} />}
  </div>;
}

type ReturnPending = { key: string; input: Omit<ReturnInput, "approval">; quote: ReturnQuote };
function ReturnEditor({ receipt, drawer, storage, refresh, close }: { receipt: Receipt; drawer?: boolean; storage: string; refresh: () => Promise<void>; close: () => void }) {
  const key = storage + "/return/" + receipt.id;
  const [pending, setPending] = useState(() => readStored<ReturnPending | null>(key, null));
  const [rows, setRows] = useState<Record<string, { quantity: string; disposition: "SELLABLE" | "DAMAGED" }>>({});
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ReturnReceipt>();
  const [quote, setQuote] = useState<{ input: ReturnQuoteInput; result: ReturnQuote }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const returnable = receipt.items.filter((item) => item.returnable && decimal(item.returnable).gt(0));
  const preview = pending?.quote ?? quote?.result;

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = returnQuoteInput.safeParse({
      reason, lines: Object.entries(rows).filter(([, value]) => value.quantity).map(([saleItemId, value]) => ({ saleItemId, ...value })),
    });
    if (!input.success) { setError("ระบุเหตุผลและจำนวนที่จะคืนอย่างน้อยหนึ่งรายการ"); return; }
    setBusy(true); setError("");
    try {
      const result = await business<ReturnQuote>("return_quote", { id: receipt.id, input: input.data });
      setQuote({ input: input.data, result });
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || (!pending && !quote)) return;
    const submitted = pending ?? { key: crypto.randomUUID(), input: { ...quote!.input, expectedQuote: preview.quote,
      ...(drawer && { drawer: true as const }) }, quote: preview };
    const credential = approvalFrom(new FormData(event.currentTarget));
    const input = returnInput.safeParse({
      ...submitted.input, ...(!pending || credential.username || credential.pin ? { approval: credential } : {}),
    });
    if (!input.success) { setError("กรอกชื่อผู้จัดการและ PIN 6 หลัก"); return; }
    setBusy(true); setError(""); setPending(submitted);
    localStorage.setItem(key, JSON.stringify(submitted));
    try {
      const actual = await business<ReturnReceipt>("return_sale", { id: receipt.id, key: submitted.key, input: input.data });
      setResult(actual); setRows({}); setQuote(undefined); setPending(null); localStorage.removeItem(key);
      notifySuccess("บันทึกคืนสินค้าแล้ว", `฿${actual.netTotal}`);
      await refresh().catch(() => setError("คืนสินค้าแล้ว แต่ยังโหลดรายละเอียดล่าสุดไม่ได้ กรุณาเปิดบิลอีกครั้ง"));
    } catch (reason) {
      const code = errorCode(reason);
      if (code && !["NETWORK_ERROR", "UNAVAILABLE", "SESSION_LOCKED", "SESSION_REQUIRED", "INVALID_PIN", "RATE_LIMITED", "APPROVAL_REQUIRED"].includes(code)) {
        void notifyError("บันทึกคืนสินค้าไม่สำเร็จ", errorMessage(reason));
        setPending(null); localStorage.removeItem(key);
        if (code === "RETURN_LIMIT") { setQuote(undefined); await refresh().catch(() => undefined); }
      } else if (code === "INVALID_PIN" || code === "RATE_LIMITED" || code === "APPROVAL_REQUIRED") {
        setError(errorMessage(reason));
      } else {
        setError("ยังยืนยันผลการคืนไม่ได้ ส่งคำขอเดิมอีกครั้งเพื่อตรวจสอบโดยไม่คืนซ้ำ");
      }
    } finally { setBusy(false); }
  }

  return <Modal title={`คืนสินค้า · ${receipt.invoiceNumber}`} size="lg" close={close}
    busy={busy && (preview ? "กำลังบันทึกการคืน" : "กำลังคำนวณยอดคืน")}><div className="form-stack">
  {result ? <>
    <p className="stock-success" role="status">บันทึกคืนสินค้าแล้ว ฿{result.netTotal}</p>
    {error && <p className="notice" role="status">{error}</p>}
    <RefundLines refunds={result.refunds} />
    <Button variant="outline" onClick={() => setResult(undefined)}>คืนรายการเพิ่มเติม</Button>
  </> : <>
    {error && <p className="notice" role="alert">{error}</p>}
    {!preview && returnable.length === 0 && <p>คืนสินค้าครบแล้ว</p>}
    {!preview && returnable.length > 0 && <form className="form-stack" onSubmit={(event) => void inspect(event)}>
      <div><Button type="button" variant="outline" onClick={() => setRows(Object.fromEntries(returnable.map((item) =>
        [item.id, { quantity: item.returnable!, disposition: "SELLABLE" }] )))}>เลือกคืนทั้งหมดที่เหลือ</Button></div>
      <Table headings={["สินค้า", "จำนวนที่คืนได้", "จำนวนคืน", "สภาพสินค้า"]}>
        {returnable.map((item) => {
          const current = rows[item.id] ?? { quantity: "", disposition: "SELLABLE" as const };
          return <tr key={item.id}>
            <td>{item.name}</td><td>{item.returnable} {item.unit}</td>
            <td><input className="input count-input" aria-label={`จำนวนคืน ${item.name} ${item.unit}`} value={current.quantity}
              onChange={(event) => setRows((old) => ({ ...old, [item.id]: { ...current, quantity: event.target.value } }))}
              inputMode="decimal" /></td>
            <td><select className="input" value={current.disposition} aria-label={`สภาพสินค้า ${item.name} ${item.unit}`}
              onChange={(event) => setRows((old) => ({ ...old, [item.id]: {
                ...current, disposition: event.target.value === "DAMAGED" ? "DAMAGED" : "SELLABLE",
              } }))}><option value="SELLABLE">ขายต่อได้</option><option value="DAMAGED">ชำรุด</option></select></td>
          </tr>;
        })}
      </Table>
      <Field label="เหตุผลที่คืน" value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={300} />
      <Button type="submit" disabled={busy}>คำนวณยอดคืน</Button>
    </form>}
    {preview && <form className="form-stack" onSubmit={(event) => void submit(event)} noValidate>
      <div className="register-payment-total"><span>ยอดคืน</span><strong>฿{preview.total}</strong></div>
      <RefundLines refunds={preview.refunds} />
      {pending && <p>ระบบจะลองบันทึกด้วยรหัสเดิมเพื่อป้องกันการคืนซ้ำ</p>}
      <ManagerFields />
      <div className="register-inline">
        <Button type="submit" disabled={busy}>{pending ? "ส่งคำขอคืนเดิมอีกครั้ง" : "ยืนยันบันทึกการคืน"}</Button>
        {!pending && <Button type="button" variant="outline" onClick={() => setQuote(undefined)}>แก้ไขรายการคืน</Button>}
        {pending && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              const ok = await confirmAction({
                title: "ยกเลิกรายการคืนที่ค้าง?",
                text: "ตรวจสอบรายละเอียดบิลก่อนเพื่อยืนยันว่ายังไม่มีการบันทึกคืนสินค้านี้แล้ว",
                confirmText: "ยกเลิกรายการค้าง",
                danger: true,
              });
              if (!ok) return;
              localStorage.removeItem(key);
              setPending(null);
              setQuote(undefined);
              setError("");
            }}
          >
            ยกเลิกรายการค้าง
          </Button>
        )}
      </div>
    </form>}
  </>}
  </div></Modal>;
}

function RefundLines({ refunds }: { refunds: ReturnQuote["refunds"] }) {
  return <ul className="register-refunds">{refunds.map((row, index) => <li key={index}>
    {paymentLabels[row.method]} ฿{row.amount}{row.reference && ` · อ้างอิงบิลเดิม ${row.reference}`}
  </li>)}</ul>;
}
