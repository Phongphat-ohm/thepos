import { useRef, useState, type FormEvent } from "react";
import { Download, Sheet } from "lucide-react";
import { reportQuery, type Profile, type Report, type ReportKind, type ReportQuery } from "@thepos/contracts";
import { Field } from "@/components/common/fields";
import { Loading } from "@/components/common/loading";
import { Pagination, Table, type SortDir } from "@/components/data-table/table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { notifyError, notifySuccess } from "@/lib/alerts";
import { thaiDate, today } from "@/lib/format";
import { business, errorCode, errorMessage } from "@/lib/native";
import { hasReportPermission, reportOptions } from "./options";

export type ReportRequest = {
  criteria: ReportQuery;
  page: number;
  pageSize: number;
  sortCol?: number;
  sortDir: SortDir;
};

export type LoadedReport = ReportRequest & {
  report: Report;
};

export function isAuthError(reason: unknown) {
  const code = errorCode(reason);
  return code === "SESSION_REQUIRED" || code === "SESSION_LOCKED" || code === "FORBIDDEN";
}

export function canExportReport(state: { loaded?: LoadedReport; error: string; busy: boolean }) {
  return !state.busy && !!state.loaded && !state.error;
}

export function nextLoadedAfterError(current: LoadedReport | undefined, reason: unknown): LoadedReport | undefined {
  return isAuthError(reason) ? undefined : current;
}

export function ReportsWorkspace({ profile }: { profile: Profile }) {
  const allowed = reportOptions.filter(({ permission }) => hasReportPermission(profile, permission));
  const [kind, setKind] = useState<ReportKind>(allowed[0]?.kind ?? "daily");
  const [loaded, setLoaded] = useState<LoadedReport>();
  const [failedRequest, setFailedRequest] = useState<ReportRequest>();
  const [operation, setOperation] = useState<"load" | "excel" | "pdf">();
  const busy = !!operation;
  const [error, setError] = useState("");
  const loadSeq = useRef(0);
  const day = today();

  async function run(
    op: NonNullable<typeof operation>,
    action: () => Promise<void>,
    onLoadError?: (reason: unknown) => void,
  ) {
    if (busy) return;
    setOperation(op); setError("");
    try { await action(); } catch (reason) {
      if (op === "load") {
        setError(errorMessage(reason));
        onLoadError?.(reason);
      } else {
        void notifyError("ส่งออกรายงานไม่สำเร็จ", "ลองส่งออกอีกครั้ง หรือลดช่วงวันที่ของรายงาน");
      }
    } finally { setOperation(undefined); }
  }

  function fetchPage(req: ReportRequest) {
    const seq = ++loadSeq.current;
    void run(
      "load",
      async () => {
        const res = await business<Report>("reports", {
          query: {
            ...req.criteria,
            page: req.page,
            limit: req.pageSize,
            sortCol: req.sortCol,
            sortDir: req.sortCol !== undefined ? req.sortDir : undefined,
          },
        });
        if (seq !== loadSeq.current) return;
        setLoaded({
          report: res,
          criteria: req.criteria,
          page: res.page ?? req.page,
          pageSize: res.pageSize ?? req.pageSize,
          sortCol: req.sortCol,
          sortDir: req.sortDir,
        });
        setFailedRequest(undefined);
      },
      (reason) => {
        if (seq !== loadSeq.current) return;
        setFailedRequest(req);
        setLoaded((current) => nextLoadedAfterError(current, reason));
      },
    );
  }

  function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = reportQuery.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) { setError("เลือกช่วงวันที่ไม่เกิน 366 วันและตรวจสอบตัวกรอง"); return; }
    const nextPageSize = loaded?.pageSize ?? 25;
    setLoaded(undefined);
    setFailedRequest(undefined);
    fetchPage({ criteria: parsed.data, page: 1, pageSize: nextPageSize, sortCol: undefined, sortDir: "desc" });
  }

  function download(format: "excel" | "pdf") {
    if (!loaded || error) return;
    const { criteria, sortCol, sortDir } = loaded;
    void run(format, async () => {
      const full = await business<Report>("reports", {
        query: {
          ...criteria,
          sortCol,
          sortDir: sortCol !== undefined ? sortDir : undefined,
        },
      });
      const { exportExcel, exportPdf } = await import("./export");
      await (format === "excel" ? exportExcel(full) : exportPdf(full));
      notifySuccess("เตรียมไฟล์รายงานแล้ว", format === "excel" ? "Excel (.xlsx)" : "PDF");
    });
  }

  const exportDisabled = !canExportReport({ loaded, error, busy });

  return <section className="stock-workspace" aria-label="รายงาน" aria-busy={busy}><div className="stock-content">
    <h2>เรียกดูรายงาน</h2>
    <form className="stock-editor" onSubmit={load}>
      <div className="stock-grid">
        <Select label="ประเภทรายงาน" name="kind" value={kind} onChange={(event) => {
          setKind(event.target.value as ReportKind);
          setLoaded(undefined);
          setFailedRequest(undefined);
          setError("");
        }} disabled={busy}>
          {allowed.map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}
        </Select>
        <Field label="ตั้งแต่วันที่" name="start" type="date" defaultValue={day.slice(0, 8) + "01"} required disabled={busy} />
        <Field label="ถึงวันที่" name="end" type="date" defaultValue={day} required disabled={busy} />
        <Field label="กรองข้อความ" name="q" placeholder="ชื่อ รหัส หรือข้อความในรายงาน" maxLength={120} disabled={busy} />
      </div>
      <div className="form-actions"><Button type="submit" disabled={busy} loading={operation === "load"}>แสดงรายงาน</Button></div>
    </form>
    {operation && <Loading label={operation === "load" ? "กำลังจัดทำรายงาน" : `กำลังเตรียมไฟล์ ${operation === "excel" ? "Excel" : "PDF"}`}
      variant={operation === "load" ? "skeleton" : "panel"} />}
    {error && <div className="stock-inline">
      <p className="form-error" role="alert">{error}</p>
      {failedRequest && (
        <Button type="button" variant="outline" disabled={busy} onClick={() => fetchPage(failedRequest)}>
          ลองโหลดอีกครั้ง
        </Button>
      )}
    </div>}
    {loaded && error && (
      <p className="notice" role="status">
        คำขอล่าสุดไม่สำเร็จ ตารางด้านล่างยังเป็นข้อมูลเดิมที่โหลดสำเร็จก่อนหน้า ปิดการส่งออกชั่วคราวจนกว่าจะโหลดสำเร็จอีกครั้ง
      </p>
    )}
    {!loaded && !operation && !error && <div className="table-empty">
      <Sheet size={25} aria-hidden="true" />
      <p>เลือกช่วงวันที่แล้วกดแสดงรายงาน</p>
    </div>}
    {loaded && <>
      <div className="stock-section-title"><div><h3>{loaded.report.title}</h3><p className="member-secondary">{loaded.report.store} · {thaiDate(loaded.report.start)} ถึง {thaiDate(loaded.report.end)}</p></div>
        <div className="register-inline"><Button type="button" variant="outline" disabled={exportDisabled} onClick={() => download("excel")}><Download size={15} /> Excel</Button>
          <Button type="button" variant="outline" disabled={exportDisabled} onClick={() => download("pdf")}><Download size={15} /> PDF</Button></div>
      </div>
      {loaded.report.note && <p className="stock-help">{loaded.report.note}</p>}
      {loaded.report.limited && <p className="notice" role="status">แสดง 10,000 รายการแรก ย่อช่วงวันที่หรือเพิ่มตัวกรองเพื่อดูรายการที่เหลือ</p>}
      <Table
        headings={loaded.report.columns.map(({ label, number }, idx) => ({
          label,
          sortKey: String(idx),
          numeric: Boolean(number),
        }))}
        sortBy={loaded.sortCol !== undefined ? String(loaded.sortCol) : undefined}
        sortDir={loaded.sortDir}
        onSort={(key) => {
          const idx = Number(key);
          const nextDir: SortDir = loaded.sortCol === idx ? (loaded.sortDir === "asc" ? "desc" : "asc") : "desc";
          fetchPage({
            criteria: loaded.criteria,
            page: 1,
            pageSize: loaded.pageSize,
            sortCol: idx,
            sortDir: nextDir,
          });
        }}
        loading={operation === "load"}
        empty={!loaded.report.rows.length ? "ไม่มีข้อมูลตามเงื่อนไขที่เลือก" : undefined}
      >
        {loaded.report.rows.map((row, index) => <tr key={index}>{row.map((cell, column) =>
          <td key={column} className={loaded.report.columns[column]?.number ? "report-number" : undefined}>{cell}</td>)}</tr>)}
      </Table>
      <Pagination
        page={loaded.page}
        pageSize={loaded.pageSize}
        total={loaded.report.total ?? loaded.report.rows.length}
        totalPages={loaded.report.totalPages ?? 1}
        onPageChange={(nextPage) => {
          fetchPage({
            criteria: loaded.criteria,
            page: nextPage,
            pageSize: loaded.pageSize,
            sortCol: loaded.sortCol,
            sortDir: loaded.sortDir,
          });
        }}
        onPageSizeChange={(nextSize) => {
          fetchPage({
            criteria: loaded.criteria,
            page: 1,
            pageSize: nextSize,
            sortCol: loaded.sortCol,
            sortDir: loaded.sortDir,
          });
        }}
        disabled={busy}
      />
    </>}
  </div></section>;
}
