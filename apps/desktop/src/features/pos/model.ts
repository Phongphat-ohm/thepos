import { discountApprovalPercent, type CheckoutInput, type HeldInput } from "@thepos/contracts";
import { Decimal } from "@thepos/shared";

export type RegisterProduct = {
  id: string; sku: string; name: string; baseUnit: string; regularPrice: string; memberPrice: string;
  units: { name: string; multiplier: string }[];
};
export type Member = { id: string; number: string; name: string };
export type CartLine = { id: string; product: RegisterProduct; unit: string; quantity: string; discount: string };
export type Cart = {
  id: string; lines: CartLine[]; member: Member | null; discount: string; note?: string;
  hold?: { id: string; revision: number };
};
export type HeldBill = { id: string; revision: number; held: boolean; note: string; updatedAt: string; draft: HeldInput };
export type ResumedBill = HeldBill & { products: RegisterProduct[]; member: Member | null };
export type Payment = { method: string; amount: string; tendered?: string | null; change?: string | null; reference?: string | null };
export type Receipt = {
  id: string; invoiceNumber: string; completedAt: string; storeName: string; cashierName: string;
  receiptHeader?: string | null; receiptFooter?: string | null; receiptLogo?: string | null;
  memberName: string | null; subtotal: string; netTotal: string; billDiscount: string; discountTotal: string;
  items: {
    id: string; name: string; sku: string; unit: string; quantity: string; lineTotal: string;
    lineDiscount: string; billDiscountShare: string; returnable?: string;
  }[];
  payments: Payment[]; returnedTotal?: string;
};
export type ReturnQuote = { quote: string; total: string; refunds: Payment[] };
export type ReturnReceipt = { id: string; invoiceNumber: string; netTotal: string; refunds: Payment[] };
export type SaleSummary = Pick<Receipt, "id" | "invoiceNumber" | "completedAt" | "netTotal" | "returnedTotal">;

const Exact = Decimal.clone({ precision: 40 });
export const decimal = (value: string) => new Exact(value);
export const basePrice = (line: CartLine, member: boolean) => member ? line.product.memberPrice : line.product.regularPrice;
export const paymentLabels: Record<string, string> = { CASH: "เงินสด", TRANSFER: "โอนเงิน", PROMPTPAY: "พร้อมเพย์" };
export const emptyCart = (): Cart => ({ id: crypto.randomUUID(), lines: [], member: null, discount: "0.00" });

export function baseQuantity(line: CartLine) {
  const multiplier = line.unit === line.product.baseUnit ? "1" : line.product.units.find(({ name }) => name === line.unit)?.multiplier;
  if (!multiplier) throw new Error("ไม่พบหน่วยขาย");
  const quantity = decimal(line.quantity).times(multiplier);
  if (quantity.lte(0) || quantity.gt("999999999.999") || quantity.decimalPlaces() > 3) {
    throw new Error("จำนวนนี้แปลงเป็นหน่วยหลักที่มีทศนิยมไม่เกิน 3 ตำแหน่งไม่ได้");
  }
  return quantity;
}

export function lineGross(line: CartLine, member: boolean) {
  return baseQuantity(line).times(basePrice(line, member)).toDecimalPlaces(2, Exact.ROUND_HALF_UP);
}

export function totals(cart: Cart) {
  let malformed = false;
  const amounts = cart.lines.map((line) => {
    try {
      const gross = lineGross(line, !!cart.member);
      const discount = decimal(line.discount);
      return { gross, discount, net: gross.minus(discount) };
    } catch {
      malformed = true;
      return { gross: decimal("0"), discount: decimal("0"), net: decimal("0") };
    }
  });
  let bill = decimal("0");
  try {
    bill = decimal(cart.discount);
  } catch {
    malformed = true;
  }
  const subtotal = amounts.reduce((sum, line) => sum.plus(line.gross), decimal("0"));
  const net = amounts.reduce((sum, line) => sum.plus(line.net), decimal("0")).minus(bill);
  const discount = subtotal.minus(net);
  const exceeds = (cut: Decimal, amount: Decimal) => cut.times(100).gt(amount.times(discountApprovalPercent));
  return {
    amounts, subtotal, net, discount,
    invalid: malformed || net.lt(0) || subtotal.gt("9999999999.99") || amounts.some(({ net }) => net.lt(0)),
    needsApproval: exceeds(discount, subtotal) || amounts.some(({ gross, discount }) => exceeds(discount, gross)),
  };
}

export function pendingNeedsApproval(input: Pick<CheckoutInput, "lines" | "billDiscount">): boolean {
  try {
    const lineResults = input.lines.map((line) => {
      const gross = decimal(line.quantity).times(line.expectedBasePrice).toDecimalPlaces(2, Exact.ROUND_HALF_UP);
      const discount = decimal(line.discount ?? "0");
      return { gross, discount };
    });
    const subtotal = lineResults.reduce((sum, item) => sum.plus(item.gross), decimal("0"));
    const lineDiscountSum = lineResults.reduce((sum, item) => sum.plus(item.discount), decimal("0"));
    const totalDiscount = lineDiscountSum.plus(input.billDiscount ?? "0");
    const exceeds = (cut: Decimal, amount: Decimal) => cut.times(100).gt(amount.times(discountApprovalPercent));
    return exceeds(totalDiscount, subtotal) || lineResults.some(({ gross, discount }) => exceeds(discount, gross));
  } catch {
    return false;
  }
}

export function draftInput(cart: Cart): Pick<CheckoutInput, "lines" | "memberId" | "billDiscount"> {
  return {
    lines: cart.lines.map((line) => ({
      productId: line.product.id, quantity: line.quantity, unit: line.unit,
      expectedBasePrice: basePrice(line, !!cart.member), discount: line.discount,
    })),
    memberId: cart.member?.id ?? null,
    billDiscount: cart.discount,
  };
}

export function readStored<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}

export function printerDate(date: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok", numberingSystem: "latn",
  }).format(new Date(date));
}
