import { useId, type ComponentProps, type FormEvent } from "react";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
export { Pin } from "./pin";

type Props = ComponentProps<typeof Input> & { label: string; hint?: string };

export function Field({ label, hint, autoFocus, ...input }: Props) {
  const id = useId();
  return (
    <div className="field">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        autoFocus={autoFocus}
        data-autofocus={autoFocus ? "" : undefined}
        aria-describedby={hint ? id + "-hint" : undefined}
        {...input}
      />
      {hint && <span id={id + "-hint"} className="field-hint">{hint}</span>}
    </div>
  );
}

export function readFields(event: FormEvent<HTMLFormElement>, report: (message: string) => void) {
  event.preventDefault();
  const form = event.currentTarget;
  const invalid = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:invalid, select:invalid, textarea:invalid");
  if (!invalid) return Object.fromEntries(new FormData(form));

  const label =
    invalid.labels?.[0]?.textContent ??
    invalid.closest("fieldset")?.querySelector("legend")?.textContent ??
    invalid.getAttribute("aria-label") ??
    "ข้อมูล";
  invalid.focus();
  if (invalid.validity.valueMissing) report(`กรุณากรอก${label}`);
  else if (invalid.validity.tooShort && "minLength" in invalid) report(`${label}ต้องมีอย่างน้อย ${invalid.minLength} อักขระ`);
  else report(`กรุณาตรวจสอบรูปแบบ${label}`);
  return null;
}

export function Username({ autoFocus }: { autoFocus?: boolean }) {
  return <Field label="ชื่อผู้ใช้" name="username" autoFocus={autoFocus} required
    maxLength={64} autoComplete="username" spellCheck={false} />;
}

export function Password({ isNew }: { isNew?: boolean }) {
  return <Field label="รหัสผ่าน" name="password" required type="password" maxLength={128}
    minLength={isNew ? 12 : undefined} autoComplete={isNew ? "new-password" : "current-password"}
    hint={isNew ? "อย่างน้อย 12 อักขระ" : undefined} />;
}
