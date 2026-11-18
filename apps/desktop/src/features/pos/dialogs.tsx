import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Banknote, Check, Landmark, QrCode, Search, Split, UserCheck, UserPlus, X } from "lucide-react";
import { checkoutInput, memberInput, saleMoney, type CheckoutInput, type ManagerApproval } from "@thepos/contracts";
import { Field, Pin, Username } from "@/components/fields";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";
import { Loading } from "@/components/loading";
import { notifyError, notifySuccess } from "@/lib/alerts";
import { business, errorMessage } from "@/lib/native";
import { Select, Table } from "../stock/shared";
import { decimal, paymentLabels, type Member, type Receipt } from "./model";
import { downloadReceipt, listPrinters, printReceipt, type PrintSettings } from "./printing";

export function Dialog({ title, close, busy, children }: { title: string; close: () => void; busy?: string | boolean; children: ReactNode }) {
  return <Modal title={title} close={close} busy={busy} variant="register">{children}</Modal>;
}

export function ManagerFields() {
  return (
    <fieldset className="register-approval">
      <legend>อนุมัติโดยผู้จัดการ</legend>
      <div className="field-row">
        <Username />
        <Pin />
      </div>
    </fieldset>
  );
}

export function approvalFrom(data: FormData): ManagerApproval {
  return { username: String(data.get("username") ?? ""), pin: String(data.get("pin") ?? "") };
}

type PaymentMethod = "CASH" | "PROMPTPAY" | "TRANSFER";
const PAYMENT_CARDS: { id: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { id: "CASH", label: "เงินสด", icon: Banknote },
  { id: "PROMPTPAY", label: "พร้อมเพย์", icon: QrCode },
  { id: "TRANSFER", label: "โอนเงิน", icon: Landmark },
];

type DraftPayment = { id: string; method: PaymentMethod; amount: string; detail: string };
const newPayment = (amount: string, method: PaymentMethod = "CASH"): DraftPayment => ({
  id: crypto.randomUUID(),
  method,
  amount,
  detail: method === "CASH" ? amount : "",
});

export function CheckoutDialog({
  total,
  approval,
  lines,
  pending,
  busy,
  onCancelPending,
  submit,
}: {
  total: string;
  approval: boolean;
  lines: Omit<CheckoutInput, "payments" | "approval">;
  pending?: Omit<CheckoutInput, "approval">;
  busy: boolean;
  onCancelPending?: () => Promise<void>;
  submit: (input: CheckoutInput) => void;
}) {
  const [split, setSplit] = useState(false);
  const [singleMethod, setSingleMethod] = useState<PaymentMethod>("CASH");
  const [singleDetail, setSingleDetail] = useState(total);
  const [payments, setPayments] = useState<DraftPayment[]>([newPayment(total)]);
  const [error, setError] = useState("");
  const detailInputRef = useRef<HTMLInputElement>(null);

  const positive = decimal(total).gt(0);
  const amount = (value: string) => (saleMoney.safeParse(value).success ? decimal(value) : decimal("0"));

  const activePayments: DraftPayment[] = split
    ? payments
    : [{ id: "single", method: singleMethod, amount: total, detail: singleDetail }];

  const paid = activePayments.reduce((sum, row) => sum.plus(amount(row.amount)), decimal("0"));
  const change = activePayments.reduce(
    (sum, row) => (row.method === "CASH" ? sum.plus(amount(row.detail).minus(amount(row.amount))) : sum),
    decimal("0"),
  );
  const update = (id: string, changes: Partial<DraftPayment>) =>
    setPayments((rows) => rows.map((row) => (row.id === id ? { ...row, ...changes } : row)));

  const selectSingleMethod = (method: PaymentMethod) => {
    setSingleMethod(method);
    setSingleDetail(method === "CASH" ? total : "");
    setError("");
    window.requestAnimationFrame(() => {
      detailInputRef.current?.focus();
      detailInputRef.current?.select();
    });
  };

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const credential = approvalFrom(new FormData(event.currentTarget));
    const payload = pending ?? {
      ...lines,
      payments: positive
        ? activePayments.map((row) =>
            row.method === "CASH"
              ? { method: row.method, amount: row.amount, tendered: row.detail }
              : { method: row.method, amount: row.amount, reference: row.detail },
          )
        : [],
    };
    const parsed = checkoutInput.safeParse({
      ...payload,
      ...(approval || credential.username || credential.pin ? { approval: credential } : {}),
    });
    if (!parsed.success) {
      setError("ตรวจสอบยอดชำระ เงินที่รับมา เลขอ้างอิง หรือข้อมูลผู้จัดการ");
      return;
    }
    if (
      !pending &&
      positive &&
      (!paid.eq(total) ||
        activePayments.some(
          (row) =>
            amount(row.amount).lte(0) || (row.method === "CASH" && amount(row.detail).lt(amount(row.amount))),
        ))
    ) {
      setError("ยอดชำระต้องตรงกับยอดสุทธิ และเงินสดที่รับมาต้องไม่น้อยกว่ายอดชำระ");
      return;
    }
    setError("");
    submit(parsed.data);
  }

  return (
    <form className="form-stack" onSubmit={confirm} noValidate>
      <div className="register-payment-total">
        <span>ยอดสุทธิที่ต้องชำระ</span>
        <strong>฿{total}</strong>
      </div>

      {error && <div className="notice" role="alert">{error}</div>}
      {pending && <p className="notice">มีรายการชำระที่ต้องตรวจสอบ ระบบจะใช้รหัสรายการเดิมเพื่อป้องกันบิลซ้ำ</p>}

      {!pending && positive && !split && (
        <div className="form-stack">
          <div className="pay-method-grid" role="radiogroup" aria-label="เลือกวิธีการชำระเงิน">
            {PAYMENT_CARDS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={singleMethod === id}
                className={`pay-method-card${singleMethod === id ? " is-active" : ""}`}
                onClick={() => selectSingleMethod(id)}
              >
                <Icon size={22} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="field">
            <label className="label" htmlFor="single-payment-detail">
              {singleMethod === "CASH" ? "เงินที่รับมา (บาท)" : "เลขอ้างอิงสลิป"}
            </label>
            <input
              ref={detailInputRef}
              id="single-payment-detail"
              className="input pay-tender-input"
              autoFocus
              inputMode={singleMethod === "CASH" ? "decimal" : undefined}
              value={singleDetail}
              onChange={(event) => setSingleDetail(event.target.value)}
            />
          </div>

          {singleMethod === "CASH" && (
            <div className={`pay-change-box${change.lt(0) ? " is-short" : ""}`}>
              <span>{change.lt(0) ? "ยังขาดอีก" : "เงินทอน"}</span>
              <strong>฿{change.abs().toFixed(2)}</strong>
            </div>
          )}

          <div className="register-inline">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPayments([
                  { id: crypto.randomUUID(), method: singleMethod, amount: total, detail: singleDetail },
                ]);
                setSplit(true);
              }}
            >
              <Split size={16} /> แบ่งจ่ายหลายช่องทาง
            </Button>
          </div>
        </div>
      )}

      {!pending && positive && split && (
        <div className="form-stack">
          {payments.map((row, index) => (
            <div className="pay-split-row" key={row.id}>
              <div className="pay-pill-group" role="group" aria-label={`ช่องทางที่ ${index + 1}`}>
                {PAYMENT_CARDS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    className={`pay-pill${row.method === id ? " is-active" : ""}`}
                    onClick={() =>
                      update(row.id, { method: id, detail: id === "CASH" ? row.amount : "" })
                    }
                  >
                    <Icon size={14} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              <div className="pay-split-inputs">
                <Field
                  label="ยอดที่ชำระ"
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(event) => update(row.id, { amount: event.target.value })}
                />
                <Field
                  autoFocus={index === 0}
                  label={row.method === "CASH" ? "เงินที่รับมา" : "เลขอ้างอิงสลิป"}
                  inputMode={row.method === "CASH" ? "decimal" : undefined}
                  value={row.detail}
                  onChange={(event) => update(row.id, { detail: event.target.value })}
                />
                {payments.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`ลบช่องทาง ${index + 1}`}
                    onClick={() => setPayments((rows) => rows.filter(({ id }) => id !== row.id))}
                  >
                    <X />
                  </Button>
                )}
              </div>
            </div>
          ))}

          <div className="register-inline">
            {payments.length < 10 && (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setPayments((rows) => [...rows, newPayment(decimal(total).minus(paid).abs().toFixed(2))])
                }
              >
                เพิ่มช่องทางชำระ
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => setSplit(false)}>
              กลับไปชำระช่องทางเดียว
            </Button>
          </div>

          <div className="pay-change-box">
            <span>เงินทอน</span>
            <strong>฿{change.gte(0) ? change.toFixed(2) : "0.00"}</strong>
          </div>
        </div>
      )}

      {approval && <ManagerFields />}
      <div className="register-inline">
        {pending && onCancelPending && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void onCancelPending()}>
            ยกเลิกรายการค้าง
          </Button>
        )}
        <Button type="submit" loading={busy}>
          <Banknote />
          {pending ? "ส่งคำขอเดิมอีกครั้ง" : "ยืนยันชำระเงิน"}
        </Button>
      </div>
    </form>
  );
}

export function MemberDialog({
  write,
  current,
  select,
  onSaving,
}: {
  write: boolean;
  current: Member | null;
  select: (member: Member | null) => void;
  onSaving: (busy: boolean) => void;
}) {
  const [mode, setMode] = useState<"search" | "create">("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Member[]>([]);
  const [picked, setPicked] = useState<Member | null>(current);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const runSearch = useCallback(async (q: string) => {
    setBusy(true);
    setError("");
    try {
      const { items } = await business<{ items: Member[] }>("pos_members", { query: { q } });
      setResults(items);
      setLoaded(true);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void runSearch("");
  }, [runSearch]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(query.trim());
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = new FormData(event.currentTarget);
    const parsed = memberInput.safeParse({
      number: input.get("number"),
      name: input.get("name"),
      phone: input.get("phone") || undefined,
      barcode: input.get("barcode") || undefined,
    });
    if (!parsed.success) {
      setError("ตรวจสอบเลขสมาชิก ชื่อ และเบอร์โทรก่อนบันทึก");
      return;
    }
    setBusy(true);
    setError("");
    onSaving(true);
    try {
      const created = await business<Member>("add_member", { input: parsed.data });
      notifySuccess("เพิ่มสมาชิกแล้ว");
      select(created);
    } catch (reason) {
      void notifyError("เพิ่มสมาชิกไม่สำเร็จ", errorMessage(reason));
    } finally {
      setBusy(false);
      onSaving(false);
    }
  }

  return (
    <div className="form-stack">
      {write && (
        <div className="register-inline">
          <Button
            type="button"
            variant={mode === "search" ? "default" : "outline"}
            onClick={() => { setError(""); setMode("search"); }}
          >
            <Search size={15} /> ค้นหาสมาชิก
          </Button>
          <Button
            type="button"
            variant={mode === "create" ? "default" : "outline"}
            onClick={() => { setError(""); setMode("create"); }}
          >
            <UserPlus size={15} /> เพิ่มสมาชิกใหม่
          </Button>
          {current && (
            <Button type="button" variant="ghost" onClick={() => select(null)}>
              ขายแบบลูกค้าทั่วไป
            </Button>
          )}
        </div>
      )}

      {error && <div className="notice" role="alert">{error}</div>}
      {busy && mode === "search" && <Loading label="กำลังค้นหาสมาชิก" variant="inline" />}

      {mode === "search" ? (
        <>
          <form className="stock-inline" onSubmit={search}>
            <Field
              autoFocus
              name="q"
              label="เลขสมาชิก ชื่อ บาร์โค้ด หรือเบอร์โทร"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={100}
            />
            <Button disabled={busy} type="submit">ค้นหา</Button>
          </form>

          {loaded && results.length === 0 && <p role="status">ไม่พบสมาชิก</p>}

          {results.length > 0 && (
            <div className="member-pick-list" role="listbox" aria-label="รายชื่อสมาชิกที่พบ">
              {results.map((member) => {
                const isSelected = picked?.id === member.id;
                return (
                  <button
                    key={member.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`member-pick-card${isSelected ? " is-selected" : ""}`}
                    onClick={() => setPicked(member)}
                  >
                    <div>
                      <strong>{member.name}</strong>
                      <small>เลขสมาชิก: {member.number}</small>
                    </div>
                    {isSelected && <Check size={18} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          )}

          <div className="form-actions">
            {!write && current && (
              <Button type="button" variant="outline" onClick={() => select(null)}>
                ขายแบบลูกค้าทั่วไป
              </Button>
            )}
            <Button
              type="button"
              className="primary-action"
              disabled={!picked}
              onClick={() => { if (picked) select(picked); }}
            >
              <UserCheck size={16} /> ยืนยันเลือกสมาชิก{picked ? ` (${picked.name})` : ""}
            </Button>
          </div>
        </>
      ) : (
        <form className="form-stack" onSubmit={(event) => void add(event)}>
          <div className="field-row">
            <Field autoFocus name="number" label="เลขสมาชิก" required maxLength={50} />
            <Field name="name" label="ชื่อสมาชิก" required maxLength={120} />
            <Field name="barcode" label="บาร์โค้ดบัตร" maxLength={100} />
            <Field name="phone" label="เบอร์โทรศัพท์" inputMode="tel" maxLength={10} />
          </div>
          <div className="form-actions">
            <Button type="button" variant="ghost" onClick={() => setMode("search")}>กลับไปค้นหา</Button>
            <Button disabled={busy} type="submit" className="primary-action">บันทึกข้อมูลสมาชิก</Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function PrinterDialog({ value, save }: { value: PrintSettings; save: (settings: PrintSettings) => void }) {
  const [queues, setQueues] = useState<string[]>();
  const [error, setError] = useState("");
  const [escpos, setEscpos] = useState(value.escpos);
  useEffect(() => {
    void listPrinters().then(setQueues).catch((reason) => setError(errorMessage(reason)));
  }, []);
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        const input = new FormData(event.currentTarget);
        save({
          printer: String(input.get("printer") ?? value.printer),
          paper: input.get("paper") === "58" ? 58 : 80,
          escpos,
          cut: escpos && input.has("cut"),
          drawer: escpos && input.has("drawer"),
        });
      }}
    >
      {error && <div role="alert" className="notice">{error}</div>}
      {!queues && !error && <Loading label="กำลังค้นหาเครื่องพิมพ์ Windows" variant="inline" />}
      <Select autoFocus label="เครื่องพิมพ์ Windows" name="printer" defaultValue={value.printer}>
        <option value="">บันทึก PDF หรือเลือกเครื่องพิมพ์ภายหลัง</option>
        {value.printer && !queues?.includes(value.printer) && <option value={value.printer}>{value.printer}</option>}
        {queues?.map((queue) => <option key={queue}>{queue}</option>)}
      </Select>
      {queues?.length === 0 && <p>Windows ยังไม่มีคิวพิมพ์ที่ใช้งานได้</p>}
      <div className="field-row">
        <Select label="ขนาดกระดาษ" name="paper" defaultValue={String(value.paper)}>
          <option value="80">80 มม.</option>
          <option value="58">58 มม.</option>
        </Select>
        <div className="field">
          <span className="label">คำสั่งเครื่องพิมพ์ใบเสร็จ</span>
          <label>
            <input type="checkbox" checked={escpos} onChange={(event) => setEscpos(event.target.checked)} /> ส่งคำสั่ง ESC/POS โดยตรง
          </label>
        </div>
      </div>
      {escpos && (
        <div className="stock-flags">
          <label><input type="checkbox" name="cut" defaultChecked={value.cut} /> ตัดกระดาษอัตโนมัติ</label>
          <label><input type="checkbox" name="drawer" defaultChecked={value.drawer} /> เปิดลิ้นชักเมื่อรับเงินสด</label>
        </div>
      )}
      <Button type="submit">บันทึกการตั้งค่า</Button>
    </form>
  );
}

export function ReceiptView({
  receipt,
  settings,
  configure,
}: {
  receipt: Receipt;
  settings: PrintSettings;
  configure: () => void;
}) {
  const [busy, setBusy] = useState<"print" | "pdf">();

  async function output(action: "print" | "pdf") {
    if (busy) return;
    setBusy(action);
    try {
      if (action === "print") await printReceipt(receipt, settings, false);
      else await downloadReceipt(receipt, settings);
      notifySuccess(action === "print" ? "ส่งคำสั่งพิมพ์แล้ว" : "เตรียมไฟล์ใบเสร็จแล้ว");
    } catch (reason) {
      void notifyError(action === "print" ? "พิมพ์ใบเสร็จไม่สำเร็จ" : "บันทึก PDF ไม่สำเร็จ", errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="form-stack">
      {receipt.receiptLogo && <img className="receipt-logo" src={receipt.receiptLogo} alt="โลโก้ร้าน" />}
      {receipt.receiptHeader && <p className="receipt-message">{receipt.receiptHeader}</p>}
      <div className="register-inline">
        <strong>เลขที่ {receipt.invoiceNumber}</strong>
        {receipt.memberName && <span>สมาชิก {receipt.memberName}</span>}
      </div>
      <Table headings={["สินค้า", "จำนวน", "ส่วนลด", "สุทธิ"]}>
        {receipt.items.map((item) => (
          <tr key={item.id}>
            <td>{item.name}</td>
            <td>{item.quantity} {item.unit}</td>
            <td>{item.lineDiscount}</td>
            <td>{item.lineTotal}</td>
          </tr>
        ))}
      </Table>
      <div className="form-stack">
        <div className="register-inline">
          <span>รวมก่อนลด ฿{receipt.subtotal}</span>
          {receipt.discountTotal !== "0.00" && <span>ส่วนลด ฿{receipt.discountTotal}</span>}
          <strong>ยอดสุทธิ ฿{receipt.netTotal}</strong>
        </div>
        <div className="form-stack">
          {receipt.payments.map((payment, idx) => (
            <span key={idx}>
              {paymentLabels[payment.method] ?? "ชำระเงิน"} ฿{payment.amount}
              {payment.tendered ? ` · รับมา ฿${payment.tendered} · เงินทอน ฿${payment.change ?? "0.00"}` : ""}
              {payment.reference ? ` · อ้างอิง ${payment.reference}` : ""}
            </span>
          ))}
        </div>
      </div>
      {receipt.receiptFooter && <p className="receipt-message">{receipt.receiptFooter}</p>}
      <div className="register-inline">
        <Button disabled={!!busy} loading={busy === "print" && "กำลังพิมพ์"} onClick={() => void output("print")}>พิมพ์ใบเสร็จ</Button>
        <Button variant="outline" disabled={!!busy} loading={busy === "pdf" && "กำลังเตรียม PDF"} onClick={() => void output("pdf")}>บันทึกเป็น PDF</Button>
        <Button variant="ghost" disabled={!!busy} onClick={configure}>ตั้งค่าเครื่องพิมพ์</Button>
      </div>
    </div>
  );
}
