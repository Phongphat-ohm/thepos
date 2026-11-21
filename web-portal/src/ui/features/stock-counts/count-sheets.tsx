import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Field } from "@/components/common/fields";
import { Loading } from "@/components/common/loading";
import { Modal } from "@/components/common/modal";
import { Pagination, Table, toggleSort, type Page, type Run, type SortDir } from "@/components/data-table/table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { confirmAction, notifyError } from "@/lib/alerts";
import { thaiDate } from "@/lib/format";
import { business, errorMessage } from "@/lib/native";

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

  const load = useCallback(
    async (
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
    },
    [q, status, pageNum, pageSize, sortBy, sortDir],
  );

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
      setPage(
        (current) =>
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
        <Table
          headings={[
            "สินค้า",
            "ล็อต",
            { label: "ตามระบบ", numeric: true },
            { label: "นับได้", numeric: true },
            { label: "ผลต่าง", numeric: true },
            "หน่วย",
          ]}
        >
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
      {page && (
        <Pagination
          page={page.page ?? pageNum}
          pageSize={page.pageSize ?? pageSize}
          total={page.total ?? page.items.length}
          totalPages={page.totalPages ?? 1}
          onPageChange={setPageNum}
          onPageSizeChange={(next) => { setPageSize(next); setPageNum(1); }}
          disabled={busy || loading}
        />
      )}
      {detail}
    </div>
  );
}
