import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, X } from "lucide-react";
import type { Page } from "@thepos/contracts";
import { errorMessage } from "@/lib/native";
import { Input } from "@/components/ui/input";
import { Loading } from "./loading";

type Props<T> = {
  label: string;
  name?: string;
  placeholder: string;
  value: T | null;
  onChange: (value: T | null) => void;
  text: (item: T) => string;
  options?: readonly T[];
  load?: (query: string, after?: string) => Promise<Page<T>>;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  hideLabel?: boolean;
  maxLength?: number;
};

export function Autocomplete<T extends { id: string }>({
  label, name, placeholder, value, onChange, text, options, load, required, disabled, className, hideLabel, maxLength = 100,
}: Props<T>) {
  const id = useId();
  const listId = `${id}-list`;
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [after, setAfter] = useState<string>();
  const [result, setResult] = useState<{ query: string; page: Page<T> }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const query = draft?.trim() ?? "";
  const expanded = open && !disabled;
  const page = result?.query === query ? result.page : undefined;
  const items = load ? page?.items ?? [] : (options ?? []).filter((item) => text(item).toLowerCase().includes(query.toLowerCase()));
  const searching = !!load && (loading || (!error && !page));

  useEffect(() => {
    if (!expanded || !load) return;
    let current = true;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const next = await load(query, after);
        if (!current) return;
        setResult((previous) => ({
          query,
          page: after && previous?.query === query
            ? { ...next, items: [...previous.page.items, ...next.items.filter((item) => !previous.page.items.some(({ id }) => id === item.id))] }
            : next,
        }));
      } catch (reason) {
        if (current) setError(errorMessage(reason));
      } finally {
        if (current) setLoading(false);
      }
    }, after || !query ? 0 : 220);
    return () => { current = false; window.clearTimeout(timer); };
  }, [expanded, load, query, after, retry]);

  useEffect(() => {
    input.current?.setCustomValidity(required && !value ? `กรุณาเลือก${label}จากรายการ` : "");
  }, [label, required, value]);

  function close() {
    setOpen(false);
    setDraft(null);
    setActive(-1);
    setAfter(undefined);
    setResult(undefined);
    setError("");
  }

  function choose(item: T) {
    onChange(item);
    input.current?.focus();
    close();
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (!items.length) return;
      const next = event.key === "ArrowDown" ? Math.min(active + 1, items.length - 1)
        : active < 0 ? items.length - 1 : Math.max(active - 1, 0);
      setActive(next);
      document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && expanded) {
      event.preventDefault();
      const item = items[active] ?? (items.length === 1 ? items[0] : undefined);
      if (item) choose(item);
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  return <div className={`field autocomplete${className ? ` ${className}` : ""}`} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    {!hideLabel && <label className="label" htmlFor={id}>{label}</label>}
    {name && <input type="hidden" name={name} value={value?.id ?? ""} disabled={disabled} />}
    <div className="autocomplete-control">
      <Input ref={input} id={id} role="combobox" aria-label={hideLabel ? label : undefined} aria-autocomplete="list"
        aria-expanded={expanded} aria-controls={expanded ? listId : undefined} aria-required={required}
        aria-activedescendant={expanded && items[active] ? `${listId}-${active}` : undefined}
        autoComplete="off" placeholder={placeholder} disabled={disabled} maxLength={maxLength}
        value={draft ?? (value ? text(value) : "")}
        onFocus={() => { setOpen(true); input.current?.select(); }} onClick={() => setOpen(true)}
        onChange={(event) => {
          const next = event.target.value;
          if (next.trim() !== query) { setAfter(undefined); setResult(undefined); setError(""); }
          setDraft(next); setActive(-1); setOpen(true);
        }} onKeyDown={keyDown} />
      {value && !required && <button className="autocomplete-icon" type="button" aria-label={`ล้าง${label}`} disabled={disabled}
        onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(null); setDraft(null); setActive(-1); setAfter(undefined); input.current?.focus(); setOpen(true); }}>
        <X size={15} aria-hidden="true" />
      </button>}
      <button className="autocomplete-icon" type="button" aria-label={`แสดงตัวเลือก${label}`} disabled={disabled}
        onMouseDown={(event) => event.preventDefault()} onClick={() => {
          if (expanded) close(); else { input.current?.focus(); setOpen(true); }
        }}><ChevronDown size={16} aria-hidden="true" /></button>
    </div>
    {expanded && <div className="autocomplete-popup">
      <ul className="autocomplete-options" id={listId} role="listbox" aria-label={label} aria-busy={searching}>
        {items.map((item, index) => <li key={item.id} id={`${listId}-${index}`} role="option"
          aria-selected={item.id === value?.id} data-active={index === active || undefined}
          onMouseMove={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>{text(item)}</li>)}
      </ul>
      {searching && <div className="autocomplete-message"><Loading label="กำลังค้นหา" variant="inline" /></div>}
      {!searching && !error && !items.length && <div className="autocomplete-message" role="status">
        {page?.nextCursor ? "ไม่พบตัวเลือกในหน้านี้" : "ไม่พบรายการ"}
      </div>}
      {error && <div className="autocomplete-message"><span role="alert">{error}</span>
        <button type="button" onClick={() => setRetry((count) => count + 1)}>ลองอีกครั้ง</button>
      </div>}
      {page?.nextCursor && !searching && !error && <button type="button" className="autocomplete-more" onClick={() => {
        input.current?.focus();
        setAfter(page.nextCursor!);
      }}>แสดงรายการเพิ่ม</button>}
    </div>}
  </div>;
}
