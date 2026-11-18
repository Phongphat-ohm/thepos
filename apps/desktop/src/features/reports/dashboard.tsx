import { useEffect, useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import type { Dashboard } from "@thepos/contracts";
import { Loading } from "@/components/loading";
import { Button } from "@/components/ui/button";
import { business, errorMessage } from "@/lib/native";
import { Table, thaiDate } from "../stock/shared";

export function StoreDashboard() {
  const [data, setData] = useState<Dashboard>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true); setError("");
    try { setData(await business<Dashboard>("dashboard")); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);

  return <section className="surface operations-dashboard" aria-label="สรุปการดำเนินงาน" aria-busy={busy}>
    <div className="stock-section-title"><div className="surface-heading"><h2>สรุปการดำเนินงาน</h2>{data && <p className="dashboard-date"><CalendarDays size={16} aria-hidden="true" />{thaiDate(data.date)}</p>}</div>
      <Button type="button" variant="outline" loading={busy && "กำลังอัปเดต"} onClick={() => void load()}><RefreshCw size={15} /> รีเฟรชยอด</Button>
    </div>
    {busy && <Loading label="กำลังโหลดภาพรวม" variant={data ? "inline" : "skeleton"} />}
    {error && <p className="form-error" role="alert">{error}</p>}
    {data?.sales && <dl className="dashboard-metrics">
      <div className="dashboard-metric-main"><dt>{data.sales.personal ? "ยอดขายสุทธิของฉัน" : "ยอดขายสุทธิวันนี้"}</dt><dd>{data.sales.net} <span>บาท</span></dd></div>
      <div><dt>บิลขาย</dt><dd>{data.sales.receipts} <span>บิล</span></dd></div><div><dt>รายการคืน</dt><dd>{data.sales.refunds} <span>รายการ</span></dd></div>
      {data.sales.profit && <div><dt>กำไรขั้นต้น</dt><dd>{data.sales.profit} <span>บาท</span></dd></div>}
      {data.payoutBalance && <div><dt>ปันผลและเฉลี่ยคืนค้างจ่าย</dt><dd>{data.payoutBalance} <span>บาท</span></dd></div>}
    </dl>}
    {data?.stock && <>
      <h3 className="dashboard-stock-title">สถานะสินค้าและคลัง</h3>
      <dl className="member-facts"><div><dt>สินค้าเหลือไม่เกิน 5 หน่วยหลัก</dt><dd>{data.stock.low} รายการ</dd></div>
        <div><dt>หมดอายุภายใน 30 วัน</dt><dd>{data.stock.expiring} ล็อต</dd></div><div><dt>หมดอายุแล้ว</dt><dd>{data.stock.expired} ล็อต</dd></div></dl>
      <Table headings={["สินค้า", "ล็อต", "หมดอายุ", "คงเหลือ"]} empty={!data.stock.lots.length ? "ไม่มีล็อตหมดอายุหรือใกล้หมดอายุ" : undefined}>
        {data.stock.lots.map((row) => <tr key={`${row.name}-${row.lot}-${row.date}`}><td>{row.name}</td><td>{row.lot}</td><td>{thaiDate(row.date)}</td><td>{row.quantity}</td></tr>)}
      </Table>
    </>}
  </section>;
}
