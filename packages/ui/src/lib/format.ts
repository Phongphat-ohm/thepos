import { Decimal } from "@thepos/shared";

export const ExactDecimal = Decimal.clone({ precision: 40 });
export const decimal = (value: string) => new ExactDecimal(value);

export const paymentLabels: Record<string, string> = {
  CASH: "เงินสด",
  TRANSFER: "โอนเงิน",
  PROMPTPAY: "พร้อมเพย์",
};

export function thaiDate(value: string) {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value));
}

export function today() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", dateStyle: "short" }).format(new Date());
}

export function printerDate(date: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
    numberingSystem: "latn",
  }).format(new Date(date));
}

export function readStored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

export function retryKey(ref: { current: { payload: string; key: string } | undefined }, input: unknown) {
  const payload = JSON.stringify(input);
  if (ref.current?.payload !== payload) ref.current = { payload, key: crypto.randomUUID() };
  return ref.current.key;
}
