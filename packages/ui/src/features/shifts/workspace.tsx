import { useEffect, useRef, useState, type FormEvent } from "react";
import { shiftCloseInput, shiftMovementInput, shiftOpenInput, type CashShift, type Page, type Profile, type ShiftMovement } from "@thepos/contracts";
import { Field } from "@/components/common/fields";
import { Loading } from "@/components/common/loading";
import { ManagerFields, approvalFrom } from "@/components/common/manager-approval";
import { Modal } from "@/components/common/modal";
import { Pagination, Table, toggleSort, type SortDir } from "@/components/data-table/table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { notifyError, notifySuccess } from "@/lib/alerts";
import { decimal, printerDate, retryKey } from "@/lib/format";
import { business, errorCode, errorMessage } from "@/lib/native";

type Summary = Pick<CashShift, "id" | "cashier" | "device" | "openedAt" | "closedAt" | "variance">;
type ShiftPage = Page<Summary> & { current: CashShift | null };
type Detail = Page<ShiftMovement> & { shift: CashShift };
const labels = { SALE: "ขายเงินสด", REFUND: "คืนเงินสด", CASH_IN: "นำเงินเข้า", CASH_DROP: "นำเงินเข้าเซฟ", PETTY_CASH: "เบิกจ่ายย่อย", PAYOUT_OUT: "จ่ายปันผลจากลิ้นชัก" };

export function ShiftsWorkspace({ profile }: { profile: Profile }) {
  const canOperate = profile.capabilities?.includes("shift:operate") ?? false;
  const [page, setPage] = useState<ShiftPage>();
  const [detail, setDetail] = useState<Detail>();
  const [listQ, setListQ] = useState("");
  const [listPage, setListPage] = useState(1);
  const [listSize, setListSize] = useState(25);
  const [listSortBy, setListSortBy] = useState("openedAt");
  const [listSortDir, setListSortDir] = useState<SortDir>("desc");
  const [detailPage, setDetailPage] = useState(1);
  const [detailSize, setDetailSize] = useState(25);
  const [detailSortBy, setDetailSortBy] = useState("recordedAt");
  const [detailSortDir, setDetailSortDir] = useState<SortDir>("desc");
  const [editing, setEditing] = useState<"open" | "movement" | "close">();
  const [counted, setCounted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const listSeq = useRef(0);
  const listMounted = useRef(false);
  const key = useRef<{ payload: string; key: string }>(undefined);
  const shift = detail?.shift;

  async function run(action: () => Promise<void>, failureTitle?: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError("");
    try { await action(); } catch (reason) {
      if (failureTitle) void notifyError(failureTitle, errorMessage(reason)); else setError(errorMessage(reason));
    }
    finally { pending.current = false; setBusy(false); }
  }
  async function loadList(
    nextQ = listQ,
    nextPage = listPage,
    nextSize = listSize,
    nextSortBy = listSortBy,
    nextSortDir = listSortDir,
  ) {
    const seq = ++listSeq.current;
    const result = await business<ShiftPage>("shifts", {
      query: {
        q: nextQ.trim() || undefined,
        page: nextPage,
        limit: nextSize,
        sortBy: nextSortBy,
        sortDir: nextSortDir,
      },
    });
    if (seq === listSeq.current) setPage(result);
    return result;
  }
  async function loadShift(
    id: string,
    nextPage = 1,
    nextSize = detailSize,
    nextSortBy = detailSortBy,
    nextSortDir = detailSortDir,
  ) {
    const result = await business<Detail>("shift_detail", {
      id,
      query: {
        page: nextPage,
        limit: nextSize,
        sortBy: nextSortBy,
        sortDir: nextSortDir,
      },
    });
    setDetail(result);
    setDetailPage(nextPage);
  }
  async function refreshSavedShift(id: string, includeList = false) {
    try {
      if (includeList) await loadList();
      await loadShift(id);
    } catch (reason) {
      setError(`บันทึกแล้ว แต่โหลดข้อมูลกะล่าสุดไม่ได้ · ${errorMessage(reason)}`);
    }
  }
  useEffect(() => { void run(async () => { const list = await loadList(); if (list.current) await loadShift(list.current.id); }); }, []);
  useEffect(() => {
    if (!listMounted.current) { listMounted.current = true; return; }
    const timer = window.setTimeout(() => {
      setListPage(1);
      void loadList(listQ, 1, listSize, listSortBy, listSortDir).catch((reason) => {
        setError(errorMessage(reason));
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [listQ]);

  const variance = shift && /^\d{1,10}(\.\d{1,2})?$/.test(counted) ? decimal(counted).minus(shift.expectedCash) : null;
  const approval = shift && !shift.canForceClose && variance?.abs().gt(shift.varianceLimit);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (editing === "open") {
      const result = shiftOpenInput.safeParse(values);
      if (!result.success) { setError("กรอกเงินทอนเริ่มกะเป็นบาท ทศนิยมไม่เกิน 2 ตำแหน่ง"); return; }
      void run(async () => {
        const opened = await business<CashShift>("open_shift", { input: result.data, key: retryKey(key, result.data) });
        setEditing(undefined); key.current = undefined;
        notifySuccess("เปิดกะแล้ว"); await refreshSavedShift(opened.id, true);
      }, "เปิดกะไม่สำเร็จ");
    } else if (editing === "movement" && shift) {
      const result = shiftMovementInput.safeParse(values);
      if (!result.success) { setError("ระบุจำนวนเงินมากกว่า 0 บาทและเหตุผล"); return; }
      void run(async () => {
        await business("shift_movement", { id: shift.id, input: result.data, key: retryKey(key, { id: shift.id, ...result.data }) });
        setEditing(undefined); key.current = undefined;
        notifySuccess("บันทึกรายการเงินสดแล้ว"); await refreshSavedShift(shift.id);
      }, "บันทึกรายการเงินสดไม่สำเร็จ");
    } else if (editing === "close" && shift) {
      const result = shiftCloseInput.safeParse({ countedCash: counted, expectedCash: shift.expectedCash,
        ...(approval && { approval: approvalFrom(new FormData(event.currentTarget)) }) });
      if (!result.success) { setError("ตรวจสอบยอดนับจริงและ PIN ผู้จัดการ 6 หลักเมื่อมีผลต่าง"); return; }
      void run(async () => {
        try { await business("close_shift", { id: shift.id, input: result.data }); }
        catch (reason) {
          if (errorCode(reason) === "SHIFT_STALE") { setCounted(""); await loadShift(shift.id); }
          throw reason;
        }
        setEditing(undefined); setCounted("");
        notifySuccess("ปิดกะและบันทึกผลกระทบยอดแล้ว"); await refreshSavedShift(shift.id, true);
      }, "ปิดกะไม่สำเร็จ");
    }
  }

  return <section className="stock-workspace" aria-label="กะเงินสด" aria-busy={busy}><div className="stock-content">
    <div className="stock-section-title"><h2>{shift ? "รายละเอียดกะเงินสด" : "กะของเครื่องนี้"}</h2><div className="register-inline">
      <Button type="button" variant="outline" disabled={busy || !!editing} onClick={() => void run(async () => {
        const list = await loadList(); if (shift || list.current) await loadShift((shift ?? list.current)!.id);
      })}>รีเฟรช</Button>
      {canOperate && page && !page.current && !editing && <Button type="button" disabled={busy} onClick={() => setEditing("open")}>เปิดกะ</Button>}
      {page?.current && shift?.id !== page.current.id && <Button type="button" disabled={busy || !!editing} onClick={() => void run(() => loadShift(page.current!.id))}>เปิดดูกะปัจจุบัน</Button>}
    </div></div>
    {busy && !editing && <Loading label="กำลังโหลดกะเงินสด" variant={page ? "inline" : "skeleton"} />}
    {error && !editing && <p className="form-error" role="alert">{error}</p>}
    {!shift && !busy && !editing && <p className="stock-help">ยังไม่มีกะที่เปิดอยู่สำหรับบัญชีนี้บนเครื่องนี้</p>}
    {shift && <>
      <p>{shift.cashier} · {shift.device} · เปิด {printerDate(shift.openedAt)}{shift.closedAt ? ` · ปิด ${printerDate(shift.closedAt)}` : " · กำลังเปิดกะ"}</p>
      <dl className="member-facts">
        <div><dt>เงินทอนเริ่มกะ</dt><dd>{shift.openingFloat} บาท</dd></div>
        <div><dt>ขายเงินสด</dt><dd>{shift.cashSales} บาท</dd></div>
        <div><dt>คืนเงินสด</dt><dd>{shift.cashRefunds} บาท</dd></div>
        <div><dt>เงินเข้าอื่น</dt><dd>{shift.cashIn} บาท</dd></div>
        <div><dt>เงินออกอื่น</dt><dd>{shift.cashOut} บาท</dd></div>
        <div><dt>เงินตามระบบ</dt><dd>{shift.expectedCash} บาท</dd></div>
        {shift.closedAt && <><div><dt>นับได้</dt><dd>{shift.countedCash} บาท</dd></div>
          <div><dt>ขาด / เกิน</dt><dd>{shift.variance} บาท</dd></div><div><dt>ผู้อนุมัติ</dt><dd>{shift.approver ?? "—"}</dd></div></>}
      </dl>
      {((canOperate && shift.editable) || shift.canForceClose) && !editing && <div className="register-inline">
        {canOperate && shift.editable && <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing("movement")}>บันทึกเงินเข้า / ออก</Button>}
        <Button type="button" variant={shift.canForceClose ? "outline" : "default"} disabled={busy} onClick={() => { setCounted(""); setEditing("close"); }}>
          {shift.canForceClose ? "ปิดกะค้างแทน (ผู้จัดการ)" : "ตรวจนับและปิดกะ"}
        </Button>
      </div>}
    </>}
    {editing && <Modal title={editing === "open" ? "เปิดกะเงินสด" : editing === "movement" ? "บันทึกเงินเข้า / ออก" : shift?.canForceClose ? "ปิดกะค้างแทน (ผู้จัดการ)" : "ตรวจนับและปิดกะ"}
      close={() => { setEditing(undefined); setError(""); }} busy={busy && "กำลังบันทึกข้อมูลกะ"}>
      <form className="form-stack" onSubmit={submit}>
      {editing === "open" && <Field name="openingFloat" label="เงินทอนเริ่มกะ (บาท)" inputMode="decimal" maxLength={13} autoFocus required />}
      {editing === "movement" && <>
        <div className="field-row"><Select label="รายการเงินสด" name="kind">{(["CASH_IN", "CASH_DROP", "PETTY_CASH"] as const).map((kind) => <option key={kind} value={kind}>{labels[kind]}</option>)}</Select>
          <Field label="จำนวนเงิน (บาท)" name="amount" inputMode="decimal" maxLength={13} required /></div>
        <Field label="เหตุผลหรือเลขอ้างอิง" name="reason" maxLength={300} required />
      </>}
      {editing === "close" && <>
        <p className="stock-help">เงินตามระบบ {shift?.expectedCash} บาท ตรวจนับลิ้นชักก่อนยืนยัน</p>
        <Field label="เงินที่นับได้จริง (บาท)" value={counted} onChange={(event) => setCounted(event.target.value)} inputMode="decimal" maxLength={13} autoFocus required />
        {variance && <p role="status">{variance.isZero() ? "ยอดตรงกับระบบ" : `เงิน${variance.isNegative() ? "ขาด" : "เกิน"} ${variance.abs().toFixed(2)} บาท`}</p>}
        {shift?.canForceClose && <p className="notice" role="status">กำลังปิดกะของ {shift.cashier} บนเครื่อง {shift.device} ในฐานะผู้จัดการ ระบบจะบันทึกชื่อของคุณเป็นผู้อนุมัติปิดกะ</p>}
        {approval && <><p className="stock-help">ผลต่างเกิน {shift?.varianceLimit} บาท ต้องใช้ PIN ผู้จัดการ</p><ManagerFields /></>}
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><Button type="button" variant="ghost" disabled={busy} onClick={() => { setEditing(undefined); setError(""); }}>ยกเลิก</Button>
        <Button type="submit" disabled={busy}>{editing === "close" ? "ยืนยันปิดกะ" : "บันทึก"}</Button></div>
    </form></Modal>}
    {detail && <>
      <h3>รายการเงินสดในกะ</h3>
      <Table
        headings={[
          { label: "เวลา", sortKey: "recordedAt" },
          { label: "รายการ", sortKey: "kind" },
          { label: "จำนวนเงิน (บาท)", sortKey: "amount", numeric: true },
          "หมายเหตุ / อ้างอิง",
        ]}
        sortBy={detailSortBy}
        sortDir={detailSortDir}
        onSort={(key) => {
          const next = toggleSort(detailSortBy, detailSortDir, key, "desc");
          setDetailSortBy(next.sortBy);
          setDetailSortDir(next.sortDir);
          void run(() => loadShift(detail.shift.id, 1, detailSize, next.sortBy, next.sortDir));
        }}
        empty={!detail.items.length ? "ยังไม่มีรายการในกะ" : undefined}
      >
        {detail.items.map((row) => <tr key={row.id}><td>{printerDate(row.recordedAt)}</td><td>{labels[row.kind]}</td>
          <td className="report-number">{row.kind === "SALE" || row.kind === "CASH_IN" ? "+" : "−"}{row.amount}</td><td>{row.reason ?? row.reference ?? "—"}</td></tr>)}
      </Table>
      <Pagination
        page={detail.page ?? detailPage}
        pageSize={detail.pageSize ?? detailSize}
        total={detail.total ?? detail.items.length}
        totalPages={detail.totalPages ?? 1}
        onPageChange={(nextPage) => void run(() => loadShift(detail.shift.id, nextPage, detailSize, detailSortBy, detailSortDir))}
        onPageSizeChange={(nextSize) => {
          setDetailSize(nextSize);
          void run(() => loadShift(detail.shift.id, 1, nextSize, detailSortBy, detailSortDir));
        }}
        disabled={busy}
      />
    </>}
    <h3>ประวัติกะ</h3>
    <div className="stock-inline stock-search">
      <Field
        label="ค้นหากะ"
        value={listQ}
        onChange={(e) => setListQ(e.target.value)}
        placeholder="ชื่อแคชเชียร์ หรือชื่อเครื่อง"
      />
      <Button type="button" variant="outline" disabled={busy} onClick={() => {
        setListPage(1);
        void run(async () => { await loadList(listQ, 1, listSize, listSortBy, listSortDir); });
      }}>ค้นหา</Button>
    </div>
    <Table
      headings={[
        { label: "เปิดกะ", sortKey: "openedAt" },
        "แคชเชียร์",
        "เครื่อง",
        "สถานะ",
        { label: "ขาด / เกิน", sortKey: "variance", numeric: true },
        "รายละเอียด",
      ]}
      sortBy={listSortBy}
      sortDir={listSortDir}
      onSort={(key) => {
        const next = toggleSort(listSortBy, listSortDir, key, "desc");
        setListSortBy(next.sortBy);
        setListSortDir(next.sortDir);
        setListPage(1);
        void run(async () => { await loadList(listQ, 1, listSize, next.sortBy, next.sortDir); });
      }}
      empty={!page?.items.length ? "ยังไม่มีประวัติกะ" : undefined}
    >
      {page?.items.map((row) => <tr key={row.id}><td>{printerDate(row.openedAt)}</td><td>{row.cashier}</td><td>{row.device}</td>
        <td><span className={`status-badge ${row.closedAt ? "is-inactive" : "is-active"}`}>{row.closedAt ? "ปิดแล้ว" : "เปิดอยู่"}</span></td><td className="report-number">{row.variance ?? "—"}</td>
        <td><Button type="button" variant="outline" disabled={busy || !!editing} onClick={() => void run(() => loadShift(row.id, 1, detailSize, detailSortBy, detailSortDir))}>ดูกะ</Button></td></tr>)}
    </Table>
    {page && <Pagination
      page={page.page ?? listPage}
      pageSize={page.pageSize ?? listSize}
      total={page.total ?? page.items.length}
      totalPages={page.totalPages ?? 1}
      onPageChange={(nextPage) => {
        setListPage(nextPage);
        void run(async () => { await loadList(listQ, nextPage, listSize, listSortBy, listSortDir); });
      }}
      onPageSizeChange={(nextSize) => {
        setListSize(nextSize);
        setListPage(1);
        void run(async () => { await loadList(listQ, 1, nextSize, listSortBy, listSortDir); });
      }}
      disabled={busy}
    />}
  </div></section>;
}
