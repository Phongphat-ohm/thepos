import { useEffect, useRef, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { auditEventLabels, type AuditLogEntry } from "@thepos/contracts";
import { Field } from "@/components/common/fields";
import { Pagination, Table, toggleSort, type Page, type SortDir } from "@/components/data-table/table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { business, errorMessage } from "@/lib/native";

export function AuditLogsSection() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [event, setEvent] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const seqRef = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(qInput), 220);
    return () => window.clearTimeout(t);
  }, [qInput]);

  async function load(next = { q, event, start, end, page, pageSize, sortBy, sortDir }) {
    const seq = ++seqRef.current;
    setLoading(true);
    setError("");
    try {
      const res = await business<Page<AuditLogEntry>>("audit_logs", {
        query: {
          q: next.q.trim() || undefined,
          event: next.event || undefined,
          start: next.start || undefined,
          end: next.end || undefined,
          page: next.page,
          limit: next.pageSize,
          sortBy: next.sortBy,
          sortDir: next.sortDir,
        },
      });
      if (seq !== seqRef.current) return;
      setLogs(res.items);
      setTotal(res.total ?? res.items.length);
      setTotalPages(res.totalPages ?? 1);
    } catch (reason) {
      if (seq === seqRef.current) setError(errorMessage(reason));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load({ q, event, start, end, page, pageSize, sortBy, sortDir });
  }, [q, event, start, end, page, pageSize, sortBy, sortDir]);

  function formatDateTime(value: string) {
    return new Intl.DateTimeFormat("th-TH", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "Asia/Bangkok",
    }).format(new Date(value));
  }

  return (
    <div className="stock-content">
      <div className="stock-section-title">
        <h2 className="register-inline"><ShieldCheck size={19} /> บันทึกตรวจสอบ (Audit Log)</h2>
        <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}>
          <RefreshCw size={15} /> รีเฟรช
        </Button>
      </div>
      <div className="stock-toolbar">
        <Field label="ค้นหา" value={qInput} onChange={(e) => { setQInput(e.target.value); setPage(1); }} placeholder="เหตุการณ์ ผู้ใช้ หรือรายละเอียด" />
        <Select label="ประเภทเหตุการณ์" value={event} onChange={(e) => { setEvent(e.target.value); setPage(1); }}>
          <option value="">ทั้งหมด</option>
          {Object.entries(auditEventLabels).map(([key, label]) => (
            <option key={key} value={key}>{label} ({key})</option>
          ))}
        </Select>
        <Field label="ตั้งแต่วันที่" type="date" value={start} onChange={(e) => { setStart(e.target.value); setPage(1); }} />
        <Field label="ถึงวันที่" type="date" value={end} onChange={(e) => { setEnd(e.target.value); setPage(1); }} />
      </div>
      {error && (
        <div className="register-inline">
          <p role="alert" className="form-error">{error}</p>
          <Button variant="outline" onClick={() => void load()}>ลองโหลดอีกครั้ง</Button>
        </div>
      )}
      <Table
        headings={[
          { label: "วัน-เวลา", sortKey: "createdAt" },
          { label: "เหตุการณ์", sortKey: "event" },
          "ผู้ดำเนินการ",
          "เครื่อง POS",
          "รายละเอียด",
        ]}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={(key) => {
          const next = toggleSort(sortBy, sortDir, key, "desc");
          setSortBy(next.sortBy);
          setSortDir(next.sortDir);
          setPage(1);
        }}
        loading={loading && !logs.length}
        empty={!logs.length ? "ไม่พบบันทึกตรวจสอบตามเงื่อนไขที่เลือก" : undefined}
      >
        {logs.map((entry) => (
          <tr key={entry.id}>
            <td>{formatDateTime(entry.createdAt)}</td>
            <td>
              <strong>{auditEventLabels[entry.event] ?? entry.event}</strong>
              {auditEventLabels[entry.event] && <small>{entry.event}</small>}
            </td>
            <td>{entry.userName ? `${entry.userName} (${entry.username})` : entry.username ?? "ระบบ"}</td>
            <td>{entry.deviceName ?? "-"}</td>
            <td><div className="audit-meta-cell" title={entry.reason ?? ""}>{entry.reason ?? "-"}</div></td>
          </tr>
        ))}
      </Table>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        totalPages={totalPages}
        onPageChange={setPage}
        onPageSizeChange={(next) => { setPageSize(next); setPage(1); }}
        disabled={loading}
      />
    </div>
  );
}
