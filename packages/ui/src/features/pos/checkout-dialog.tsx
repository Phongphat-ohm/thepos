import { useRef, useState, type FormEvent } from "react";
import { Banknote, Landmark, QrCode, Split, X } from "lucide-react";
import { checkoutInput, saleMoney, type CheckoutInput } from "@thepos/contracts";
import { Field } from "@/components/common/fields";
import { ManagerFields, approvalFrom } from "@/components/common/manager-approval";
import { Button } from "@/components/ui/button";
import { decimal } from "@/lib/format";

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
          (row) => amount(row.amount).lte(0) || (row.method === "CASH" && amount(row.detail).lt(amount(row.amount))),
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
                setPayments([{ id: crypto.randomUUID(), method: singleMethod, amount: total, detail: singleDetail }]);
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
                    onClick={() => update(row.id, { method: id, detail: id === "CASH" ? row.amount : "" })}
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
