import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Banknote,
  Barcode,
  ClipboardList,
  History,
  LoaderCircle,
  Package,
  PauseCircle,
  Percent,
  Plus,
  Printer,
  Search,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react";
import { saleMoney, saleQuantity, type CheckoutInput, type Profile } from "@thepos/contracts";
import { Field } from "@/components/fields";
import { Loading } from "@/components/loading";
import { Autocomplete } from "@/components/autocomplete";
import { Button } from "@/components/ui/button";
import { confirmAction, notifyError, notifyInfo, notifySuccess } from "@/lib/alerts";
import { business, errorCode, errorMessage } from "@/lib/native";
import { Pagination, Select, Table, toggleSort, type Page, type Reference, type SortDir } from "../stock/shared";
import { CheckoutDialog, Dialog, MemberDialog, PrinterDialog, ReceiptView } from "./dialogs";
import { SalesHistory } from "./history";
import {
  basePrice,
  baseQuantity,
  decimal,
  draftInput,
  emptyCart,
  pendingNeedsApproval,
  printerDate,
  readStored,
  totals,
  type Cart,
  type CartLine,
  type HeldBill,
  type Receipt,
  type RegisterProduct,
  type ResumedBill,
} from "./model";
import { defaultPrintSettings, printReceipt } from "./printing";

type Pane = "member" | "quantity" | "discount" | "hold" | "held" | "payment" | "history" | "printer" | "receipt";
type Pending = { key: string; cartId: string; total: string; input: Omit<CheckoutInput, "approval"> };
type CatalogItem = RegisterProduct & { barcodes: string[] };
const searchCategories = (q: string, after?: string) => business<Page<Reference>>("pos_categories", { query: { q, after } });

const titles: Record<Pane, string> = {
  member: "ข้อมูลสมาชิก",
  quantity: "แก้ไขจำนวนสินค้า",
  discount: "ส่วนลดสินค้าและท้ายบิล",
  hold: "พักบิล",
  held: "บิลที่พักไว้",
  payment: "ชำระเงิน",
  history: "ประวัติการขาย",
  printer: "ตั้งค่าเครื่องพิมพ์ใบเสร็จ",
  receipt: "ใบเสร็จรับเงิน",
};

export function Register({
  profile,
  onOpenHistory,
  onOpenShifts,
}: {
  profile: Profile;
  exit?: () => void;
  onOpenHistory?: () => void;
  onOpenShifts?: () => void;
}) {
  const can = (permission: NonNullable<Profile["capabilities"]>[number]) =>
    !!profile.capabilities?.includes(permission);
  const cashier = can("sales:checkout");
  const storage = `thepos/register/${profile.store.id}/${profile.device.id}/${profile.user.id}`;
  const printerKey = `thepos/printer/${profile.device.id}`;

  const [settings, setSettings] = useState(() => readStored(printerKey, defaultPrintSettings));
  const [bills, setBills] = useState<Cart[]>(() => {
    const stored = readStored<Cart[]>(storage + "/bills", []);
    return Array.isArray(stored) && stored.length > 0 ? stored : [emptyCart()];
  });
  const [activeId, setActiveId] = useState(() => bills[0].id);
  const [pending, setPending] = useState<Pending | null>(() => readStored(storage + "/payment", null));
  const [pane, setPane] = useState<Pane>();
  const [receipt, setReceipt] = useState<Receipt>();
  const [catalogItems, setCatalogItems] = useState<{ categoryId?: string; items: CatalogItem[] }>();
  const [selectedCategory, setSelectedCategory] = useState<Reference | null>(null);
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<RegisterProduct[]>();
  const [selection, setSelection] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [savingMember, setSavingMember] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [scanning, setScanning] = useState(0);
  const [held, setHeld] = useState<Page<HeldBill>>();
  const [heldLoading, setHeldLoading] = useState(false);
  const [heldQ, setHeldQ] = useState("");
  const [heldPage, setHeldPage] = useState(1);
  const [heldPageSize, setHeldPageSize] = useState(10);
  const [heldSortBy, setHeldSortBy] = useState("updatedAt");
  const [heldSortDir, setHeldSortDir] = useState<SortDir>("desc");

  const scanner = useRef<HTMLInputElement>(null);
  const scanQueue = useRef(Promise.resolve());
  const heldSeq = useRef(0);
  const heldDebounce = useRef<number | undefined>(undefined);
  const guard = useRef(false);
  const fromPrinter = useRef<Pane | undefined>(undefined);

  const current = bills.find(({ id }) => id === activeId) ?? bills[0];
  const selected =
    current.lines.find(({ id }) => id === selection) ??
    current.lines.find(({ product }) => product.id === selection) ??
    current.lines.at(-1);
  const amount = totals(current);

  useEffect(() => {
    localStorage.setItem(storage + "/bills", JSON.stringify(bills));
  }, [storage, bills]);

  useEffect(() => {
    if (!pane) {
      const timer = window.setTimeout(() => scanner.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [pane, activeId]);

  useEffect(() => {
    if (pending) setPane("payment");
  }, []); // Restore an unresolved checkout on entry.

  const browseCategoryId = selectedCategory?.id;
  useEffect(() => {
    if (!cashier) return;
    let current = true;
    setCatalogLoading(true);
    void business<{ items: CatalogItem[] }>("pos_lookup", { query: { q: "", mode: "browse", categoryId: browseCategoryId, limit: 50 } })
      .then(({ items }) => { if (current) setCatalogItems({ categoryId: browseCategoryId, items }); })
      .catch((reason) => { if (current) void notifyError("โหลดรายการสินค้าไม่สำเร็จ", errorMessage(reason)); })
      .finally(() => { if (current) setCatalogLoading(false); });
    return () => { current = false; };
  }, [cashier, browseCategoryId]);

  const displayedCatalog = useMemo<RegisterProduct[]>(() => {
    if (results) return results;
    const q = searchText.trim().toLowerCase();
    const items = catalogItems?.categoryId === browseCategoryId ? catalogItems?.items ?? [] : [];
    return items
      .filter((item) => {
        if (!q) return true;
        return (
          item.name.toLowerCase().includes(q) ||
          item.sku.toLowerCase().includes(q) ||
          item.barcodes.some((code) => code.toLowerCase().includes(q))
        );
      });
  }, [catalogItems, results, searchText, browseCategoryId]);

  useEffect(() => {
    const q = searchText.trim();
    if (!cashier || !q || results !== undefined) return;
    if (displayedCatalog.length > 0 && (catalogItems?.items.length ?? 0) < 50) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const found = await business<{ items: RegisterProduct[] }>("pos_lookup", {
          query: { q, mode: "search", categoryId: browseCategoryId },
        });
        if (active) setResults(found.items);
      } catch {
        // Keep local filter state if background lookup fails.
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [cashier, searchText, results, displayedCatalog.length, catalogItems?.items.length]);

  function open(next: Pane) {
    setPane(next);
  }

  function close() {
    if (guard.current) return;
    const next = pane === "printer" ? fromPrinter.current : undefined;
    fromPrinter.current = undefined;
    setPane(next);
  }

  function configure(from?: Pane) {
    fromPrinter.current = from;
    open("printer");
  }

  async function run(action: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    try {
      await action();
    } catch (reason) {
      void notifyError("ดำเนินการไม่สำเร็จ", errorMessage(reason));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }

  function updateCart(id: string, update: (cart: Cart) => Cart) {
    setBills((list) => list.map((cart) => (cart.id === id ? update(cart) : cart)));
  }

  function newBill() {
    const bill = emptyCart();
    setBills((list) => [...list, bill]);
    setActiveId(bill.id);
    setSelection(undefined);
    setResults(undefined);
  }

  function closeBill(id: string) {
    const remaining = bills.filter((bill) => bill.id !== id);
    const next = remaining.length ? remaining : [emptyCart()];
    setBills(next);
    if (activeId === id) setActiveId(next[0].id);
    setSelection(undefined);
    setResults(undefined);
  }

  async function clearCurrentBill() {
    if (!current.lines.length) {
      closeBill(current.id);
      return;
    }
    const ok = await confirmAction({
      title: "ล้างรายการในบิลนี้?",
      text: `บิลปัจจุบันมี ${current.lines.length} รายการ`,
      confirmText: "ล้างบิล",
      danger: true,
    });
    if (!ok) return;
    closeBill(current.id);
    notifyInfo("ล้างบิลเรียบร้อยแล้ว");
  }

  function switchBill() {
    const next = (bills.indexOf(current) + 1) % bills.length;
    setActiveId(bills[next].id);
    setSelection(undefined);
    setResults(undefined);
  }

  function add(product: RegisterProduct, id: string) {
    const newId = crypto.randomUUID();
    const targetCart = bills.find((cart) => cart.id === id);
    const matched = targetCart?.lines.find(
      (line) => line.product.id === product.id && line.unit === product.baseUnit && decimal(line.discount).eq(0),
    );
    updateCart(id, (cart) => {
      const existing = cart.lines.find(
        (line) => line.product.id === product.id && line.unit === product.baseUnit && decimal(line.discount).eq(0),
      );
      if (existing) {
        const quantity = decimal(existing.quantity).plus(1);
        if (quantity.gt("999999999.999")) return cart;
        return {
          ...cart,
          lines: cart.lines.map((line) =>
            line.id === existing.id ? { ...line, quantity: quantity.toString(), product } : line,
          ),
        };
      }
      if (cart.lines.length >= 50) return cart;
      return {
        ...cart,
        lines: [...cart.lines, { id: newId, product, unit: product.baseUnit, quantity: "1", discount: "0.00" }],
      };
    });
    setSelection(matched ? matched.id : newId);
    setResults(undefined);
    scanner.current?.focus();
  }

  function scan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      open("payment");
      return;
    }
    const query = (scanner.current?.value ?? searchText).trim();
    if (!query) {
      setResults(undefined);
      return;
    }
    setSearchText("");
    if (scanner.current) scanner.current.value = "";
    const bill = current.id;
    setScanning((count) => count + 1);
    scanQueue.current = scanQueue.current
      .then(async () => {
        const exact = await business<{ items: RegisterProduct[] }>("pos_lookup", {
          query: { q: query, mode: "barcode" },
        });
        if (exact.items[0]) {
          add(exact.items[0], bill);
          return;
        }
        const found = await business<{ items: RegisterProduct[] }>("pos_lookup", {
          query: { q: query, mode: "search", categoryId: browseCategoryId },
        });
        setResults(found.items);
      })
      .catch((reason) => {
        void notifyError("ค้นหาสินค้าไม่สำเร็จ", errorMessage(reason));
      })
      .finally(() => {
        setScanning((count) => count - 1);
      });
  }

  function pay() {
    if (pending) {
      open("payment");
      return;
    }
    if (!current.lines.length || scanning) return;
    if (amount.invalid) {
      void notifyError("ตรวจสอบยอดเงิน", "ตรวจสอบจำนวนสินค้าและส่วนลดก่อนชำระ");
      return;
    }
    open("payment");
  }

  async function loadHeld(
    nextPage = heldPage,
    nextSize = heldPageSize,
    nextQ = heldQ,
    nextSortBy = heldSortBy,
    nextSortDir = heldSortDir,
  ) {
    const seq = ++heldSeq.current;
    setHeldLoading(true);
    try {
      const page = await business<Page<HeldBill>>("held_list", {
        query: {
          q: nextQ.trim() || undefined,
          page: nextPage,
          limit: nextSize,
          sortBy: nextSortBy,
          sortDir: nextSortDir,
        },
      });
      if (seq === heldSeq.current) setHeld(page);
    } catch (reason) {
      if (seq === heldSeq.current) void notifyError("โหลดบิลที่พักไม่สำเร็จ", errorMessage(reason));
    } finally {
      if (seq === heldSeq.current) setHeldLoading(false);
    }
  }

  function listHeld() {
    open("held");
    setHeldPage(1);
    void loadHeld(1, heldPageSize, heldQ, heldSortBy, heldSortDir);
  }

  const keyboardRef = useRef<(event: KeyboardEvent) => void>(undefined);
  keyboardRef.current = (event: KeyboardEvent) => {
    if (pane || event.isComposing || event.altKey || event.metaKey) return;
    const key = event.ctrlKey && event.key.toLowerCase() === "n" ? "new" : event.key;
    if (event.ctrlKey && key !== "new") return;
    if (key === "F10") {
      event.preventDefault();
      if (!event.repeat) {
        if (onOpenHistory) onOpenHistory();
        else open("history");
      }
      return;
    }
    if (!cashier || !["F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "new", "Escape"].includes(key)) return;
    event.preventDefault();
    if (event.repeat) return;
    if (pending && key !== "Escape") {
      open("payment");
      return;
    }
    switch (key) {
      case "F2":
        scanner.current?.focus();
        scanner.current?.select();
        break;
      case "F3":
        open("member");
        break;
      case "F4":
        if (selected) open("quantity");
        break;
      case "F5":
        listHeld();
        break;
      case "F6":
        switchBill();
        break;
      case "F7":
        if (current.lines.length) open("discount");
        break;
      case "F8":
        if (current.lines.length && !scanning) open("hold");
        else listHeld();
        break;
      case "F9":
        pay();
        break;
      case "new":
        newBill();
        break;
      case "Escape":
        setResults(undefined);
        setSearchText("");
        scanner.current?.focus();
        break;
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => keyboardRef.current?.(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function storeHold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get("note") ?? "");
    void run(async () => {
      await business("hold_bill", {
        id: current.hold?.id ?? current.id,
        input: { ...draftInput(current), note, revision: current.hold?.revision },
      });
      closeBill(current.id);
      setPane(undefined);
      notifySuccess("พักบิลเรียบร้อยแล้ว");
    });
  }

  function resume(row: HeldBill) {
    void run(async () => {
      const resumed = await business<ResumedBill>("resume_bill", { id: row.id, input: { revision: row.revision } });
      const existing = bills.find((bill) => bill.hold?.id === row.id);
      const lines: CartLine[] = resumed.draft.lines.flatMap((line) => {
        const product = resumed.products.find(({ id }) => id === line.productId);
        return product
          ? [
              {
                id: crypto.randomUUID(),
                product,
                unit:
                  product.units.some(({ name }) => name === line.unit) || line.unit === product.baseUnit
                    ? line.unit
                    : product.baseUnit,
                quantity: line.quantity,
                discount: line.discount ?? "0.00",
              },
            ]
          : [];
      });
      if (
        !existing &&
        (lines.length !== resumed.draft.lines.length ||
          lines.some((line, index) => {
            try {
              baseQuantity(line);
              return line.unit !== resumed.draft.lines[index].unit;
            } catch {
              return true;
            }
          }))
      ) {
        void notifyError("ตรวจสอบข้อมูลสินค้า", "สินค้าและหน่วยขายในบิลเปลี่ยน กรุณาตรวจสอบข้อมูลสินค้าก่อนเปิดบิลนี้");
        return;
      }
      const cart: Cart = {
        id: existing?.id ?? row.id,
        lines,
        discount: resumed.draft.billDiscount ?? "0.00",
        member: resumed.member,
        note: resumed.note,
        hold: { id: row.id, revision: resumed.revision },
      };
      setBills((list) =>
        existing ? list.map((bill) => (bill.id === existing.id ? cart : bill)) : [...list, cart],
      );
      setActiveId(cart.id);
      setSelection(undefined);
      setPane(undefined);
      if (resumed.draft.memberId && !resumed.member) {
        notifyInfo("สมาชิกในบิลไม่พร้อมใช้งาน ระบบแสดงราคาทั่วไป");
      }
    });
  }

  function checkout(input: CheckoutInput) {
    const { approval, ...base } = input;
    const persistable: Omit<CheckoutInput, "approval"> = pending?.input ?? { ...base, drawer: true };
    const attempt = pending ?? {
      key: crypto.randomUUID(),
      cartId: current.id,
      total: amount.net.toFixed(2),
      input: persistable,
    };
    void run(async () => {
      localStorage.setItem(storage + "/payment", JSON.stringify(attempt));
      setPending(attempt);
      let result: { sale: Receipt; replayed: boolean };
      try {
        result = await business("checkout", { input: { ...attempt.input, ...(approval && { approval }) }, key: attempt.key });
      } catch (reason) {
        const code = errorCode(reason);
        if (
          code &&
          ![
            "NETWORK_ERROR",
            "UNAVAILABLE",
            "SESSION_LOCKED",
            "SESSION_REQUIRED",
            "APPROVAL_REQUIRED",
            "INVALID_PIN",
            "RATE_LIMITED",
          ].includes(code)
        ) {
          localStorage.removeItem(storage + "/payment");
          setPending(null);
        } else if (!pending && ["APPROVAL_REQUIRED", "INVALID_PIN", "RATE_LIMITED"].includes(code ?? "")) {
          localStorage.removeItem(storage + "/payment");
          setPending(null);
        }
        throw reason;
      }
      localStorage.removeItem(storage + "/payment");
      setPending(null);
      closeBill(attempt.cartId);
      setReceipt(result.sale);
      setPane("receipt");
      notifySuccess("ชำระเงินสำเร็จ");
      if (!result.replayed && settings.printer) {
        try {
          await printReceipt(
            result.sale,
            settings,
            result.sale.payments.some(({ method }) => method === "CASH"),
          );
          notifyInfo("ส่งใบเสร็จเข้าเครื่องพิมพ์แล้ว");
        } catch {
          void notifyError("พิมพ์ไม่สำเร็จ", "บันทึกบิลแล้ว แต่ส่งงานพิมพ์ไม่ได้ ลองพิมพ์ซ้ำหรือบันทึก PDF");
        }
      }
    });
  }

  function edit(event: FormEvent<HTMLFormElement>, mode: "quantity" | "discount") {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    let next = current;
    if (mode === "quantity" && selected) {
      const quantity = saleQuantity.safeParse(data.get("quantity"));
      if (!quantity.success) {
        void notifyError("จำนวนไม่ถูกต้อง", "ระบุจำนวนมากกว่า 0 และใช้ทศนิยมได้ไม่เกิน 3 ตำแหน่ง");
        return;
      }
      const line = { ...selected, quantity: quantity.data, unit: String(data.get("unit")) };
      try {
        baseQuantity(line);
      } catch (reason) {
        void notifyError("หน่วยสินค้าไม่ถูกต้อง", String((reason as Error).message));
        return;
      }
      next = { ...current, lines: current.lines.map((row) => (row.id === line.id ? line : row)) };
    }
    if (mode === "discount") {
      const bill = saleMoney.safeParse(data.get("bill") || "0");
      const line = saleMoney.safeParse(data.get("line") || "0");
      if (!bill.success || !line.success) {
        void notifyError("ส่วนลดไม่ถูกต้อง", "กรอกส่วนลดเป็นจำนวนเงินบาทที่ถูกต้อง");
        return;
      }
      next = {
        ...current,
        discount: bill.data,
        lines: current.lines.map((row) => (row.id === selected?.id ? { ...row, discount: line.data } : row)),
      };
    }
    if (totals(next).invalid) {
      void notifyError("ส่วนลดเกินยอด", "ส่วนลดเกินยอดสินค้า หรือยอดรวมเกินขนาดที่รองรับ");
      return;
    }
    updateCart(current.id, () => next);
    close();
  }

  const blocked = !!pending || busy;

  return (
    <section className="pos-shell" aria-label="ขายหน้าร้าน">
      {pending && !pane && (
        <div className="notice">
          <Button onClick={() => open("payment")}>ตรวจสอบรายการชำระค้าง</Button>
        </div>
      )}

      {!cashier && can("member:write") && (
        <div className="surface">
          <Button onClick={() => open("member")}>
            <UserRound /> ข้อมูลสมาชิกสำหรับขาย
          </Button>
        </div>
      )}

      {cashier && (
        <div className="pos-board" data-enter>
          {/* LEFT COLUMN: Category + Search + Product Grid */}
          <div className="pos-catalog-col">
            <div className="pos-column-heading"><h2>เลือกสินค้า</h2><kbd>F2</kbd></div>
            <div className="pos-filter-bar">
              <form className="pos-search-form" onSubmit={scan}>
                <div className="pos-search-input-wrap">
                  <Barcode size={18} className="pos-search-icon" aria-hidden="true" />
                  <input
                    ref={scanner}
                    id="register-scan"
                    className="input pos-search-input"
                    aria-label="ค้นหาสินค้าด้วยชื่อ รหัส หรือบาร์โค้ด"
                    autoComplete="off"
                    spellCheck={false}
                    value={searchText}
                    onChange={(event) => {
                      setResults(undefined);
                      setSearchText(event.target.value);
                    }}
                    placeholder="ชื่อสินค้า รหัส หรือบาร์โค้ด"
                    maxLength={255}
                    disabled={blocked}
                  />
                </div>
                <Button type="submit" variant="outline" disabled={blocked} aria-busy={scanning > 0} aria-label="ค้นหาสินค้า">
                  {scanning > 0 ? <LoaderCircle size={17} className="ui-spinner" aria-hidden="true" /> : <Search size={17} />}
                </Button>
              </form>
              <Autocomplete className="pos-category-select" label="หมวดหมู่สินค้า" hideLabel placeholder="ค้นหาหมวดหมู่สินค้า"
                value={selectedCategory} load={searchCategories} text={({ name }) => name}
                onChange={(category) => { setResults(undefined); setSelectedCategory(category); }} disabled={blocked} />
            </div>

            {results && (
              <div className="pos-search-banner">
                <span>ผลการค้นหา ({results.length} รายการ)</span>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setResults(undefined);
                    setSearchText("");
                    scanner.current?.focus();
                  }}
                >
                  ล้างผลค้นหา
                </Button>
              </div>
            )}

            <div className="pos-product-grid" aria-busy={catalogLoading || scanning > 0}>
              {displayedCatalog.length === 0 && (catalogLoading || scanning > 0) ? (
                <div className="pos-empty-grid"><Loading variant="skeleton" label="กำลังโหลดรายการสินค้า" /></div>
              ) : displayedCatalog.length === 0 ? (
                <div className="pos-empty-grid">
                  <Package size={32} />
                  <p>ไม่พบสินค้าที่ตรงกับเงื่อนไข</p>
                </div>
              ) : (
                displayedCatalog.map((product) => {
                  const displayPrice = current.member ? product.memberPrice : product.regularPrice;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      className="pos-product-card"
                      disabled={blocked}
                      onClick={() => add(product, current.id)}
                    >
                      <div className="pos-product-thumb" aria-hidden="true">
                        <Package size={24} />
                        <span>{product.sku}</span>
                      </div>
                      <div className="pos-product-info">
                        <strong>{product.name}</strong>
                        <span className="pos-product-price">฿{displayPrice}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* MIDDLE COLUMN: Active Cart Items + Totals + Checkout Button */}
          <div className="pos-cart-col">
            <div className="pos-cart-header">
              <h2>รายการในบิล <span>{current.lines.length}</span></h2>
              {current.hold && <span className="shell-meta-pill">บิลที่พัก</span>}
            </div>

            <div className="pos-cart-list">
              {current.lines.length === 0 ? (
                <div className="pos-empty-cart">
                  <Barcode size={32} />
                  <p>สแกนบาร์โค้ดหรือเลือกสินค้าเพื่อเพิ่มในบิล</p>
                </div>
              ) : (
                current.lines.map((line, index) => {
                  const unitPrice = basePrice(line, !!current.member);
                  const lineNet = amount.amounts[index].net.toFixed(2);
                  return (
                    <div
                      key={line.id}
                      className={`pos-cart-item${selected?.id === line.id ? " is-selected" : ""}`}
                      onClick={() => setSelection(line.id)}
                    >
                      <div className="pos-cart-item-top">
                        <div className="pos-cart-item-title">
                          <strong>{line.product.name}</strong>
                          <small>
                            {unitPrice} / {line.unit}
                            {decimal(line.discount).gt(0) ? ` · ลด ฿${line.discount}` : ""}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="pos-icon-btn"
                          disabled={blocked}
                          aria-label={`นำ ${line.product.name} ออกจากบิล`}
                          onClick={(event) => {
                            event.stopPropagation();
                            updateCart(current.id, (cart) => ({
                              ...cart,
                              lines: cart.lines.filter(({ id }) => id !== line.id),
                            }));
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div className="pos-cart-item-bottom">
                        <button
                          type="button"
                          className="pos-qty-pill"
                          disabled={blocked}
                          aria-label={`แก้จำนวน ${line.product.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelection(line.id);
                            open("quantity");
                          }}
                        >
                          จำนวน {line.quantity} {line.unit}
                        </button>
                        <strong className="pos-cart-line-total">฿{lineNet}</strong>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pos-cart-footer">
              <dl className="pos-totals">
                <div>
                  <dt>ยอดรวม</dt>
                  <dd>฿{amount.subtotal.toFixed(2)}</dd>
                </div>
                <div>
                  <dt>ส่วนลด</dt>
                  <dd>฿{amount.discount.toFixed(2)}</dd>
                </div>
                <div className="is-net">
                  <dt>รวมสุทธิ</dt>
                  <dd>฿{amount.net.toFixed(2)}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="pos-pay-btn"
                disabled={blocked || !current.lines.length || !!scanning}
                onClick={pay}
              >
                <Banknote size={20} />
                <span>ชำระเงิน</span>
                <kbd>F9</kbd>
              </button>
            </div>
          </div>

          {/* RIGHT COLUMN: Customer + Bill Switcher + Quick Actions */}
          <aside className="pos-actions-col" aria-label="เครื่องมือการขาย">
            <div className="pos-panel">
              <div className="pos-panel-heading">ลูกค้า / สมาชิก</div>
              <Button
                type="button"
                variant="outline"
                className="pos-member-btn"
                disabled={blocked}
                onClick={() => open("member")}
              >
                <UserRound size={16} />
                <span>{current.member ? `${current.member.number} · ${current.member.name}` : "ลูกค้าทั่วไป"}</span>
                <kbd>F3</kbd>
              </Button>
            </div>

            <div className="pos-panel">
              <div className="pos-panel-heading">บิลที่เปิดอยู่</div>
              <div className="pos-bills-strip">
                {bills.map((bill, index) => (
                  <button
                    key={bill.id}
                    type="button"
                    disabled={blocked}
                    className={`pos-bill-chip${current.id === bill.id ? " is-active" : ""}`}
                    aria-pressed={current.id === bill.id}
                    onClick={() => {
                      setActiveId(bill.id);
                      setSelection(undefined);
                      setResults(undefined);
                    }}
                  >
                    {bill.note || `บิล ${index + 1}`} ({bill.lines.length})
                  </button>
                ))}
                <button type="button" className="pos-bill-chip is-add" disabled={blocked} onClick={newBill}>
                  <Plus size={14} /> บิลใหม่
                </button>
              </div>
            </div>

            <div className="pos-panel">
              <div className="pos-panel-heading">คำสั่งด่วน</div>
              <div className="pos-action-grid">
                <button
                  type="button"
                  className="pos-action-btn is-amber"
                  disabled={blocked || !current.lines.length || !!scanning}
                  onClick={() => open("hold")}
                >
                  <PauseCircle size={16} />
                  <span>พักบิล <kbd>F8</kbd></span>
                </button>
                <button
                  type="button"
                  className="pos-action-btn"
                  disabled={blocked}
                  onClick={listHeld}
                >
                  <ClipboardList size={16} />
                  <span>บิลที่พัก <kbd>F5</kbd></span>
                </button>
                <button
                  type="button"
                  className="pos-action-btn"
                  disabled={blocked || !current.lines.length}
                  onClick={() => open("discount")}
                >
                  <Percent size={16} />
                  <span>ส่วนลด <kbd>F7</kbd></span>
                </button>
                <button
                  type="button"
                  className="pos-action-btn is-danger"
                  disabled={blocked || (!current.lines.length && bills.length <= 1)}
                  onClick={() => void clearCurrentBill()}
                >
                  <XCircle size={16} />
                  <span>{!current.lines.length && bills.length > 1 ? "ปิดบิลนี้" : "ล้างบิล"}</span>
                </button>
                <button
                  type="button"
                  className="pos-action-btn"
                  onClick={() => (onOpenHistory ? onOpenHistory() : open("history"))}
                >
                  <History size={16} />
                  <span>ประวัติขาย <kbd>F10</kbd></span>
                </button>
                {onOpenShifts && <button type="button" className="pos-action-btn" onClick={onOpenShifts}>
                  <Banknote size={16} /><span>กะเงินสด</span>
                </button>}
                <button
                  type="button"
                  className="pos-action-btn"
                  onClick={() => configure()}
                >
                  <Printer size={16} />
                  <span>เครื่องพิมพ์</span>
                </button>
              </div>
            </div>

            <div className="pos-panel pos-summary-note">
              <div className="pos-panel-heading">สรุปสิทธิ์และส่วนลด</div>
              <p className="field-hint">
                {current.member
                  ? `กำลังใช้ราคาสมาชิกสำหรับ ${current.member.name}`
                  : "กำลังแสดงราคาทั่วไป (กด F3 เพื่อเลือกสมาชิก)"}
              </p>
              {decimal(current.discount).gt(0) && (
                <p className="pos-discount-badge">ส่วนลดท้ายบิล: ฿{current.discount}</p>
              )}
            </div>
          </aside>
        </div>
      )}

      {pane && (
        <Dialog key={pane} title={titles[pane]} close={close}
          busy={pane === "member" && savingMember ? "กำลังบันทึกสมาชิก" : busy && (pane === "payment" ? "กำลังบันทึกการชำระเงิน" : "กำลังดำเนินการ")}>
          {pane === "member" && (
            <MemberDialog
              onSaving={setSavingMember}
              write={can("member:write")}
              current={current.member}
              select={(member) => {
                updateCart(current.id, (cart) => ({ ...cart, member }));
                close();
              }}
            />
          )}
          {pane === "quantity" && selected && (
            <form className="form-stack" onSubmit={(event) => edit(event, "quantity")}>
              <p><strong>{selected.product.name}</strong></p>
              <div className="field-row">
                <Field label="จำนวน" name="quantity" defaultValue={selected.quantity} inputMode="decimal" autoFocus />
                <Select label="หน่วยขาย" name="unit" defaultValue={selected.unit}>
                  {[selected.product.baseUnit, ...selected.product.units.map(({ name }) => name)].map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </Select>
              </div>
              <Button type="submit">บันทึกจำนวน</Button>
            </form>
          )}
          {pane === "discount" && (
            <form className="form-stack" onSubmit={(event) => edit(event, "discount")}>
              {selected && (
                <Field
                  label={`ส่วนลดรายการ ${selected.product.name} (บาท)`}
                  name="line"
                  defaultValue={selected.discount}
                  inputMode="decimal"
                  autoFocus
                />
              )}
              <Field
                label="ส่วนลดท้ายบิล (บาท)"
                name="bill"
                defaultValue={current.discount}
                inputMode="decimal"
                autoFocus={!selected}
              />
              <p className="stock-help">ส่วนลดเกิน 5% ของรายการหรือยอดบิลต้องใช้ PIN ผู้จัดการตอนชำระเงิน</p>
              <Button type="submit">บันทึกส่วนลด</Button>
            </form>
          )}
          {pane === "hold" && (
            <form className="form-stack" onSubmit={storeHold}>
              <Field label="ชื่อบิลหรือหมายเหตุ" name="note" defaultValue={current.note} maxLength={100} autoFocus />
              <Button type="submit" disabled={busy}>บันทึกพักบิล</Button>
            </form>
          )}
          {pane === "held" && (
            <div className="form-stack">
              <div className="stock-inline">
                <Field
                  label="ค้นหาบิลที่พักไว้"
                  value={heldQ}
                  onChange={(e) => {
                    const nextQ = e.target.value;
                    setHeldQ(nextQ);
                    setHeldPage(1);
                    window.clearTimeout(heldDebounce.current);
                    heldDebounce.current = window.setTimeout(() => {
                      void loadHeld(1, heldPageSize, nextQ, heldSortBy, heldSortDir);
                    }, 220);
                  }}
                  placeholder="ชื่อบิลหรือหมายเหตุ"
                />
                <Button variant="outline" disabled={busy || heldLoading} onClick={() => void loadHeld()}>
                  โหลดบิลล่าสุด
                </Button>
              </div>
              {heldLoading && !!held?.items.length && <Loading label="กำลังค้นหาบิลที่พัก" variant="inline" />}
              <Table
                headings={[
                  { label: "บิล", sortKey: "note" },
                  { label: "รายการ", numeric: true },
                  { label: "เวลา", sortKey: "updatedAt" },
                  "",
                ]}
                sortBy={heldSortBy}
                sortDir={heldSortDir}
                onSort={(key) => {
                  const next = toggleSort(heldSortBy, heldSortDir, key, "desc");
                  setHeldSortBy(next.sortBy);
                  setHeldSortDir(next.sortDir);
                  setHeldPage(1);
                  void loadHeld(1, heldPageSize, heldQ, next.sortBy, next.sortDir);
                }}
                loading={heldLoading && !held?.items.length}
                empty={held?.items.length ? undefined : "ไม่มีบิลที่พักไว้"}
              >
                {held?.items.map((row) => (
                  <tr key={row.id}>
                    <td>{row.note || "บิลพัก"}</td>
                    <td className="report-number">{row.draft.lines.length}</td>
                    <td>{printerDate(row.updatedAt)}</td>
                    <td>
                      <Button disabled={busy || heldLoading} onClick={() => resume(row)}>
                        เปิดบิล {row.note || ""}
                      </Button>
                    </td>
                  </tr>
                ))}
              </Table>
              <Pagination
                page={held?.page ?? heldPage}
                pageSize={held?.pageSize ?? heldPageSize}
                total={held?.total ?? held?.items.length ?? 0}
                totalPages={held?.totalPages ?? 1}
                onPageChange={(nextPage) => {
                  setHeldPage(nextPage);
                  void loadHeld(nextPage, heldPageSize, heldQ, heldSortBy, heldSortDir);
                }}
                onPageSizeChange={(nextSize) => {
                  setHeldPageSize(nextSize);
                  setHeldPage(1);
                  void loadHeld(1, nextSize, heldQ, heldSortBy, heldSortDir);
                }}
                disabled={busy || heldLoading}
              />
            </div>
          )}
          {pane === "payment" && (
            <CheckoutDialog
              total={pending?.total ?? amount.net.toFixed(2)}
              approval={pending ? pendingNeedsApproval(pending.input) : amount.needsApproval}
              pending={pending?.input}
              busy={busy}
              lines={{ ...draftInput(current), hold: current.hold }}
              onCancelPending={async () => {
                if (busy) return;
                const ok = await confirmAction({
                  title: "ยกเลิกรายการชำระที่ค้าง?",
                  text: "ควรตรวจสอบประวัติการขายก่อนเพื่อยืนยันว่าบิลนี้ยังไม่ถูกบันทึก หากยกเลิกแล้วจะไม่สามารถส่งซ้ำด้วยรหัสรายการเดิมได้",
                  confirmText: "ยกเลิกรายการค้าง",
                  danger: true,
                });
                if (!ok) return;
                localStorage.removeItem(storage + "/payment");
                setPending(null);
              }}
              submit={checkout}
            />
          )}
          {pane === "history" && (
            <SalesHistory
              canReturn={can("sales:return")}
              drawer={can("shift:operate")}
              storage={storage}
              settings={settings}
              configure={() => configure("history")}
            />
          )}
          {pane === "printer" && (
            <PrinterDialog
              value={settings}
              save={(value) => {
                localStorage.setItem(printerKey, JSON.stringify(value));
                setSettings(value);
                notifySuccess("บันทึกการตั้งค่าเครื่องพิมพ์แล้ว");
                close();
              }}
            />
          )}
          {pane === "receipt" && receipt && (
            <ReceiptView receipt={receipt} settings={settings} configure={() => configure("receipt")} />
          )}
        </Dialog>
      )}
    </section>
  );
}
