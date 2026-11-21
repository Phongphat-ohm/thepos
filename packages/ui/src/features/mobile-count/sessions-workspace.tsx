import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Pause,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Send,
  Smartphone,
  Trash2,
  UserX,
  XCircle,
} from "lucide-react";
import { countSessionCreateInput, countSessionFinalizeInput } from "@thepos/contracts";
import { Field } from "@/components/common/fields";
import { Loading } from "@/components/common/loading";
import { Modal } from "@/components/common/modal";
import type { Page, Run } from "@/components/data-table/table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { confirmAction, notifyError, notifySuccess } from "@/lib/alerts";
import { retryKey, thaiDate } from "@/lib/format";
import { business, errorMessage } from "@/lib/native";

type SessionStatus = "OPEN" | "PAUSED" | "SUBMITTED" | "CANCELLED";

type SessionListItem = {
  id: string;
  title: string;
  reason: string;
  status: SessionStatus;
  joinCode: string;
  rawJoinCode: string;
  showExpectedQty: boolean;
  stockCountId: string | null;
  createdBy: string;
  participantCount: number;
  entryCount: number;
  lotCount: number;
  createdAt: string;
  pausedAt: string | null;
  closedAt: string | null;
};

type ParticipantItem = {
  id: string;
  displayName: string;
  clientIp: string | null;
  entryCount: number;
  revokedAt: string | null;
  lastSeenAt: string;
  createdAt: string;
};

type SummaryItem = {
  lotId: string;
  lotNumber: string;
  expirationDate: string | null;
  productId: string;
  sku: string;
  productName: string;
  baseUnit: string;
  expected: string;
  counted: string;
  variance: string;
  entryCount: number;
  lastCountedAt: string;
  movementSinceStart: {
    count: number;
    netDelta: string;
    kinds: string[];
  } | null;
};

type EntryItem = {
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
  participantId: string | null;
  participantName: string | null;
  editedByName: string | null;
  createdAt: string;
  updatedAt: string;
};

type SessionDetail = {
  id: string;
  title: string;
  reason: string;
  status: SessionStatus;
  joinCode: string;
  rawJoinCode: string;
  showExpectedQty: boolean;
  stockCountId: string | null;
  createdBy: string;
  createdAt: string;
  pausedAt: string | null;
  closedAt: string | null;
  preferredMobileBaseUrl?: string | null;
  mobileBaseUrls?: string[];
  httpsEnabled?: boolean;
  participants: ParticipantItem[];
  summary: SummaryItem[];
  entries: EntryItem[];
};

const statusLabel: Record<SessionStatus, string> = {
  OPEN: "กำลังเปิดให้นับ",
  PAUSED: "ปิดชั่วคราว",
  SUBMITTED: "ส่งใบตรวจนับแล้ว",
  CANCELLED: "ยกเลิกแล้ว",
};

const statusBadgeStyle: Record<SessionStatus, { background: string; color: string }> = {
  OPEN: { background: "#dcfce7", color: "#166534" },
  PAUSED: { background: "#fef3c7", color: "#92400e" },
  SUBMITTED: { background: "#dbeafe", color: "#1e40af" },
  CANCELLED: { background: "#f1f5f9", color: "#475569" },
};

const dateTimeFmt = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

function formatQty(value: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return num.toLocaleString("th-TH", { maximumFractionDigits: 3 });
}

function QrCodeBox({ url }: { url: string }) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrError, setQrError] = useState(false);

  useEffect(() => {
    let active = true;
    setQrError(false);
    void import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(url, {
          width: 220,
          margin: 2,
          color: { dark: "#0f172a", light: "#ffffff" },
        }),
      )
      .then((dataUrl) => {
        if (active) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (active) {
          setQrDataUrl("");
          setQrError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [url]);

  if (qrDataUrl) {
    return <img src={qrDataUrl} alt={`QR Code สำหรับ ${url}`} width={200} height={200} style={{ borderRadius: 8, background: "#fff" }} />;
  }
  if (qrError) {
    return <p className="form-error">สร้าง QR Code ไม่สำเร็จ</p>;
  }
  return <div className="web-qr-placeholder" aria-label="กำลังสร้าง QR Code" style={{ width: 200, height: 200 }} />;
}

export function MobileCountSessions({
  serverUrl,
  busy,
  run,
  report,
  warn,
}: {
  serverUrl: string;
  busy: boolean;
  run: Run;
  report: (message: string) => void;
  warn: (message: string) => void;
}) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loadingList, setLoadingList] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [showExpectedQty, setShowExpectedQty] = useState(false);

  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [selectedBaseUrl, setSelectedBaseUrl] = useState<string>("");
  const [expandedLotId, setExpandedLotId] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<EntryItem | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editNote, setEditNote] = useState("");

  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizeReason, setFinalizeReason] = useState("");
  const finalizeRetry = useRef<{ payload: string; key: string }>(undefined);

  const cleanBaseUrl = serverUrl.replace(/\/+$/, "");

  const loadList = useCallback(async (nextStatus = statusFilter) => {
    setLoadingList(true);
    try {
      const result = await business<Page<SessionListItem>>("count_sessions", {
        query: { status: nextStatus, limit: 50 },
      });
      setSessions(result.items);
    } catch (error) {
      void notifyError("โหลดรายการรอบนับไม่สำเร็จ", errorMessage(error));
    } finally {
      setLoadingList(false);
    }
  }, [statusFilter]);

  const loadDetail = useCallback(async (id: string, silent = false) => {
    if (!silent) setLoadingDetail(true);
    try {
      const result = await business<SessionDetail>("count_session_detail", { id });
      setDetail(result);
    } catch (error) {
      if (!silent) void notifyError("โหลดรายละเอียดรอบนับไม่สำเร็จ", errorMessage(error));
    } finally {
      if (!silent) setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    void loadList(statusFilter);
  }, [loadList, statusFilter]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // Live auto-refresh every 4s while viewing an active session
  useEffect(() => {
    if (!selectedId || !detail || (detail.status !== "OPEN" && detail.status !== "PAUSED")) return;
    const timer = window.setInterval(() => {
      void loadDetail(selectedId, true);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [selectedId, detail?.status, loadDetail]);

  const availableBaseUrls = useMemo(() => {
    const urls = detail?.mobileBaseUrls?.length ? detail.mobileBaseUrls : [];
    return urls.length > 0 ? urls : [cleanBaseUrl];
  }, [detail?.mobileBaseUrls, cleanBaseUrl]);

  const effectiveBaseUrl = useMemo(() => {
    if (selectedBaseUrl && availableBaseUrls.includes(selectedBaseUrl)) return selectedBaseUrl;
    return detail?.preferredMobileBaseUrl || availableBaseUrls[0] || cleanBaseUrl;
  }, [selectedBaseUrl, availableBaseUrls, detail?.preferredMobileBaseUrl, cleanBaseUrl]);

  const joinUrl = useMemo(() => {
    if (!detail) return "";
    return `${effectiveBaseUrl.replace(/\/+$/, "")}/stock-count?code=${encodeURIComponent(detail.rawJoinCode)}`;
  }, [effectiveBaseUrl, detail]);

  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(effectiveBaseUrl);
  const isPlainLanHttp = effectiveBaseUrl.startsWith("http://") && !isLocalhost;
  const isAutoHttps = effectiveBaseUrl.startsWith("https://") && !isLocalhost;

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = countSessionCreateInput.safeParse({ title, reason, showExpectedQty });
    if (!parsed.success) {
      warn("กรุณากรอกชื่อรอบนับและเหตุผลให้ครบถ้วน");
      return;
    }
    await run(async () => {
      const created = await business<SessionListItem>("create_count_session", { input: parsed.data });
      setCreateOpen(false);
      setTitle("");
      setReason("");
      setShowExpectedQty(false);
      report("สร้างรอบนับสต๊อกผ่านมือถือแล้ว");
      await loadList(statusFilter);
      setSelectedId(created.id);
      setQrModalOpen(true);
    });
  }

  async function handleToggleStatus(nextStatus: "OPEN" | "PAUSED" | "CANCELLED") {
    if (!detail) return;
    if (nextStatus === "CANCELLED") {
      const ok = await confirmAction({
        title: "ยกเลิกรอบนับสต๊อกนี้",
        text: "เมื่อยกเลิกแล้ว มือถือทั้งหมดจะถูกตัดการเชื่อมต่อและไม่สามารถส่งเข้าใบตรวจนับได้",
        confirmText: "ยืนยันการยกเลิก",
        danger: true,
      });
      if (!ok) return;
    }
    await run(async () => {
      await business("update_count_session_status", {
        id: detail.id,
        input: { status: nextStatus },
      });
      report(
        nextStatus === "OPEN"
          ? "เปิดให้นับสต๊อกผ่านมือถือแล้ว"
          : nextStatus === "PAUSED"
            ? "ปิดการนับชั่วคราวแล้ว"
            : "ยกเลิกรอบนับสต๊อกแล้ว",
      );
      await Promise.all([loadDetail(detail.id, true), loadList(statusFilter)]);
    });
  }

  async function handleRevokeParticipant(participant: ParticipantItem) {
    if (!detail) return;
    const ok = await confirmAction({
      title: `ยกเลิกสิทธิ์อุปกรณ์ "${participant.displayName}"`,
      text: "เครื่องนี้จะไม่สามารถส่งรายการนับเพิ่มเติมได้ทันที (รายการที่นับไว้แล้วจะยังคงอยู่)",
      confirmText: "ยกเลิกสิทธิ์",
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await business("revoke_count_participant", {
        id: detail.id,
        input: { participantId: participant.id },
      });
      report(`ยกเลิกสิทธิ์ "${participant.displayName}" แล้ว`);
      await loadDetail(detail.id, true);
    });
  }

  async function handleSaveEntryEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !editingEntry) return;
    const trimmedQty = editQty.trim();
    if (!/^\d{1,9}(\.\d{1,3})?$/.test(trimmedQty) || Number(trimmedQty) <= 0) {
      warn("กรุณากรอกจำนวนมากกว่า 0 (ทศนิยมไม่เกิน 3 ตำแหน่ง)");
      return;
    }
    await run(async () => {
      await business("update_count_session_entry", {
        id: detail.id,
        input: {
          entryId: editingEntry.id,
          unit: editingEntry.unitName,
          quantity: trimmedQty,
          note: editNote.trim() || null,
        },
      });
      setEditingEntry(null);
      report("แก้ไขรายการนับแล้ว");
      await loadDetail(detail.id, true);
    });
  }

  async function handleDeleteEntry(entry: EntryItem) {
    if (!detail) return;
    const ok = await confirmAction({
      title: "ลบรายการนับนี้",
      text: `${entry.productName} (ล็อต ${entry.lotNumber}) จำนวน ${formatQty(entry.inputQuantity)} ${entry.unitName}`,
      confirmText: "ลบรายการ",
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await business("delete_count_session_entry", {
        id: detail.id,
        input: { entryId: entry.id },
      });
      report("ลบรายการนับแล้ว");
      await loadDetail(detail.id, true);
    });
  }

  async function handleFinalize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const lines = detail.summary.map((row) => ({
      lotId: row.lotId,
      expected: row.expected,
      counted: row.counted,
    }));
    const payload = {
      reason: finalizeReason.trim() || detail.reason,
      lines,
    };
    const parsed = countSessionFinalizeInput.safeParse(payload);
    if (!parsed.success) {
      warn("ต้องมีรายการที่นับอย่างน้อย 1 ล็อต (ไม่เกิน 1,000 ล็อต) และระบุเหตุผลให้ครบ");
      return;
    }
    await run(async () => {
      await business("finalize_count_session", {
        id: detail.id,
        key: retryKey(finalizeRetry, { sessionId: detail.id, ...parsed.data }),
        input: parsed.data,
      });
      finalizeRetry.current = undefined;
      setFinalizeOpen(false);
      report("ปิดรอบและส่งใบตรวจนับให้ผู้จัดการพิจารณาแล้ว");
      await Promise.all([loadDetail(detail.id, true), loadList(statusFilter)]);
    });
  }

  async function copyLink() {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      notifySuccess("คัดลอกลิงก์นับสต๊อกแล้ว");
    } catch {
      void notifyError("คัดลอกลิงก์ไม่สำเร็จ");
    }
  }

  const movementWarnCount = detail ? detail.summary.filter((r) => r.movementSinceStart).length : 0;
  const varianceCount = detail ? detail.summary.filter((r) => Number(r.variance) !== 0).length : 0;
  const isEditable = detail?.status === "OPEN" || detail?.status === "PAUSED";

  return (
    <div className="form-stack">
      <div className="surface" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <Select
            label="สถานะรอบนับ"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">ทั้งหมด</option>
            <option value="OPEN">กำลังเปิดให้นับ</option>
            <option value="PAUSED">ปิดชั่วคราว</option>
            <option value="SUBMITTED">ส่งใบตรวจนับแล้ว</option>
            <option value="CANCELLED">ยกเลิกแล้ว</option>
          </Select>
          <Button type="button" variant="outline" loading={loadingList} onClick={() => void loadList(statusFilter)}>
            <RefreshCw size={15} /> รีเฟรช
          </Button>
        </div>
        <Button type="button" className="primary-action" disabled={busy} onClick={() => setCreateOpen(true)}>
          <Plus size={16} /> สร้างรอบนับผ่านมือถือ
        </Button>
      </div>

      {/* Session List */}
      <div className="surface">
        <div className="surface-heading">
          <h2>รอบการนับสต๊อกผ่านมือถือ</h2>
          <p className="stock-help">เลือกรอบเพื่อดู QR Code, ควบคุมการเปิด-ปิดให้นับ, และตรวจสอบยอดนับแบบเรียลไทม์</p>
        </div>
        {loadingList && sessions.length === 0 ? (
          <Loading label="กำลังโหลดรายการรอบนับ" />
        ) : sessions.length === 0 ? (
          <p className="stock-help">ยังไม่มีรอบการนับสต๊อกผ่านมือถือ กดปุ่ม &quot;สร้างรอบนับผ่านมือถือ&quot; เพื่อเริ่มต้น</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>ชื่อรอบนับ</th>
                  <th>รหัสเข้าร่วม</th>
                  <th>สถานะ</th>
                  <th>โหมดมือถือ</th>
                  <th>อุปกรณ์</th>
                  <th>นับแล้ว</th>
                  <th>สร้างเมื่อ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((item) => {
                  const badge = statusBadgeStyle[item.status];
                  const active = selectedId === item.id;
                  return (
                    <tr
                      key={item.id}
                      style={active ? { background: "rgba(37, 99, 235, 0.06)" } : undefined}
                    >
                      <td>
                        <strong>{item.title}</strong>
                        <div className="stock-help" style={{ margin: 0 }}>{item.reason}</div>
                      </td>
                      <td><code style={{ fontWeight: 700, fontSize: "0.95rem" }}>{item.joinCode}</code></td>
                      <td>
                        <span style={{ ...badge, padding: "0.2rem 0.6rem", borderRadius: 999, fontSize: "0.8rem", fontWeight: 600 }}>
                          {statusLabel[item.status]}
                        </span>
                      </td>
                      <td>{item.showExpectedQty ? "เห็นยอดระบบ" : "Blind Count"}</td>
                      <td>{item.participantCount} เครื่อง</td>
                      <td>{item.lotCount} ล็อต ({item.entryCount} ครั้ง)</td>
                      <td>{dateTimeFmt.format(new Date(item.createdAt))}</td>
                      <td>
                        <Button
                          type="button"
                          variant={active ? "default" : "outline"}
                          onClick={() => setSelectedId(item.id)}
                        >
                          {active ? "กำลังดูอยู่" : "เปิดจัดการ"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Selected Session Detail */}
      {selectedId && (
        <div className="surface form-stack">
          {loadingDetail && !detail ? (
            <Loading label="กำลังโหลดรายละเอียดรอบนับ" />
          ) : detail ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
                    <h2 style={{ margin: 0 }}>{detail.title}</h2>
                    <span
                      style={{
                        ...statusBadgeStyle[detail.status],
                        padding: "0.25rem 0.7rem",
                        borderRadius: 999,
                        fontSize: "0.85rem",
                        fontWeight: 600,
                      }}
                    >
                      {statusLabel[detail.status]}
                    </span>
                    <span style={{ fontSize: "0.85rem", color: "var(--muted-foreground)" }}>
                      {detail.showExpectedQty ? "แสดงยอดระบบบนมือถือ" : "Blind Count (ซ่อนยอดระบบบนมือถือ)"}
                    </span>
                  </div>
                  <p className="stock-help" style={{ marginTop: "0.35rem" }}>
                    เหตุผล: {detail.reason} · สร้างโดย {detail.createdBy} · รหัสเข้าร่วม: <strong>{detail.joinCode}</strong>
                  </p>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  <Button type="button" variant="outline" onClick={() => setQrModalOpen(true)}>
                    <QrCode size={16} /> แสดง QR Code
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void loadDetail(detail.id)}>
                    <RefreshCw size={15} /> อัปเดตยอด
                  </Button>
                  {detail.status === "OPEN" && (
                    <Button type="button" variant="outline" disabled={busy} onClick={() => void handleToggleStatus("PAUSED")}>
                      <Pause size={15} /> ปิดชั่วคราว
                    </Button>
                  )}
                  {detail.status === "PAUSED" && (
                    <Button type="button" className="primary-action" disabled={busy} onClick={() => void handleToggleStatus("OPEN")}>
                      <Play size={15} /> เปิดให้นับต่อ
                    </Button>
                  )}
                  {isEditable && (
                    <>
                      <Button
                        type="button"
                        className="primary-action"
                        disabled={busy || detail.summary.length === 0}
                        onClick={() => {
                          setFinalizeReason(detail.reason);
                          setFinalizeOpen(true);
                        }}
                      >
                        <Send size={15} /> ปิดรอบและส่งใบตรวจนับ ({detail.summary.length} ล็อต)
                      </Button>
                      <Button type="button" variant="outline" disabled={busy} onClick={() => void handleToggleStatus("CANCELLED")}>
                        <XCircle size={15} /> ยกเลิกรอบ
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {movementWarnCount > 0 && (
                <div className="notice" role="status" style={{ background: "#fffbeb", borderColor: "#f59e0b", color: "#92400e" }}>
                  <AlertTriangle size={18} />
                  <span>
                    พบ <strong>{movementWarnCount} ล็อต</strong> ที่มีการขาย/รับเข้าเกิดขึ้นระหว่างช่วงเวลาที่เปิดรอบนับ กรุณาตรวจสอบยอดล่าสุดก่อนกดส่งใบตรวจนับ
                  </span>
                </div>
              )}

              {/* Participants */}
              <div>
                <h3 style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginBottom: "0.5rem" }}>
                  <Smartphone size={17} /> อุปกรณ์มือถือที่เชื่อมต่อ ({detail.participants.length})
                </h3>
                {detail.participants.length === 0 ? (
                  <p className="stock-help">ยังไม่มีมือถือเข้าร่วม กด &quot;แสดง QR Code&quot; เพื่อสแกนจากมือถือในวง Wi-Fi เดียวกัน</p>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
                    {detail.participants.map((p) => (
                      <div
                        key={p.id}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: "0.6rem 0.85rem",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.75rem",
                          opacity: p.revokedAt ? 0.6 : 1,
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600 }}>
                            {p.displayName} {p.revokedAt ? "(ถูกยกเลิกสิทธิ์)" : ""}
                          </div>
                          <div className="stock-help" style={{ margin: 0, fontSize: "0.8rem" }}>
                            IP: {p.clientIp ?? "-"} · นับแล้ว {p.entryCount} ครั้ง · ล่าสุด {dateTimeFmt.format(new Date(p.lastSeenAt))}
                          </div>
                        </div>
                        {!p.revokedAt && isEditable && (
                          <Button type="button" variant="outline" disabled={busy} onClick={() => void handleRevokeParticipant(p)}>
                            <UserX size={14} /> ตัดสิทธิ์
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Aggregated Lot Summary */}
              <div>
                <h3 style={{ marginBottom: "0.5rem" }}>
                  สรุปยอดนับรายล็อต ({detail.summary.length} ล็อต · ผลต่าง {varianceCount} ล็อต)
                </h3>
                {detail.summary.length === 0 ? (
                  <p className="stock-help">ยังไม่มีรายการที่สแกนนับเข้ามา</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>สินค้า</th>
                          <th>ล็อต / วันหมดอายุ</th>
                          <th style={{ textAlign: "right" }}>ยอดระบบล่าสุด</th>
                          <th style={{ textAlign: "right" }}>ยอดที่นับรวม</th>
                          <th style={{ textAlign: "right" }}>ผลต่าง</th>
                          <th>การเคลื่อนไหวระหว่างนับ</th>
                          <th>รายการย่อย</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.summary.map((row) => {
                          const varianceNum = Number(row.variance);
                          const expanded = expandedLotId === row.lotId;
                          const lotEntries = detail.entries.filter((e) => e.lotId === row.lotId);
                          return (
                            <Fragment key={row.lotId}>
                              <tr>
                                <td>
                                  <strong>{row.productName}</strong>
                                  <div className="stock-help" style={{ margin: 0 }}>SKU: {row.sku}</div>
                                </td>
                                <td>
                                  <div>{row.lotNumber}</div>
                                  <div className="stock-help" style={{ margin: 0 }}>
                                    {row.expirationDate ? `หมดอายุ ${thaiDate(row.expirationDate)}` : "ไม่ระบุวันหมดอายุ"}
                                  </div>
                                </td>
                                <td style={{ textAlign: "right" }}>{formatQty(row.expected)} {row.baseUnit}</td>
                                <td style={{ textAlign: "right", fontWeight: 700 }}>{formatQty(row.counted)} {row.baseUnit}</td>
                                <td
                                  style={{
                                    textAlign: "right",
                                    fontWeight: 700,
                                    color: varianceNum === 0 ? "#166534" : varianceNum > 0 ? "#1d4ed8" : "#b91c1c",
                                  }}
                                >
                                  {varianceNum > 0 ? "+" : ""}{formatQty(row.variance)}
                                </td>
                                <td>
                                  {row.movementSinceStart ? (
                                    <span style={{ background: "#fef3c7", color: "#92400e", padding: "0.2rem 0.5rem", borderRadius: 6, fontSize: "0.8rem", fontWeight: 600 }}>
                                      เคลื่อนไหว {row.movementSinceStart.count} ครั้ง ({Number(row.movementSinceStart.netDelta) > 0 ? "+" : ""}{formatQty(row.movementSinceStart.netDelta)})
                                    </span>
                                  ) : (
                                    <span style={{ color: "#166534", fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: 4 }}>
                                      <CheckCircle2 size={14} /> ปกติ
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setExpandedLotId(expanded ? null : row.lotId)}
                                  >
                                    {expanded ? "ซ่อน" : `ดู ${row.entryCount} รายการ`}
                                  </Button>
                                </td>
                              </tr>
                              {expanded && (
                                <tr key={`${row.lotId}-entries`}>
                                  <td colSpan={7} style={{ background: "#f8fafc", padding: "0.75rem 1rem" }}>
                                    <div style={{ display: "grid", gap: "0.45rem" }}>
                                      {lotEntries.map((entry) => (
                                        <div
                                          key={entry.id}
                                          style={{
                                            display: "flex",
                                            flexWrap: "wrap",
                                            gap: "0.6rem",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            padding: "0.4rem 0.65rem",
                                            background: "#fff",
                                            border: "1px solid var(--border)",
                                            borderRadius: 8,
                                          }}
                                        >
                                          <div>
                                            <strong>{formatQty(entry.inputQuantity)} {entry.unitName}</strong>
                                            {entry.unitName !== entry.baseUnit && (
                                              <span> (= {formatQty(entry.baseQuantity)} {entry.baseUnit})</span>
                                            )}
                                            <span className="stock-help" style={{ marginLeft: "0.6rem" }}>
                                              โดย {entry.participantName ?? "Desktop"} · {dateTimeFmt.format(new Date(entry.createdAt))}
                                              {entry.note ? ` · หมายเหตุ: ${entry.note}` : ""}
                                              {entry.editedByName ? ` · แก้ไขโดย ${entry.editedByName}` : ""}
                                            </span>
                                          </div>
                                          {isEditable && (
                                            <div style={{ display: "flex", gap: "0.4rem" }}>
                                              <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => {
                                                  setEditingEntry(entry);
                                                  setEditQty(String(Number(entry.inputQuantity)));
                                                  setEditNote(entry.note ?? "");
                                                }}
                                              >
                                                แก้ไข
                                              </Button>
                                              <Button
                                                type="button"
                                                variant="outline"
                                                disabled={busy}
                                                onClick={() => void handleDeleteEntry(entry)}
                                              >
                                                <Trash2 size={14} /> ลบ
                                              </Button>
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Create Session Modal */}
      {createOpen && (
        <Modal title="สร้างรอบนับสต๊อกผ่านมือถือ" size="sm" close={() => setCreateOpen(false)}>
          <form className="form-stack" onSubmit={(e) => void handleCreate(e)}>
            <Field
              label="ชื่อรอบการนับ"
              placeholder="เช่น ตรวจนับสต๊อกประจำเดือน พ.ย. 69"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
            />
            <Field
              label="เหตุผล / หมายเหตุใบตรวจนับ"
              placeholder="เช่น ตรวจนับประจำเดือนก่อนปิดงวด"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={400}
              required
            />
            <label style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showExpectedQty}
                onChange={(e) => setShowExpectedQty(e.target.checked)}
                style={{ marginTop: 4 }}
              />
              <span>
                <strong>แสดงยอดคงเหลือในระบบบนมือถือ</strong>
                <div className="stock-help" style={{ margin: 0 }}>
                  หากปิดไว้ (แนะนำ / Blind Count) มือถือจะเห็นเฉพาะยอดที่นับได้ เพื่อป้องกันการกรอกตัวเลขตามระบบโดยไม่นับจริง
                </div>
              </span>
            </label>
            <div className="form-actions">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>ยกเลิก</Button>
              <Button type="submit" className="primary-action" loading={busy}>สร้างรอบและเปิดให้นับ</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* QR Code Modal */}
      {qrModalOpen && detail && (
        <Modal title={`QR Code นับสต๊อก · ${detail.title}`} size="sm" close={() => setQrModalOpen(false)}>
          <div className="form-stack" style={{ alignItems: "center", textAlign: "center" }}>
            <p className="stock-help" style={{ margin: 0 }}>
              ให้มือถือเชื่อมต่อ <strong>Wi-Fi เดียวกับเครื่อง POS</strong> แล้วสแกน QR Code ด้านล่าง (ไม่ต้องล็อกอิน)
            </p>
            <div className="web-qr-frame">
              <QrCodeBox url={joinUrl} />
              <div style={{ marginTop: "0.5rem", fontSize: "1.4rem", fontWeight: 800, letterSpacing: "0.12em" }}>
                {detail.joinCode}
              </div>
              <code className="web-qr-url" style={{ wordBreak: "break-all" }}>{joinUrl}</code>
            </div>
            {availableBaseUrls.length > 1 && (
              <div style={{ width: "100%", textAlign: "left" }}>
                <Select
                  label="เลือกที่อยู่ IP / โปรโตคอล (หากมีหลายการ์ดเครือข่าย)"
                  value={effectiveBaseUrl}
                  onChange={(e) => setSelectedBaseUrl(e.target.value)}
                >
                  {availableBaseUrls.map((u) => (
                    <option key={u} value={u}>
                      {u.startsWith("https://") ? `${u} (แนะนำ · เปิดกล้องสแกนได้)` : `${u} (HTTP)`}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {isAutoHttps && (
              <p className="notice" role="status">
                พร้อมใช้งาน HTTPS อัตโนมัติ — หากเบราว์เซอร์บนมือถือแจ้งเตือนใบรับรองความปลอดภัยครั้งแรก ให้กด &quot;ขั้นสูง → ไปยังเว็บไซต์&quot; (Proceed) แล้วเปิดกล้องสแกนบาร์โค้ดได้ทันที
              </p>
            )}
            {isLocalhost && (
              <p className="notice" role="status">
                ไม่พบ IP วง LAN บนเครื่องเซิร์ฟเวอร์ — ตรวจสอบการเชื่อมต่อ Wi-Fi/LAN ของเครื่องเซิร์ฟเวอร์ หรือตั้งค่า API_HOST=0.0.0.0 ใน .env
              </p>
            )}
            {isPlainLanHttp && (
              <p className="notice" role="status">
                ลิงก์นี้เป็น HTTP ธรรมดา — มือถือสามารถพิมพ์ค้นหาหรือใช้สแกนเนอร์ Bluetooth ได้ทันที หากต้องการใช้กล้องมือถือสแกนบาร์โค้ด กรุณาเลือกที่อยู่ https:// ด้านบน
              </p>
            )}
            <div className="form-actions" style={{ width: "100%", justifyContent: "center" }}>
              <Button type="button" variant="outline" onClick={() => void copyLink()}>
                <Copy size={16} /> คัดลอกลิงก์
              </Button>
              <Button type="button" className="primary-action" onClick={() => setQrModalOpen(false)}>
                ปิดหน้าต่าง
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Entry Modal */}
      {editingEntry && (
        <Modal title="แก้ไขรายการนับ" size="sm" close={() => setEditingEntry(null)}>
          <form className="form-stack" onSubmit={(e) => void handleSaveEntryEdit(e)}>
            <p style={{ margin: 0 }}>
              <strong>{editingEntry.productName}</strong> (ล็อต {editingEntry.lotNumber})
            </p>
            <Field
              label={`จำนวน (${editingEntry.unitName})`}
              value={editQty}
              onChange={(e) => setEditQty(e.target.value)}
              inputMode="decimal"
              required
            />
            <Field
              label="หมายเหตุ (ถ้ามี)"
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              maxLength={200}
            />
            <div className="form-actions">
              <Button type="button" variant="outline" onClick={() => setEditingEntry(null)}>ยกเลิก</Button>
              <Button type="submit" className="primary-action" loading={busy}>บันทึกการแก้ไข</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Finalize Modal */}
      {finalizeOpen && detail && (
        <Modal title="ปิดรอบและส่งใบตรวจนับให้ผู้จัดการ" size="sm" close={() => setFinalizeOpen(false)}>
          <form className="form-stack" onSubmit={(e) => void handleFinalize(e)}>
            <p style={{ margin: 0 }}>
              ระบบจะปิดรอบ <strong>{detail.title}</strong> และสร้าง <strong>ใบตรวจนับสต็อก (รออนุมัติ)</strong> จำนวน{" "}
              <strong>{detail.summary.length} ล็อต</strong> (มีผลต่าง {varianceCount} ล็อต)
            </p>
            {movementWarnCount > 0 && (
              <div className="notice" role="status" style={{ background: "#fffbeb", borderColor: "#f59e0b", color: "#92400e" }}>
                <AlertTriangle size={16} />
                <span>มี {movementWarnCount} ล็อตที่มีการเคลื่อนไหวระหว่างนับ ระบบจะเปรียบเทียบกับยอดล่าสุด ณ ตอนกดยืนยัน</span>
              </div>
            )}
            <Field
              label="เหตุผลใบตรวจนับ"
              value={finalizeReason}
              onChange={(e) => setFinalizeReason(e.target.value)}
              maxLength={400}
              required
            />
            <div className="form-actions">
              <Button type="button" variant="outline" onClick={() => setFinalizeOpen(false)}>ยกเลิก</Button>
              <Button type="submit" className="primary-action" loading={busy}>
                <Send size={15} /> ยืนยันส่งใบตรวจนับ
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
