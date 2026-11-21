import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";

const length = 6;
const emptyDigits = () => Array<string>(length).fill("");

export function Pin({ autoFocus, autoSubmit, disabled, hint, name = "pin", label = "รหัส PIN", required = true }: {
  autoFocus?: boolean;
  autoSubmit?: boolean;
  disabled?: boolean;
  hint?: string;
  name?: string;
  label?: string;
  required?: boolean;
}) {
  const [digits, setDigits] = useState(emptyDigits);
  const fields = useRef<Array<HTMLInputElement | null>>([]);
  const group = useRef<HTMLFieldSetElement>(null);
  const hintId = useId();

  useEffect(() => {
    const form = group.current?.form;
    const reset = () => setDigits(emptyDigits());
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, []);

  useEffect(() => {
    if (autoFocus && !disabled) fields.current[0]?.focus();
  }, [autoFocus, disabled]);

  useEffect(() => {
    if (autoSubmit && !disabled && digits.every(Boolean)) group.current?.form?.requestSubmit();
  }, [autoSubmit, digits, disabled]);

  function focus(index: number) {
    const field = fields.current[index];
    field?.focus();
    field?.select();
  }

  function enter(index: number, value: string) {
    setDigits((previous) => {
      const next = [...previous];
      next.splice(index, Math.max(1, value.length), ...(value ? [...value] : [""]));
      return next;
    });
    if (value) focus(Math.min(index + value.length, length - 1));
  }

  function move(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      enter(index, event.key);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      focus(index + (event.key === "ArrowLeft" ? -1 : 1));
    } else if (event.key === "Backspace" && !digits[index] && index > 0) {
      event.preventDefault();
      enter(index - 1, "");
      focus(index - 1);
    }
  }

  return <fieldset className="field pin-field" ref={group} disabled={disabled} aria-describedby={hint ? hintId : undefined}>
    <legend className="label">{label}</legend>
    <input type="hidden" name={name} value={digits.join("")} />
    <div className="pin-digits" dir="ltr">
      {digits.map((digit, index) => <Input
        key={index}
        ref={(field) => { fields.current[index] = field; }}
        className="pin-digit"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        aria-label={`${label} หลักที่ ${index + 1}`}
        maxLength={1}
        pattern="[0-9]"
        required={required || digits.some(Boolean)}
        value={digit}
        onFocus={(event) => event.currentTarget.select()}
        onClick={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const raw = event.currentTarget.value.replace(/\D/g, "");
          if (!event.currentTarget.value) {
            enter(index, "");
          } else if (raw) {
            const next = raw.length > 1 && raw.startsWith(digits[index]) ? raw.slice(1) : raw;
            enter(index, next.slice(0, length - index));
          }
        }}
        onKeyDown={(event) => move(event, index)}
        onPaste={(event) => {
          event.preventDefault();
          const value = event.clipboardData.getData("text").trim().replace(/[\s-]/g, "");
          if (!/^[0-9]{1,6}$/.test(value)) return;
          if (value.length === length) enter(0, value);
          else enter(index, value.slice(0, length - index));
        }}
      />)}
    </div>
    {hint && <span id={hintId} className="field-hint">{hint}</span>}
  </fieldset>;
}
