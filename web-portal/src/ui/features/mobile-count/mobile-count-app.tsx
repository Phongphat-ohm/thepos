import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardList,
  LogOut,
  Package,
  Search,
  Trash2,
  Zap,
} from "lucide-react";
import { BarcodeScanner } from "./barcode-scanner";
import "./mobile-count.css";

type SessionStatus = "OPEN" | "PAUSED" | "SUBMITTED" | "CANCELLED";

type MobileSessionInfo = {
  id: string;
  title: string;
  status: SessionStatus;
  showExpectedQty: boolean;
  storeName: string;
};

type MobileParticipant = {
  id: string;
  displayName: string;
};

type MobileEntry = {
  id: string;
  lotId: string;
  lotNumber: string;
  expirationDate: string | null;
  productId: string;
  sku: string;
  productName: string;
  baseUnit: string;
  unitName: string;
  unitMultiplier: string;
  inputQuantity: string;
  baseQuantity: string;
  note: string | null;
  createdAt: string;
};

type MobileLot = {
  id: string;
  lotNumber: string;
  expirationDate: string | null;
  receivedAt: string;
  expectedQuantity?: string;
  myCounted: string;
  sessionCounted: string;
};

type MobileProduct = {
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  trackExpiration: boolean;
  barcodes: string[];
  units: { name: string; multiplier: string }[];
  lots: MobileLot[];
};

const TOKEN_KEY = "thepos/mobile-count/token";
const NAME_KEY = "thepos/mobile-count/display-name";

const STATUS_LABELS: Record<SessionStatus, string> = {
  OPEN: "กำลังเปิดให้นับ",
  PAUSED: "ปิดชั่วคราว",
  SUBMITTED: "ปิดรอบแล้ว",
  CANCELLED: "ยกเลิกแล้ว",
};

const ERROR_MESSAGES: Record<string, string> = {
  LAN_ONLY: "ใช้งานได้เฉพาะอุปกรณ์ที่เชื่อมต่อ Wi-Fi (LAN) เดียวกับเครื่อง POS เท่านั้น",
  NOT_FOUND: "ไม่พบรหัสการนับสต๊อกนี้ กรุณาตรวจสอบรหัสอีกครั้ง",
  COUNT_SESSION_CLOSED: "รอบนับสต๊อกนี้ถูกปิดหรือยกเลิกแล้ว",
  COUNT_SESSION_PAUSED: "ผู้ดูแลปิดการนับชั่วคราว กรุณารอเปิดให้นับต่อ",
  PARTICIPANT_REVOKED: "อุปกรณ์นี้ถูกยกเลิกสิทธิ์ออกจากรอบนับแล้ว",
  SESSION_REQUIRED: "การเชื่อมต่อหมดอายุ กรุณาสแกน QR หรือกรอกรหัสเข้าร่วมใหม่",
  INVALID_QUANTITY: "จำนวนสินค้าไม่ถูกต้อง กรุณากรอกตัวเลขมากกว่า 0",
  INVALID_INPUT: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
  RATE_LIMITED: "ลองหลายครั้งเกินกำหนด กรุณารอสักครู่",
};

function formatQty(value: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return num.toLocaleString("th-TH", { maximumFractionDigits: 3 });
}

function readInitialCode(): string {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("code")?.trim();
  if (fromQuery) return fromQuery.toUpperCase();
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[0] === "stock-count") {
    return decodeURIComponent(parts[1]!).toUpperCase();
  }
  return "";
}

async function mobileApi<T>(
  path: string,
  options: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.token) headers["x-mobile-count-token"] = options.token;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`/api/v1/mobile-count/${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error("ติดต่อเซิร์ฟเวอร์ POS ไม่ได้ กรุณาตรวจสอบว่าเชื่อมต่อ Wi-Fi เดียวกัน");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof (data as { code?: unknown }).code === "string" ? (data as { code: string }).code : "NETWORK_ERROR";
    const err = new Error(ERROR_MESSAGES[code] ?? "เกิดข้อผิดพลาด กรุณาลองใหม่") as Error & { code?: string };
    err.code = code;
    throw err;
  }
  return data as T;
}

export function MobileCountApp() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [codeInput, setCodeInput] = useState<string>(readInitialCode);
  const [displayName, setDisplayName] = useState<string>(() => localStorage.getItem(NAME_KEY) ?? "");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [participant, setParticipant] = useState<MobileParticipant | null>(null);
  const [session, setSession] = useState<MobileSessionInfo | null>(null);
  const [entries, setEntries] = useState<MobileEntry[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [revokedError, setRevokedError] = useState<string | null>(null);

  const [tab, setTab] = useState<"scan" | "history">("scan");
  const [quickScanMode, setQuickScanMode] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<MobileProduct[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<MobileProduct | null>(null);
  const [selectedLotId, setSelectedLotId] = useState<string>("");
  const [selectedUnit, setSelectedUnit] = useState<string>("");
  const [qtyInput, setQtyInput] = useState("1");
  const [noteInput, setNoteInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; undoEntryId?: string } | null>(null);

  const toastTimer = useRef<number | undefined>(undefined);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((message: string, undoEntryId?: string) => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, undoEntryId });
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const loadState = useCallback(async (activeToken: string) => {
    try {
      const state = await mobileApi<{
        participant: MobileParticipant;
        session: MobileSessionInfo;
        totalEntries: number;
        entries: MobileEntry[];
      }>("state", { token: activeToken });
      setParticipant(state.participant);
      setSession(state.session);
      setEntries(state.entries);
      setTotalEntries(state.totalEntries);
      setRevokedError(null);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "PARTICIPANT_REVOKED" || code === "SESSION_REQUIRED") {
        setRevokedError((error as Error).message);
        if (code === "SESSION_REQUIRED") {
          sessionStorage.removeItem(TOKEN_KEY);
          setToken(null);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadState(token);
    const interval = window.setInterval(() => {
      void loadState(token);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [token, loadState]);

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedCode = codeInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const cleanedName = displayName.trim();
    if (cleanedCode.length < 4) {
      setJoinError("กรุณากรอกรหัสเข้าร่วมรอบนับให้ถูกต้อง");
      return;
    }
    if (!cleanedName) {
      setJoinError("กรุณากรอกชื่อผู้ช่วยนับ");
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const result = await mobileApi<{
        token: string;
        participant: MobileParticipant;
        session: MobileSessionInfo;
      }>("join", {
        method: "POST",
        body: { code: cleanedCode, displayName: cleanedName },
      });
      localStorage.setItem(NAME_KEY, cleanedName);
      sessionStorage.setItem(TOKEN_KEY, result.token);
      setToken(result.token);
      setParticipant(result.participant);
      setSession(result.session);
      setEntries([]);
      setTotalEntries(0);
      setRevokedError(null);
    } catch (error) {
      setJoinError((error as Error).message);
    } finally {
      setJoining(false);
    }
  }

  function handleLeave() {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setSession(null);
    setParticipant(null);
    setEntries([]);
    setSelectedProduct(null);
    setCameraOpen(false);
    setRevokedError(null);
  }

  function selectProductForEntry(product: MobileProduct) {
    setSelectedProduct(product);
    setSearchResults([]);
    setSelectedUnit(product.baseUnit);
    setQtyInput("1");
    setNoteInput("");
    if (product.lots.length === 1) {
      setSelectedLotId(product.lots[0]!.id);
    } else {
      setSelectedLotId("");
    }
  }

  const submitEntry = useCallback(
    async (lotId: string, unit: string, quantity: string, note: string | null, productName: string) => {
      if (!token) return;
      setSubmitting(true);
      setActionError(null);
      try {
        const result = await mobileApi<{ entry: MobileEntry; sessionLotTotal: string }>("entries", {
          method: "POST",
          token,
          body: { lotId, unit, quantity, note },
        });
        setEntries((prev) => [result.entry, ...prev].slice(0, 100));
        setTotalEntries((prev) => prev + 1);
        showToast(
          `บันทึก ${productName} +${formatQty(quantity)} ${unit} (รวมล็อตนี้ ${formatQty(result.sessionLotTotal)} ${result.entry.baseUnit})`,
          result.entry.id,
        );
        setSelectedProduct(null);
        setSearchText("");
      } catch (error) {
        const code = (error as { code?: string }).code;
        setActionError((error as Error).message);
        if (code === "COUNT_SESSION_PAUSED" || code === "COUNT_SESSION_CLOSED" || code === "PARTICIPANT_REVOKED") {
          void loadState(token);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [token, showToast, loadState],
  );

  const performLookup = useCallback(
    async (rawQuery: string, fromScanner: boolean) => {
      if (!token) return;
      const q = rawQuery.trim();
      if (!q) return;
      setSearching(true);
      setActionError(null);
      try {
        const result = await mobileApi<{ exactBarcode: boolean; items: MobileProduct[] }>(
          `lookup?q=${encodeURIComponent(q)}`,
          { token },
        );
        if (result.items.length === 0) {
          setSearchResults([]);
          setSelectedProduct(null);
          setActionError(`ไม่พบสินค้าที่ตรงกับ "${q}"`);
          return;
        }
        if (result.items.length === 1) {
          const item = result.items[0]!;
          if (item.lots.length === 0) {
            setActionError(`สินค้า "${item.name}" ยังไม่มีล็อตในระบบ (ต้องรับสินค้าเข้าคลังก่อน)`);
            return;
          }
          // Quick Scan (+1) mode: auto-submit when exact barcode + single lot + session OPEN
          if (fromScanner && quickScanMode && result.exactBarcode && item.lots.length === 1 && session?.status === "OPEN") {
            await submitEntry(item.lots[0]!.id, item.baseUnit, "1", null, item.name);
            return;
          }
          selectProductForEntry(item);
          return;
        }
        setSelectedProduct(null);
        setSearchResults(result.items);
      } catch (error) {
        setActionError((error as Error).message);
      } finally {
        setSearching(false);
      }
    },
    [token, quickScanMode, session?.status, submitEntry],
  );

  async function handleDeleteEntry(entryId: string) {
    if (!token) return;
    setActionError(null);
    try {
      await mobileApi(`entries/${entryId}`, { method: "DELETE", token });
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
      setTotalEntries((prev) => Math.max(0, prev - 1));
      setToast(null);
      showToast("ลบรายการนับแล้ว");
    } catch (error) {
      setActionError((error as Error).message);
      void loadState(token);
    }
  }

  function stepQty(delta: number) {
    const current = Number(qtyInput) || 0;
    const next = Math.max(1, current + delta);
    setQtyInput(String(next));
  }

  // --- Join Screen ---
  if (!token || !session || !participant) {
    return (
      <div className="mc-root">
        <header className="mc-header">
          <div>
            <h1 className="mc-header-title">นับสต๊อกผ่านมือถือ · ThePOS</h1>
            <div className="mc-header-sub">เชื่อมต่อผ่าน Wi-Fi ร้าน (ไม่ต้องล็อกอิน)</div>
          </div>
        </header>
        <div className="mc-join-wrap">
          <div className="mc-card">
            <h2 style={{ margin: "0 0 0.35rem", fontSize: "1.2rem" }}>เข้าร่วมรอบการนับสต๊อก</h2>
            <p className="mc-muted" style={{ margin: "0 0 1rem" }}>
              สแกน QR Code จากหน้าจอ POS หรือกรอกรหัส 8 หลัก แล้วระบุชื่อผู้ช่วยนับ
            </p>
            {joinError && (
              <div className="mc-alert mc-alert-error" role="alert" style={{ marginBottom: "0.85rem" }}>
                <AlertTriangle size={18} />
                <span>{joinError}</span>
              </div>
            )}
            <form onSubmit={(e) => void handleJoin(e)}>
              <div className="mc-field">
                <label htmlFor="mc-code">รหัสเข้าร่วมรอบนับ (8 หลัก)</label>
                <input
                  id="mc-code"
                  className="mc-input mc-code-input"
                  placeholder="XXXX-XXXX"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  maxLength={16}
                  autoComplete="off"
                  required
                />
              </div>
              <div className="mc-field">
                <label htmlFor="mc-name">ชื่อผู้ช่วยนับ / ชื่อเครื่อง</label>
                <input
                  id="mc-name"
                  className="mc-input"
                  placeholder="เช่น บี - ชั้นเครื่องดื่ม"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={80}
                  required
                />
              </div>
              <button type="submit" className="mc-btn mc-btn-primary mc-btn-block" disabled={joining}>
                {joining ? "กำลังเชื่อมต่อ..." : "เริ่มนับสต๊อก"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const isOpen = session.status === "OPEN" && !revokedError;

  return (
    <div className="mc-root">
      <header className="mc-header">
        <div style={{ minWidth: 0 }}>
          <h1 className="mc-header-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {session.title}
          </h1>
          <div className="mc-header-sub">
            {session.storeName} · ผู้ช่วยนับ: {participant.displayName}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
          <span className={`mc-status-pill mc-status-${session.status}`}>
            {STATUS_LABELS[session.status]}
          </span>
          <button
            type="button"
            className="mc-btn mc-btn-ghost mc-btn-sm"
            style={{ color: "#e2e8f0", padding: "0.35rem" }}
            aria-label="ออกจากรอบนับ"
            onClick={handleLeave}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="mc-main">
        {revokedError && (
          <div className="mc-alert mc-alert-error" role="alert">
            <AlertTriangle size={18} />
            <div>
              <strong>{revokedError}</strong>
              <div style={{ marginTop: "0.4rem" }}>
                <button type="button" className="mc-btn mc-btn-outline mc-btn-sm" onClick={handleLeave}>
                  กลับหน้ากรอกรหัส
                </button>
              </div>
            </div>
          </div>
        )}

        {!revokedError && session.status === "PAUSED" && (
          <div className="mc-alert mc-alert-warn" role="status">
            <AlertTriangle size={18} />
            <span>ผู้ดูแลปิดการนับชั่วคราว หน้าจอจะปลดล็อกอัตโนมัติเมื่อเปิดให้นับต่อ</span>
          </div>
        )}

        {!revokedError && (session.status === "SUBMITTED" || session.status === "CANCELLED") && (
          <div className="mc-alert mc-alert-error" role="status">
            <CheckCircle2 size={18} />
            <span>รอบการนับนี้{session.status === "SUBMITTED" ? "ส่งใบตรวจนับเรียบร้อยแล้ว" : "ถูกยกเลิกแล้ว"} ไม่สามารถบันทึกเพิ่มเติมได้</span>
          </div>
        )}

        <div className="mc-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "scan"}
            className={`mc-tab${tab === "scan" ? " is-active" : ""}`}
            onClick={() => setTab("scan")}
          >
            สแกน / นับสินค้า
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "history"}
            className={`mc-tab${tab === "history" ? " is-active" : ""}`}
            onClick={() => setTab("history")}
          >
            รายการที่ฉันนับ ({totalEntries})
          </button>
        </div>

        {actionError && (
          <div className="mc-alert mc-alert-error" role="alert">
            <AlertTriangle size={18} />
            <span>{actionError}</span>
          </div>
        )}

        {tab === "scan" && (
          <>
            <div className="mc-card">
              <div className="mc-mode-bar" style={{ marginBottom: "0.75rem" }}>
                <button
                  type="button"
                  className={`mc-btn mc-btn-sm ${cameraOpen ? "mc-btn-outline" : "mc-btn-primary"}`}
                  disabled={!isOpen}
                  onClick={() => setCameraOpen((v) => !v)}
                >
                  <Camera size={16} /> {cameraOpen ? "ปิดกล้อง" : "เปิดกล้องสแกน"}
                </button>

                <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.86rem", fontWeight: 600, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={quickScanMode}
                    onChange={(e) => setQuickScanMode(e.target.checked)}
                  />
                  <Zap size={14} /> สแกนเร็ว (+1 ทันที)
                </label>
              </div>

              <form
                className="mc-search-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void performLookup(searchText, false);
                }}
              >
                <input
                  ref={searchInputRef}
                  className="mc-input"
                  placeholder="สแกนบาร์โค้ด หรือพิมพ์ชื่อ/SKU"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  disabled={!isOpen}
                />
                <button type="submit" className="mc-btn mc-btn-primary" disabled={!isOpen || searching}>
                  <Search size={18} />
                </button>
              </form>
            </div>

            <BarcodeScanner
              active={cameraOpen && isOpen}
              disabled={!isOpen}
              onScan={(code) => {
                setSearchText(code);
                void performLookup(code, true);
              }}
              onClose={() => setCameraOpen(false)}
            />

            {/* Multiple search matches */}
            {searchResults.length > 0 && !selectedProduct && (
              <div className="mc-card">
                <h3 style={{ margin: "0 0 0.6rem", fontSize: "0.98rem" }}>เลือกสินค้า ({searchResults.length})</h3>
                <div className="mc-lot-list">
                  {searchResults.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className="mc-lot-card"
                      onClick={() => {
                        if (product.lots.length === 0) {
                          setActionError(`สินค้า "${product.name}" ยังไม่มีล็อตในระบบ`);
                          return;
                        }
                        selectProductForEntry(product);
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{product.name}</div>
                      <div className="mc-muted">
                        SKU: {product.sku} · หน่วยหลัก: {product.baseUnit} · {product.lots.length} ล็อต
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Selected Product & Lot Form */}
            {selectedProduct && (
              <div className="mc-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem", marginBottom: "0.75rem" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "1.05rem" }}>
                      <Package size={18} /> {selectedProduct.name}
                    </div>
                    <div className="mc-muted">SKU: {selectedProduct.sku} · หน่วยหลัก: {selectedProduct.baseUnit}</div>
                  </div>
                  <button type="button" className="mc-btn mc-btn-ghost mc-btn-sm" onClick={() => setSelectedProduct(null)}>
                    ปิด
                  </button>
                </div>

                {/* Lot Selector */}
                <div className="mc-field">
                  <label>
                    {selectedProduct.lots.length > 1
                      ? `เลือกล็อตสินค้า (${selectedProduct.lots.length} ล็อต)`
                      : "ล็อตสินค้า (เลือกอัตโนมัติ)"}
                  </label>
                  <div className="mc-lot-list">
                    {selectedProduct.lots.map((lot) => {
                      const active = selectedLotId === lot.id;
                      return (
                        <button
                          key={lot.id}
                          type="button"
                          className={`mc-lot-card${active ? " is-selected" : ""}`}
                          onClick={() => setSelectedLotId(lot.id)}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                            <strong>ล็อต {lot.lotNumber}</strong>
                            <span className="mc-muted">
                              {lot.expirationDate ? `หมดอายุ ${lot.expirationDate}` : "ไม่ระบุวันหมดอายุ"}
                            </span>
                          </div>
                          <div className="mc-muted" style={{ marginTop: 3 }}>
                            นับรวมในรอบนี้: <strong>{formatQty(lot.sessionCounted)} {selectedProduct.baseUnit}</strong>
                            {lot.expectedQuantity !== undefined && (
                              <span> · ยอดระบบ: <strong>{formatQty(lot.expectedQuantity)}</strong></span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!selectedLotId) {
                      setActionError("กรุณาเลือกล็อตสินค้าก่อนบันทึก");
                      return;
                    }
                    const trimmed = qtyInput.trim();
                    if (!/^\d{1,9}(\.\d{1,3})?$/.test(trimmed) || Number(trimmed) <= 0) {
                      setActionError("กรุณากรอกจำนวนมากกว่า 0");
                      return;
                    }
                    void submitEntry(selectedLotId, selectedUnit, trimmed, noteInput.trim() || null, selectedProduct.name);
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                    <div className="mc-field">
                      <label htmlFor="mc-qty">จำนวนที่นับเพิ่ม</label>
                      <input
                        id="mc-qty"
                        className="mc-input"
                        inputMode="decimal"
                        value={qtyInput}
                        onChange={(e) => setQtyInput(e.target.value)}
                        required
                      />
                    </div>
                    <div className="mc-field">
                      <label htmlFor="mc-unit">หน่วยนับ</label>
                      <select
                        id="mc-unit"
                        className="mc-select"
                        value={selectedUnit}
                        onChange={(e) => setSelectedUnit(e.target.value)}
                      >
                        {selectedProduct.units.map((u) => (
                          <option key={u.name} value={u.name}>
                            {u.name}{Number(u.multiplier) !== 1 ? ` (×${formatQty(u.multiplier)})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mc-qty-stepper" style={{ marginBottom: "0.85rem" }}>
                    <button type="button" className="mc-btn mc-btn-outline mc-btn-sm" onClick={() => stepQty(-1)}>-1</button>
                    <button type="button" className="mc-btn mc-btn-outline mc-btn-sm" onClick={() => stepQty(1)}>+1</button>
                    <button type="button" className="mc-btn mc-btn-outline mc-btn-sm" onClick={() => stepQty(5)}>+5</button>
                    <button type="button" className="mc-btn mc-btn-outline mc-btn-sm" onClick={() => stepQty(10)}>+10</button>
                  </div>

                  <div className="mc-field">
                    <label htmlFor="mc-note">หมายเหตุ (ไม่บังคับ)</label>
                    <input
                      id="mc-note"
                      className="mc-input"
                      placeholder="เช่น ชั้นวาง A2 หรือหลังร้าน"
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      maxLength={200}
                    />
                  </div>

                  <button type="submit" className="mc-btn mc-btn-primary mc-btn-block" disabled={!isOpen || submitting || !selectedLotId}>
                    {submitting ? "กำลังบันทึก..." : "บันทึกยอดนับ"}
                  </button>
                </form>
              </div>
            )}
          </>
        )}

        {tab === "history" && (
          <div className="mc-card">
            <h3 style={{ margin: "0 0 0.5rem", display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "1rem" }}>
              <ClipboardList size={18} /> รายการล่าสุดของฉัน ({entries.length})
            </h3>
            {entries.length === 0 ? (
              <p className="mc-muted">ยังไม่มีรายการที่บันทึก</p>
            ) : (
              <div>
                {entries.map((entry) => (
                  <div key={entry.id} className="mc-entry-row">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{entry.productName}</div>
                      <div className="mc-muted">
                        ล็อต {entry.lotNumber} · <strong>+{formatQty(entry.inputQuantity)} {entry.unitName}</strong>
                        {entry.unitName !== entry.baseUnit ? ` (= ${formatQty(entry.baseQuantity)} ${entry.baseUnit})` : ""}
                      </div>
                      {entry.note && <div className="mc-muted">หมายเหตุ: {entry.note}</div>}
                    </div>
                    {isOpen && (
                      <button
                        type="button"
                        className="mc-btn mc-btn-danger mc-btn-sm"
                        aria-label="ลบรายการ"
                        onClick={() => void handleDeleteEntry(entry.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {toast && (
        <div className="mc-toast" role="status">
          <span style={{ fontSize: "0.9rem" }}>{toast.message}</span>
          {toast.undoEntryId && isOpen && (
            <button
              type="button"
              className="mc-btn mc-btn-sm"
              style={{ background: "#334155", color: "#fff", whiteSpace: "nowrap" }}
              onClick={() => void handleDeleteEntry(toast.undoEntryId!)}
            >
              ยกเลิก
            </button>
          )}
        </div>
      )}
    </div>
  );
}
