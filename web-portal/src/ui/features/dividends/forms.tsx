import { useState, type FormEvent } from "react";
import {
  accountingPeriodInput, dividendFormula, dividendRuleInput, purchaseAdjustmentInput,
  type AccountingPeriod, type DividendRule, type MemberProfile, type Page,
} from "@thepos/contracts";
import { Autocomplete } from "@/components/common/autocomplete";
import { Field } from "@/components/common/fields";
import { Modal } from "@/components/common/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { confirmAction, notifyError } from "@/lib/alerts";
import { business, errorMessage } from "@/lib/native";

export const formulaLabels = {
  CLOSING_BALANCE: "ยอดหุ้นวันสิ้นงวด", MONTHLY_AVERAGE: "เฉลี่ยยอดหุ้นสิ้นเดือน 12 เดือน",
} satisfies Record<(typeof dividendFormula.options)[number], string>;

export function RuleForm({ saved, cancel }: { saved: (rule: DividendRule) => void; cancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = dividendRuleInput.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) { setError("กรอกชื่อ สูตร และอัตราตั้งแต่ 0 ถึง 100% ใช้ทศนิยมได้ไม่เกิน 4 ตำแหน่ง"); return; }
    setBusy(true);
    setError("");
    try { saved(await business<DividendRule>("create_dividend_rule", { input: parsed.data })); }
    catch (reason) { void notifyError("บันทึกแม่แบบไม่สำเร็จ", errorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <Modal title="สร้างแม่แบบสูตร" close={cancel} busy={busy && "กำลังบันทึกแม่แบบ"}>
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
    <div className="field-row">
      <Field autoFocus label="ชื่อแม่แบบ" name="name" required maxLength={120} hint="ใช้ชื่อเดิมเมื่อต้องการบันทึกรุ่นใหม่ของแม่แบบเดิม" />
      <Select label="สูตรปันผลตามหุ้น" name="formula">
        {dividendFormula.options.map((value) => <option key={value} value={value}>{formulaLabels[value]}</option>)}
      </Select>
      <Field label="อัตราปันผล (%)" name="dividendRate" required inputMode="decimal" maxLength={8} />
      <Field label="อัตราเฉลี่ยคืน (%)" name="rebateRate" required inputMode="decimal" maxLength={8} />
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions">
      <Button type="button" variant="ghost" disabled={busy} onClick={cancel}>ยกเลิก</Button>
      <Button type="submit">บันทึกแม่แบบ</Button>
    </div>
  </form></Modal>;
}

export function PeriodForm({ period, rules, saved, cancel }: {
  period?: AccountingPeriod; rules: DividendRule[]; saved: (period: AccountingPeriod) => void; cancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rule, setRule] = useState<DividendRule | null>(period?.rule ?? null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = accountingPeriodInput.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) { setError("ตรวจสอบชื่องวด ช่วงวันที่ และแม่แบบสูตร"); return; }
    setBusy(true);
    setError("");
    try {
      saved(await business<AccountingPeriod>(period ? "update_accounting_period" : "create_accounting_period", { id: period?.id, input: parsed.data }));
    } catch (reason) { void notifyError("บันทึกงวดไม่สำเร็จ", errorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <Modal title={period ? "แก้ไขงวดบัญชี" : "สร้างงวดบัญชี"} close={cancel} busy={busy && "กำลังบันทึกงวดบัญชี"}>
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
    <div className="field-row">
      <Field autoFocus label="ชื่องวดบัญชี" name="name" required maxLength={120} defaultValue={period?.name} />
      <Autocomplete label="แม่แบบสูตรและรุ่น" name="ruleId" placeholder="พิมพ์ชื่อแม่แบบหรือรุ่น" required disabled={busy}
        options={rules} value={rule} onChange={setRule} text={({ name, version }) => `${name} · รุ่น ${version}`} />
      <Field label="วันเริ่มงวด" name="startDate" type="date" required defaultValue={period?.startDate} />
      <Field label="วันสิ้นงวด" name="endDate" type="date" required defaultValue={period?.endDate} />
    </div>
    <p className="stock-help">สูตรเฉลี่ยยอดหุ้นใช้ช่วง 12 เดือนเต็ม เช่น 1 มกราคม ถึง 31 ธันวาคม</p>
    {period?.currentRunId && <p className="stock-help">หลังแก้ไขงวด ต้องคำนวณผลจำลองใหม่</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions">
      <Button type="button" variant="ghost" disabled={busy} onClick={cancel}>ยกเลิก</Button>
      <Button type="submit">บันทึกงวดบัญชี</Button>
    </div>
  </form></Modal>;
}

type AdjustmentMember = Pick<MemberProfile, "id" | "name" | "number">;
const searchMembers = (q: string, after?: string) => business<Page<AdjustmentMember>>("members", { query: { q, after } });
export function AdjustmentForm({ period, saved, cancel }: { period: AccountingPeriod; saved: () => void; cancel: () => void }) {
  const [member, setMember] = useState<AdjustmentMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [request, setRequest] = useState<{ body: string; key: string }>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = purchaseAdjustmentInput.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) { setError("เลือกสมาชิกและระบุจำนวนเงินกับเหตุผล"); return; }
    if (!member || !await confirmAction({ title: "บันทึกปรับยอดซื้อสุทธิ", text: `${member.name} · ${parsed.data.direction === "INCREASE" ? "เพิ่ม" : "ลด"} ${parsed.data.amount} บาท`, confirmText: "บันทึกรายการ" })) return;
    const body = JSON.stringify(parsed.data);
    const key = request?.body === body ? request.key : crypto.randomUUID();
    setRequest({ body, key });
    setBusy(true);
    setError("");
    try { await business("adjust_purchases", { id: period.id, key, input: parsed.data }); saved(); }
    catch (reason) { void notifyError("ปรับยอดซื้อไม่สำเร็จ", errorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <Modal title="ปรับยอดซื้อสุทธิ" close={cancel} busy={busy && "กำลังบันทึกรายการปรับยอด"}>
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      <Autocomplete name="memberId" label="สมาชิก" placeholder="พิมพ์เลขสมาชิกหรือชื่อ" required disabled={busy}
        value={member} onChange={setMember} text={({ number, name }) => `${number} · ${name}`} load={searchMembers} />
      <div className="field-row">
        <Select label="เปลี่ยนยอดซื้อสุทธิ" name="direction"><option value="INCREASE">เพิ่ม</option><option value="DECREASE">ลด</option></Select>
        <Field name="amount" label="จำนวนเงิน (บาท)" inputMode="decimal" required maxLength={13} />
      </div>
      <Field name="reason" label="เหตุผลและเลขอ้างอิง" required maxLength={300} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <Button type="button" variant="ghost" disabled={busy} onClick={cancel}>ยกเลิก</Button>
        <Button type="submit" disabled={busy}>ตรวจสอบรายการ</Button>
      </div>
    </form>
  </Modal>;
}
