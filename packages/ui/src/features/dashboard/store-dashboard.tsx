import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Clock, RefreshCw } from "lucide-react";
import type { Dashboard } from "@thepos/contracts";
import { Loading } from "@/components/common/loading";
import { Table } from "@/components/data-table/table";
import { Button } from "@/components/ui/button";
import { thaiDate } from "@/lib/format";
import { business, errorCode, errorMessage } from "@/lib/native";

const updatedTimeFormatter = new Intl.DateTimeFormat("th-TH", {
  timeStyle: "medium",
  timeZone: "Asia/Bangkok",
  numberingSystem: "latn",
});

function formatUpdatedAt(value: Date) {
  return `${updatedTimeFormatter.format(value)} น.`;
}

function isAuthError(reason: unknown) {
  const code = errorCode(reason);
  return code === "SESSION_REQUIRED" || code === "SESSION_LOCKED" || code === "FORBIDDEN";
}

export type DashboardSnapshot = {
  data?: Dashboard;
  updatedAt: Date | null;
};

export function nextDashboardAfterError(current: DashboardSnapshot, reason: unknown): DashboardSnapshot {
  return isAuthError(reason) ? { data: undefined, updatedAt: null } : current;
}

export function StoreDashboard() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>({ data: undefined, updatedAt: null });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setBusy(true);
    setError("");
    try {
      const next = await business<Dashboard>("dashboard");
      if (seq !== seqRef.current) return;
      setSnapshot({ data: next, updatedAt: new Date() });
    } catch (reason) {
      if (seq !== seqRef.current) return;
      setError(errorMessage(reason));
      setSnapshot((current) => nextDashboardAfterError(current, reason));
    } finally {
      if (seq === seqRef.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      seqRef.current++;
    };
  }, [load]);

  const { data, updatedAt } = snapshot;
  const stale = !!data && !!error;
  const updatedLabel = updatedAt ? formatUpdatedAt(updatedAt) : null;

  return <section className="surface operations-dashboard" aria-label="สรุปการดำเนินงาน" aria-busy={busy}>
    <div className="stock-section-title">
      <div className="surface-heading">
        <h2>สรุปการดำเนินงาน</h2>
        {data && (
          <p className="dashboard-date">
            <CalendarDays size={16} aria-hidden="true" />
            <span>{thaiDate(data.date)}</span>
            {updatedLabel && (
              <span className="dashboard-updated">
                <Clock size={14} aria-hidden="true" />
                อัปเดตล่าสุด {updatedLabel}
              </span>
            )}
            {stale && <span className="dashboard-stale-badge">ข้อมูลเดิม</span>}
          </p>
        )}
      </div>
      <Button type="button" variant="outline" loading={busy && "กำลังอัปเดต"} onClick={() => void load()}><RefreshCw size={15} /> รีเฟรชยอด</Button>
    </div>
    {busy && <Loading label="กำลังโหลดภาพรวม" variant={data ? "inline" : "skeleton"} />}
    {error && <p className="form-error" role="alert">{error}</p>}
    {stale && (
      <p className="notice" role="status">
        รีเฟรชล่าสุดไม่สำเร็จ กำลังแสดงยอดเดิมที่อัปเดตเมื่อ {updatedLabel ?? "ก่อนหน้า"}
      </p>
    )}
    {data?.sales && <dl className={`dashboard-metrics${stale ? " is-stale" : ""}`} data-stale={stale ? "true" : undefined}>
      <div className="dashboard-metric-main"><dt>{data.sales.personal ? "ยอดขายสุทธิของฉัน" : "ยอดขายสุทธิวันนี้"}</dt><dd>{data.sales.net} <span>บาท</span></dd></div>
      <div><dt>บิลขาย</dt><dd>{data.sales.receipts} <span>บิล</span></dd></div><div><dt>รายการคืน</dt><dd>{data.sales.refunds} <span>รายการ</span></dd></div>
      {data.sales.profit && <div><dt>กำไรขั้นต้น</dt><dd>{data.sales.profit} <span>บาท</span></dd></div>}
      {data.payoutBalance && <div><dt>ปันผลและเฉลี่ยคืนค้างจ่าย</dt><dd>{data.payoutBalance} <span>บาท</span></dd></div>}
    </dl>}
    {data?.stock && <>
      <h3 className="dashboard-stock-title">สถานะสินค้าและคลัง</h3>
      <dl className={`member-facts${stale ? " is-stale" : ""}`}><div><dt>สินค้าเหลือไม่เกิน 5 หน่วยหลัก</dt><dd>{data.stock.low} รายการ</dd></div>
        <div><dt>หมดอายุภายใน 30 วัน</dt><dd>{data.stock.expiring} ล็อต</dd></div><div><dt>หมดอายุแล้ว</dt><dd>{data.stock.expired} ล็อต</dd></div></dl>
      <Table headings={["สินค้า", "ล็อต", "หมดอายุ", "คงเหลือ"]} empty={!data.stock.lots.length ? "ไม่มีล็อตหมดอายุหรือใกล้หมดอายุ" : undefined}>
        {data.stock.lots.map((row) => <tr key={`${row.name}-${row.lot}-${row.date}`}><td>{row.name}</td><td>{row.lot}</td><td>{thaiDate(row.date)}</td><td>{row.quantity}</td></tr>)}
      </Table>
    </>}
  </section>;
}
