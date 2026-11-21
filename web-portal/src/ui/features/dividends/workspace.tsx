import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, RefreshCw } from "lucide-react";
import type { AccountingPeriod, DividendPreview, DividendRule, Page, Profile } from "@thepos/contracts";
import { Field } from "@/components/common/fields";
import { Loading } from "@/components/common/loading";
import { Pagination, Table, toggleSort, type SortDir } from "@/components/data-table/table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { confirmAction, notifyError, notifySuccess } from "@/lib/alerts";
import { thaiDate, today } from "@/lib/format";
import { business, errorMessage } from "@/lib/native";
import { AdjustmentForm, formulaLabels, PeriodForm, RuleForm } from "./forms";
import { Payouts } from "./payouts";

const statusLabel = { DRAFT: "ฉบับร่าง", CALCULATED: "จำลองแล้ว", APPROVED_LOCKED: "อนุมัติและล็อกแล้ว", CLOSED: "ปิดงวดแล้ว" };
const statusTone: Record<AccountingPeriod["status"], string> = {
  DRAFT: "is-inactive",
  CALCULATED: "is-warn",
  APPROVED_LOCKED: "is-active",
  CLOSED: "is-active",
};
const sortPeriods = (periods: AccountingPeriod[]) => [...periods].sort((a, b) => b.startDate.localeCompare(a.startDate));

export function DividendWorkspace({ profile }: { profile: Profile }) {
  const canEdit = profile.capabilities?.includes("dividend:write") ?? false;
  const canApprove = profile.capabilities?.includes("dividend:approve") ?? false;
  const canPay = profile.capabilities?.includes("payout:write") ?? false;
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [periodTotal, setPeriodTotal] = useState(0);
  const [periodTotalPages, setPeriodTotalPages] = useState(1);
  const [periodPage, setPeriodPage] = useState(1);
  const [periodSize, setPeriodSize] = useState(25);
  const [periodQInput, setPeriodQInput] = useState("");
  const [periodQ, setPeriodQ] = useState("");
  const [periodStatus, setPeriodStatus] = useState("");
  const [periodSortBy, setPeriodSortBy] = useState("startDate");
  const [periodSortDir, setPeriodSortDir] = useState<SortDir>("desc");

  const [rules, setRules] = useState<DividendRule[]>([]);
  const [allRules, setAllRules] = useState<DividendRule[]>([]);
  const [ruleTotal, setRuleTotal] = useState(0);
  const [ruleTotalPages, setRuleTotalPages] = useState(1);
  const [rulePage, setRulePage] = useState(1);
  const [ruleSize, setRuleSize] = useState(25);
  const [ruleQInput, setRuleQInput] = useState("");
  const [ruleQ, setRuleQ] = useState("");
  const [ruleSortBy, setRuleSortBy] = useState("name");
  const [ruleSortDir, setRuleSortDir] = useState<SortDir>("asc");

  const [selected, setSelected] = useState<string>();
  const [view, setView] = useState<"periods" | "rules">("periods");
  const [editing, setEditing] = useState<"period" | "rule" | "adjustment">();
  const [periodsBusy, setPeriodsBusy] = useState(true);
  const [rulesBusy, setRulesBusy] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");
  const periodSeqRef = useRef(0);
  const ruleSeqRef = useRef(0);
  const busy = periodsBusy || rulesBusy || actionBusy;
  const period = periods.find(({ id }) => id === selected);
  const locked = period?.status === "APPROVED_LOCKED" || period?.status === "CLOSED";

  useEffect(() => {
    const t = window.setTimeout(() => setPeriodQ(periodQInput), 220);
    return () => window.clearTimeout(t);
  }, [periodQInput]);

  useEffect(() => {
    const t = window.setTimeout(() => setRuleQ(ruleQInput), 220);
    return () => window.clearTimeout(t);
  }, [ruleQInput]);

  const loadPeriods = useCallback(async () => {
    const seq = ++periodSeqRef.current;
    setPeriodsBusy(true);
    setError("");
    try {
      const periodsRes = await business<Page<AccountingPeriod>>("accounting_periods", {
        query: {
          q: periodQ.trim() || undefined,
          status: periodStatus || undefined,
          page: periodPage,
          limit: periodSize,
          sortBy: periodSortBy,
          sortDir: periodSortDir,
        },
      });
      if (seq !== periodSeqRef.current) return;
      setPeriods(periodsRes.items);
      setPeriodTotal(periodsRes.total ?? periodsRes.items.length);
      setPeriodTotalPages(periodsRes.totalPages ?? 1);
    } catch (reason) {
      if (seq === periodSeqRef.current) setError(errorMessage(reason));
    } finally {
      if (seq === periodSeqRef.current) setPeriodsBusy(false);
    }
  }, [periodPage, periodSize, periodQ, periodStatus, periodSortBy, periodSortDir]);

  const loadRules = useCallback(async () => {
    const seq = ++ruleSeqRef.current;
    setRulesBusy(true);
    setError("");
    try {
      const rulesRes = await business<Page<DividendRule>>("dividend_rules", {
        query: {
          q: ruleQ.trim() || undefined,
          page: rulePage,
          limit: ruleSize,
          sortBy: ruleSortBy,
          sortDir: ruleSortDir,
        },
      });
      if (seq !== ruleSeqRef.current) return;
      setRules(rulesRes.items);
      setRuleTotal(rulesRes.total ?? rulesRes.items.length);
      setRuleTotalPages(rulesRes.totalPages ?? 1);
    } catch (reason) {
      if (seq === ruleSeqRef.current) setError(errorMessage(reason));
    } finally {
      if (seq === ruleSeqRef.current) setRulesBusy(false);
    }
  }, [rulePage, ruleSize, ruleQ, ruleSortBy, ruleSortDir]);

  const loadAllRules = useCallback(async () => {
    try {
      const allRulesRes = await business<Page<DividendRule>>("dividend_rules", { query: { limit: 100 } });
      setAllRules(allRulesRes.items);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, []);

  const load = useCallback(async () => {
    await Promise.all([loadPeriods(), loadRules(), loadAllRules()]);
  }, [loadPeriods, loadRules, loadAllRules]);

  useEffect(() => {
    void loadPeriods();
  }, [loadPeriods]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  useEffect(() => {
    void loadAllRules();
  }, [loadAllRules]);

  function savePeriod(result: AccountingPeriod) {
    setPeriods((rows) => sortPeriods([...rows.filter(({ id }) => id !== result.id), result]));
    setSelected(result.id);
    setEditing(undefined);
  }

  async function perform(route: "calculate_dividend" | "approve_dividend" | "close_accounting_period", id: string, runId?: string) {
    setActionBusy(true);
    setError("");
    try {
      savePeriod(await business<AccountingPeriod>(route, { id, input: runId ? { runId } : undefined }));
      if (route === "approve_dividend") notifySuccess("อนุมัติและล็อกงวดแล้ว");
      if (route === "close_accounting_period") notifySuccess("ปิดงวดบัญชีแล้ว");
      if (route === "calculate_dividend") notifySuccess("คำนวณผลจำลองแล้ว");
    } catch (reason) { void notifyError("ดำเนินการไม่สำเร็จ", errorMessage(reason)); }
    finally { setActionBusy(false); }
  }

  return <section className="stock-workspace" aria-label="ปันผลและเฉลี่ยคืน" aria-busy={busy}>
    {busy && <Loading label="กำลังเตรียมข้อมูลงวดบัญชี" variant={periods.length ? "panel" : "skeleton"} />}
    <div className="stock-content">
      {error && <p className="form-error" role="alert">{error}</p>}
      {period ? <>
        <div className="stock-section-title">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => { setSelected(undefined); setEditing(undefined); setError(""); }}>
            <ArrowLeft size={16} /> งวดบัญชี
          </Button>
          <Button type="button" variant="outline" disabled={busy || !!editing} onClick={() => void load()}><RefreshCw size={15} /> รีเฟรช</Button>
        </div>
        <div className="stock-section-title">
          <div><h2>{period.name}</h2><p className="member-secondary">{thaiDate(period.startDate)} ถึง {thaiDate(period.endDate)} · {statusLabel[period.status]}</p></div>
          {canEdit && !locked && !editing && <div className="register-inline">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing("period")}>แก้ไขงวด</Button>
            {canApprove && period.startDate <= today() && <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing("adjustment")}>ปรับยอดซื้อสุทธิ</Button>}
            <Button type="button" disabled={busy} onClick={() => void perform("calculate_dividend", period.id)}>
              {period.currentRunId ? "คำนวณใหม่" : "จำลองผล"}
            </Button>
          </div>}
        </div>
        <dl className="member-facts">
          <div><dt>แม่แบบสูตร</dt><dd>{period.rule.name} · รุ่น {period.rule.version}</dd></div>
          <div><dt>สูตรปันผลตามหุ้น</dt><dd>{formulaLabels[period.rule.formula]}</dd></div>
          <div><dt>อัตราปันผล</dt><dd>{period.rule.dividendRate}%</dd></div>
          <div><dt>อัตราเฉลี่ยคืน</dt><dd>{period.rule.rebateRate}%</dd></div>
          {period.lockedAt && <div><dt>อนุมัติโดย</dt><dd>{period.approver} · {thaiDate(period.lockedAt)}</dd></div>}
        </dl>
        {editing === "period" && <PeriodForm period={period} rules={allRules} saved={(result) => { savePeriod(result); notifySuccess("บันทึกงวดบัญชีแล้ว"); }} cancel={() => setEditing(undefined)} />}
        {editing === "adjustment" && <AdjustmentForm period={period} cancel={() => setEditing(undefined)} saved={() => {
          setEditing(undefined); notifySuccess("บันทึกรายการปรับยอดแล้ว"); void load();
        }} />}
        {period.currentRunId && <Preview key={period.currentRunId} period={period} busy={busy || !!editing}
          approve={canApprove && !locked && period.endDate < today() ? async (preview) => {
            if (await confirmAction({ title: "อนุมัติและล็อกงวด", text: `ยืนยันยอดรวม ${preview.total} บาท สำหรับ ${preview.payableMembers} คน ระบบจะล็อกผลของ ${period.name} และสร้างรายการค้างจ่าย`, confirmText: "อนุมัติและล็อก", danger: true })) {
              await perform("approve_dividend", period.id, preview.id);
            }
          } : undefined} />}
        {period.status === "CALCULATED" && period.endDate >= today() && <p className="stock-help">อนุมัติได้หลังวันสิ้นงวด</p>}
        {locked && <Payouts key={period.id} period={period} canPay={canPay && period.status === "APPROVED_LOCKED"} />}
        {period.status === "APPROVED_LOCKED" && canApprove && <div className="register-inline">
          <Button type="button" variant="outline" disabled={busy} onClick={async () => {
            if (await confirmAction({ title: "ปิดงวดบัญชี", text: "ปิดงวดได้เมื่อจ่ายครบทุกยอดค้างจ่าย", confirmText: "ปิดงวด" })) {
              await perform("close_accounting_period", period.id);
            }
          }}>ปิดงวดบัญชี</Button>
        </div>}
      </> : <>
        <div className="stock-section-title">
          <nav className="register-inline" aria-label="การจัดการงวดและสูตร">
            <Button type="button" variant={view === "periods" ? "default" : "outline"} aria-pressed={view === "periods"}
              onClick={() => { setView("periods"); setEditing(undefined); }}>งวดบัญชี</Button>
            <Button type="button" variant={view === "rules" ? "default" : "outline"} aria-pressed={view === "rules"}
              onClick={() => { setView("rules"); setEditing(undefined); }}>แม่แบบสูตร</Button>
          </nav>
          <div className="register-inline">
            <Button type="button" variant="outline" disabled={busy || !!editing} onClick={() => void load()}><RefreshCw size={15} /> รีเฟรช</Button>
            {canEdit && !editing && (view === "rules" || allRules.length > 0) && <Button type="button" disabled={busy}
              onClick={() => setEditing(view === "rules" ? "rule" : "period")}><Plus size={16} />{view === "rules" ? "สร้างแม่แบบ" : "สร้างงวดบัญชี"}</Button>}
          </div>
        </div>
        {editing === "period" && <PeriodForm rules={allRules} saved={(result) => { savePeriod(result); notifySuccess("สร้างงวดบัญชีแล้ว"); }} cancel={() => setEditing(undefined)} />}
        {editing === "rule" && <RuleForm cancel={() => setEditing(undefined)} saved={(rule) => {
          setRules((rows) => [rule, ...rows.filter(({ id }) => id !== rule.id)]);
          setAllRules((rows) => [rule, ...rows.filter(({ id }) => id !== rule.id)]);
          setEditing(undefined);
          notifySuccess("บันทึกแม่แบบแล้ว");
        }} />}
        {view === "periods" ? <>
          {canEdit && !busy && !allRules.length && <Button type="button" variant="outline" onClick={() => { setView("rules"); setEditing("rule"); }}>สร้างแม่แบบสูตรเพื่อเริ่มงวดแรก</Button>}
          <div className="stock-toolbar">
            <Field label="ค้นหางวดบัญชี" value={periodQInput} onChange={(e) => { setPeriodQInput(e.target.value); setPeriodPage(1); }} placeholder="ชื่องวดบัญชี" />
            <Select label="สถานะ" value={periodStatus} onChange={(e) => { setPeriodStatus(e.target.value); setPeriodPage(1); }}>
              <option value="">ทั้งหมด</option>
              <option value="DRAFT">ฉบับร่าง</option>
              <option value="CALCULATED">จำลองแล้ว</option>
              <option value="APPROVED_LOCKED">อนุมัติและล็อกแล้ว</option>
              <option value="CLOSED">ปิดงวดแล้ว</option>
            </Select>
          </div>
          <Table
            headings={[
              { label: "ชื่องวด", sortKey: "name" },
              { label: "ช่วงวันที่", sortKey: "startDate" },
              "แม่แบบ",
              { label: "สถานะ", sortKey: "status" },
              "รายละเอียด",
            ]}
            sortBy={periodSortBy}
            sortDir={periodSortDir}
            onSort={(key) => {
              const next = toggleSort(periodSortBy, periodSortDir, key, "desc");
              setPeriodSortBy(next.sortBy);
              setPeriodSortDir(next.sortDir);
              setPeriodPage(1);
            }}
            empty={!periods.length ? "ยังไม่มีงวดบัญชี" : undefined}
          >
            {periods.map((item) => <tr key={item.id}>
              <td><strong>{item.name}</strong></td><td>{thaiDate(item.startDate)} ถึง {thaiDate(item.endDate)}</td>
              <td>{item.rule.name} · รุ่น {item.rule.version}</td><td><span className={`status-badge ${statusTone[item.status]}`}>{statusLabel[item.status]}</span></td>
              <td><Button type="button" variant="outline" disabled={busy} onClick={() => { setSelected(item.id); setEditing(undefined); setError(""); }}>เปิดงวด</Button></td>
            </tr>)}
          </Table>
          <Pagination
            page={periodPage}
            pageSize={periodSize}
            total={periodTotal}
            totalPages={periodTotalPages}
            onPageChange={setPeriodPage}
            onPageSizeChange={(next) => { setPeriodSize(next); setPeriodPage(1); }}
            disabled={busy}
          />
        </> : <>
          <div className="stock-toolbar">
            <Field label="ค้นหาแม่แบบสูตร" value={ruleQInput} onChange={(e) => { setRuleQInput(e.target.value); setRulePage(1); }} placeholder="ชื่อแม่แบบ" />
          </div>
          <Table
            headings={[
              { label: "ชื่อแม่แบบ", sortKey: "name" },
              { label: "รุ่น", sortKey: "version", numeric: true },
              "สูตรตามหุ้น",
              { label: "อัตราปันผล (%)", sortKey: "dividendRate", numeric: true },
              { label: "อัตราเฉลี่ยคืน (%)", sortKey: "rebateRate", numeric: true },
            ]}
            sortBy={ruleSortBy}
            sortDir={ruleSortDir}
            onSort={(key) => {
              const next = toggleSort(ruleSortBy, ruleSortDir, key, "desc");
              setRuleSortBy(next.sortBy);
              setRuleSortDir(next.sortDir);
              setRulePage(1);
            }}
            empty={!rules.length ? "ยังไม่มีแม่แบบสูตร" : undefined}
          >
            {rules.map((rule) => <tr key={rule.id}><td><strong>{rule.name}</strong></td><td className="report-number">{rule.version}</td>
              <td>{formulaLabels[rule.formula]}</td><td className="report-number">{rule.dividendRate}</td><td className="report-number">{rule.rebateRate}</td></tr>)}
          </Table>
          <Pagination
            page={rulePage}
            pageSize={ruleSize}
            total={ruleTotal}
            totalPages={ruleTotalPages}
            onPageChange={setRulePage}
            onPageSizeChange={(next) => { setRuleSize(next); setRulePage(1); }}
            disabled={busy}
          />
        </>}
      </>}
    </div>
  </section>;
}

function Preview({ period, busy, approve }: {
  period: AccountingPeriod; busy: boolean; approve?: (preview: DividendPreview) => Promise<void>;
}) {
  const [preview, setPreview] = useState<DividendPreview>();
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState("number");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const seqRef = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(qInput), 220);
    return () => window.clearTimeout(t);
  }, [qInput]);

  async function load(nextQ = q, nextPage = pageNum, nextSize = pageSize, nextSortBy = sortBy, nextSortDir = sortDir) {
    const seq = ++seqRef.current;
    setLoading(true);
    setError("");
    try {
      const result = await business<DividendPreview>("dividend_preview", {
        id: period.id,
        query: {
          q: nextQ.trim() || undefined,
          page: nextPage,
          limit: nextSize,
          sortBy: nextSortBy,
          sortDir: nextSortDir,
        },
      });
      if (seq !== seqRef.current) return;
      if (result.id !== period.currentRunId) {
        setPreview(undefined);
        setError("ผลจำลองเปลี่ยนแล้ว กดรีเฟรชงวดเพื่อเปิดผลล่าสุด");
      } else setPreview(result);
    } catch (reason) {
      if (seq === seqRef.current) setError(errorMessage(reason));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }
  useEffect(() => { void load(q, pageNum, pageSize, sortBy, sortDir); }, [q, pageNum, pageSize, sortBy, sortDir]);

  return <>
    <div className="stock-section-title">
      <h3>{period.status === "CALCULATED" ? "ผลจำลองรายสมาชิก" : "ผลที่อนุมัติแล้ว"}</h3>
      {approve && preview && <Button type="button" disabled={busy || loading} onClick={() => void approve(preview)}>อนุมัติและล็อกงวด</Button>}
    </div>
    {loading && <Loading label="กำลังโหลดผลคำนวณ" variant={preview ? "inline" : "skeleton"} />}
    {error && <p className="form-error" role="alert">{error} <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}>ลองอีกครั้ง</Button></p>}
    {preview && <>
      <dl className="member-facts">
        <div><dt>ยอดปันผลตามหุ้น</dt><dd>{preview.dividendTotal} บาท</dd></div>
        <div><dt>ยอดเฉลี่ยคืนตามยอดซื้อ</dt><dd>{preview.rebateTotal} บาท</dd></div>
        <div><dt>ยอดจ่ายรวม</dt><dd>{preview.total} บาท</dd></div>
        <div><dt>สมาชิกที่มียอดจ่าย</dt><dd>{preview.payableMembers} คน</dd></div>
      </dl>
      {preview.negativePurchases > 0 && <p className="notice" role="status">สมาชิก {preview.negativePurchases} คนมียอดซื้อสุทธิติดลบ ระบบคำนวณเฉลี่ยคืนให้เป็น 0 บาท</p>}
      {preview.payableMembers === 0 && <p className="notice" role="status">งวดนี้ไม่มีสมาชิกที่มียอดจ่าย</p>}
      <div className="stock-toolbar">
        <Field label="ค้นหาสมาชิก" value={qInput} onChange={(e) => { setQInput(e.target.value); setPageNum(1); }} placeholder="เลขสมาชิก หรือชื่อ" />
      </div>
      <Table
        headings={[
          { label: "สมาชิก", sortKey: "number" },
          { label: "ฐานหุ้น", sortKey: "shareBasis", numeric: true },
          { label: "ยอดซื้อสุทธิ", sortKey: "eligiblePurchases", numeric: true },
          { label: "ปันผลตามหุ้น", sortKey: "dividendAmount", numeric: true },
          { label: "เฉลี่ยคืน", sortKey: "rebateAmount", numeric: true },
          { label: "ยอดจ่ายรวม", sortKey: "total", numeric: true },
        ]}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={(key) => {
          const next = toggleSort(sortBy, sortDir, key, "desc");
          setSortBy(next.sortBy);
          setSortDir(next.sortDir);
          setPageNum(1);
        }}
        empty={!preview.items.length ? "ไม่มีรายการหุ้นหรือยอดซื้อในงวด" : undefined}
      >
        {preview.items.map((row) => <tr key={row.memberId}>
          <td><strong>{row.number}</strong><small>{row.name}</small></td><td className="report-number">{row.shareBasis}</td>
          <td className="report-number">{row.eligiblePurchases}{row.negativePurchases && <small>ยอดซื้อติดลบ</small>}</td>
          <td className="report-number">{row.dividendAmount}</td><td className="report-number">{row.rebateAmount}</td>
          <td className="report-number"><strong>{row.total}</strong></td>
        </tr>)}
      </Table>
      <Pagination
        page={preview.page ?? pageNum}
        pageSize={preview.pageSize ?? pageSize}
        total={preview.totalCount ?? preview.items.length}
        totalPages={preview.totalPages ?? 1}
        onPageChange={setPageNum}
        onPageSizeChange={(next) => { setPageSize(next); setPageNum(1); }}
        disabled={loading}
      />
    </>}
  </>;
}
