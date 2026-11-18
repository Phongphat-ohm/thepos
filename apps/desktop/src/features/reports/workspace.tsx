import { useState, type FormEvent } from "react";
import { Download, Sheet } from "lucide-react";
import { reportQuery, type Profile, type Report, type ReportKind, type ReportQuery } from "@thepos/contracts";
import { Field } from "@/components/fields";
import { Loading } from "@/components/loading";
import { Button } from "@/components/ui/button";
import { business, errorMessage } from "@/lib/native";
import { notifyError, notifySuccess } from "@/lib/alerts";
import { Pagination, Select, Table, thaiDate, type SortDir } from "../stock/shared";
import { today } from "../members/share-form";
import { hasReportPermission, reportOptions } from "./options";

export function ReportsWorkspace({ profile }: { profile: Profile }) {
  const allowed = reportOptions.filter(({ permission }) => hasReportPermission(profile, permission));
  const [kind, setKind] = useState<ReportKind>(allowed[0]?.kind ?? "daily");
  const [criteria, setCriteria] = useState<ReportQuery>();
  const [report, setReport] = useState<Report>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortCol, setSortCol] = useState<number>();
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [operation, setOperation] = useState<"load" | "excel" | "pdf">();
  const busy = !!operation;
  const [error, setError] = useState("");
  const day = today();

  async function run(op: NonNullable<typeof operation>, action: () => Promise<void>) {
    if (busy) return;
    setOperation(op); setError("");
    try { await action(); } catch (reason) {
      if (op === "load") setError(errorMessage(reason));
      else void notifyError("ส่งออกรายงานไม่สำเร็จ", "ลองส่งออกอีกครั้ง หรือลดช่วงวันที่ของรายงาน");
    } finally { setOperation(undefined); }
  }

  function fetchPage(
    nextCriteria: ReportQuery,
    nextPage: number,
    nextPageSize: number,
    nextSortCol: number | undefined,
    nextSortDir: SortDir,
  ) {
    void run("load", async () => {
      const res = await business<Report>("reports", {
        query: {
          ...nextCriteria,
          page: nextPage,
          limit: nextPageSize,
          sortCol: nextSortCol,
          sortDir: nextSortCol !== undefined ? nextSortDir : undefined,
        },
      });
      setReport(res);
    });
  }

  function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = reportQuery.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) { setError("เลือกช่วงวันที่ไม่เกิน 366 วันและตรวจสอบตัวกรอง"); return; }
    setCriteria(parsed.data);
    setPage(1);
    setSortCol(undefined);
    setSortDir("desc");
    setReport(undefined);
    fetchPage(parsed.data, 1, pageSize, undefined, "desc");
  }

  function download(format: "excel" | "pdf") {
    if (!criteria) return;
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

  return <section className="stock-workspace" aria-label="รายงาน" aria-busy={busy}><div className="stock-content">
    <h2>เรียกดูรายงาน</h2>
    <form className="stock-editor" onSubmit={load}>
      <div className="stock-grid">
        <Select label="ประเภทรายงาน" name="kind" value={kind} onChange={(event) => { setKind(event.target.value as ReportKind); setReport(undefined); setCriteria(undefined); }} disabled={busy}>
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
    {error && <p className="form-error" role="alert">{error}</p>}
    {!report && !operation && !error && <div className="table-empty">
      <Sheet size={25} aria-hidden="true" />
      <p>เลือกช่วงวันที่แล้วกดแสดงรายงาน</p>
    </div>}
    {report && <>
      <div className="stock-section-title"><div><h3>{report.title}</h3><p className="member-secondary">{report.store} · {thaiDate(report.start)} ถึง {thaiDate(report.end)}</p></div>
        <div className="register-inline"><Button type="button" variant="outline" disabled={busy} onClick={() => download("excel")}><Download size={15} /> Excel</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => download("pdf")}><Download size={15} /> PDF</Button></div>
      </div>
      {report.note && <p className="stock-help">{report.note}</p>}
      {report.limited && <p className="notice" role="status">แสดง 10,000 รายการแรก ย่อช่วงวันที่หรือเพิ่มตัวกรองเพื่อดูรายการที่เหลือ</p>}
      <Table
        headings={report.columns.map(({ label, number }, idx) => ({
          label,
          sortKey: String(idx),
          numeric: Boolean(number),
        }))}
        sortBy={sortCol !== undefined ? String(sortCol) : undefined}
        sortDir={sortDir}
        onSort={(key) => {
          if (!criteria) return;
          const idx = Number(key);
          const nextDir: SortDir = sortCol === idx ? (sortDir === "asc" ? "desc" : "asc") : "desc";
          setSortCol(idx);
          setSortDir(nextDir);
          setPage(1);
          fetchPage(criteria, 1, pageSize, idx, nextDir);
        }}
        loading={operation === "load"}
        empty={!report.rows.length ? "ไม่มีข้อมูลตามเงื่อนไขที่เลือก" : undefined}
      >
        {report.rows.map((row, index) => <tr key={index}>{row.map((cell, column) =>
          <td key={column} className={report.columns[column]?.number ? "report-number" : undefined}>{cell}</td>)}</tr>)}
      </Table>
      <Pagination
        page={report.page ?? page}
        pageSize={report.pageSize ?? pageSize}
        total={report.total ?? report.rows.length}
        totalPages={report.totalPages ?? 1}
        onPageChange={(nextPage) => {
          if (!criteria) return;
          setPage(nextPage);
          fetchPage(criteria, nextPage, pageSize, sortCol, sortDir);
        }}
        onPageSizeChange={(nextSize) => {
          if (!criteria) return;
          setPageSize(nextSize);
          setPage(1);
          fetchPage(criteria, 1, nextSize, sortCol, sortDir);
        }}
        disabled={busy}
      />
    </>}
  </div></section>;
}
