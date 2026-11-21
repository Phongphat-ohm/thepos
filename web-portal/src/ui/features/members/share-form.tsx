import { useCallback, useState, type FormEvent } from "react";
import { shareInput, type MemberProfile, type MemberShares, type Page, type ShareInput } from "@thepos/contracts";
import { Autocomplete } from "@/components/common/autocomplete";
import { Field } from "@/components/common/fields";
import { Modal } from "@/components/common/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { confirmAction, notifyError } from "@/lib/alerts";
import { thaiDate, today } from "@/lib/format";
import { business, errorCode, errorMessage } from "@/lib/native";

export const shareLabels = {
  INITIAL: "เปิดบัญชีหุ้น", PURCHASE_ADD: "ซื้อหุ้นเพิ่ม", WITHDRAWAL: "ถอนหุ้น",
  TRANSFER: "โอนหุ้น", CORRECTION: "ปรับปรุงยอดหุ้น",
} satisfies Record<ShareInput["type"], string>;

type Target = Pick<MemberProfile, "id" | "number" | "name" | "isActive">;

export function ShareForm({ member, shares, close, saved }: {
  member: MemberProfile; shares: MemberShares; close: () => void; saved: () => void;
}) {
  const [type, setType] = useState<ShareInput["type"]>(shares.account ? (member.isActive ? "PURCHASE_ADD" : "WITHDRAWAL") : "INITIAL");
  const [recipient, setRecipient] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ input: ShareInput; key: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const minimum = shares.items[0]?.effectiveDate ?? member.joinedOn ?? undefined;

  const searchRecipients = useCallback((q: string, after?: string) =>
    business<Page<Target>>("members", { query: { q, after, activeOnly: "true", excludeId: member.id } }), [member.id]);

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = shareInput.safeParse({
      type, quantity: Number(data.get("quantity")), effectiveDate: data.get("effectiveDate"), reason: data.get("reason"),
      ...(type === "INITIAL" && { unitValue: data.get("unitValue") }),
      ...(type === "CORRECTION" && { direction: data.get("direction") }),
      ...(type === "TRANSFER" && { toMemberId: recipient?.id }),
    });
    if (!parsed.success) { setError("ตรวจสอบจำนวนหุ้น วันที่ เหตุผล และข้อมูลที่จำเป็นให้ครบ"); return; }
    setError("");
    setPending({ input: parsed.data, key: crypto.randomUUID() });
  }

  async function submit() {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      await business("post_shares", { id: member.id, ...pending });
      saved();
    } catch (reason) {
      const code = errorCode(reason);
      const mayHavePosted = code === "UNAVAILABLE" || code === "NETWORK_ERROR" || !code;
      setUncertain(mayHavePosted);
      if (mayHavePosted) setError("ยังยืนยันผลไม่ได้ กดส่งรายการเดิมอีกครั้งเพื่อตรวจสอบโดยไม่บันทึกซ้ำ");
      else void notifyError("บันทึกรายการหุ้นไม่สำเร็จ", errorMessage(reason));
    } finally { setBusy(false); }
  }

  const input = pending?.input;
  const cancel = async () => {
    if (busy) return;
    if (uncertain) {
      const ok = await confirmAction({
        title: "ปิดหน้าต่างรายการหุ้น?",
        text: "ระบบยังไม่ยืนยันผลการส่งคำขอก่อนหน้า หากปิดหน้าต่างควรตรวจสอบประวัติบัญชีหุ้นก่อนส่งรายการใหม่",
        confirmText: "ปิดหน้าต่าง",
        danger: true,
      });
      if (!ok) return;
    }
    close();
  };
  return <Modal title={`${shareLabels[type]} · ${member.number}`} close={() => void cancel()} busy={busy && "กำลังบันทึกรายการหุ้น"}>
    <form hidden={!!pending} className={pending ? "" : "form-stack"} onSubmit={review}>
      {shares.account && <Select label="ประเภทรายการ" value={type} onChange={(event) => setType(event.target.value as ShareInput["type"])}>
        {member.isActive && <option value="PURCHASE_ADD">{shareLabels.PURCHASE_ADD}</option>}
        <option value="WITHDRAWAL">{shareLabels.WITHDRAWAL}</option>
        <option value="TRANSFER">{shareLabels.TRANSFER}</option>
        <option value="CORRECTION">{shareLabels.CORRECTION}</option>
      </Select>}
      {type === "TRANSFER" && <Autocomplete label="สมาชิกผู้รับโอน" placeholder="พิมพ์เลขสมาชิกหรือชื่อ" required
        value={recipient} onChange={setRecipient} text={({ number, name }) => `${number} · ${name}`} load={searchRecipients} />}
      {type === "CORRECTION" && <Select label="ปรับจำนวนหุ้น" name="direction">
        <option value="ADD">เพิ่ม</option><option value="REMOVE">ลด</option>
      </Select>}
      <div className="field-row">
        <Field name="quantity" label="จำนวนหุ้น" required type="number" min={1} max={2147483647} step={1} />
        {type === "INITIAL" && <Field name="unitValue" label="มูลค่าต่อหุ้น (บาท)" required inputMode="decimal" maxLength={13} />}
        <Field name="effectiveDate" label="วันที่มีผล" required type="date" defaultValue={today()} min={minimum} max={today()} />
      </div>
      <Field name="reason" label="เหตุผลหรือเลขอ้างอิง" required maxLength={300} />
      {!pending && error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <Button type="button" variant="ghost" onClick={() => void cancel()}>ยกเลิก</Button>
        <Button type="submit">ตรวจสอบรายการ</Button>
      </div>
    </form>
    {input && <div className="form-stack">
      <h3>ตรวจสอบก่อนบันทึก</h3>
      <dl className="member-facts">
        <div><dt>สมาชิก</dt><dd>{member.number} · {member.name}</dd></div>
        {recipient && input.type === "TRANSFER" && <div><dt>สมาชิกผู้รับโอน</dt><dd>{recipient.number} · {recipient.name}</dd></div>}
        <div><dt>จำนวนหุ้น</dt><dd>{input.type === "CORRECTION" ? input.direction === "ADD" ? "เพิ่ม " : "ลด " : ""}{input.quantity.toLocaleString("th-TH")}</dd></div>
        <div><dt>มูลค่าต่อหุ้น</dt><dd>{input.type === "INITIAL" ? input.unitValue : shares.account?.shareValue} บาท</dd></div>
        <div><dt>วันที่มีผล</dt><dd>{thaiDate(input.effectiveDate)}</dd></div>
        <div><dt>เหตุผลหรือเลขอ้างอิง</dt><dd>{input.reason}</dd></div>
      </dl>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <Button type="button" variant="outline" disabled={busy || uncertain} onClick={() => { setPending(null); setError(""); }}>กลับไปแก้ไข</Button>
        <Button type="button" disabled={busy} onClick={() => void submit()}>{uncertain ? "ส่งรายการเดิมอีกครั้ง" : "ยืนยันบันทึก"}</Button>
      </div>
    </div>}
  </Modal>;
}
