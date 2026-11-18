import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Barcode, LogOut, Monitor, Pencil, Plus, Printer, ReceiptText, RefreshCw, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import {
  auditEventLabels,
  deviceCreateInput,
  deviceUpdateInput,
  roleSchema,
  staffCreateInput,
  staffUpdateInput,
  storeSettingsInput,
  type AuditLogEntry,
  type RegisteredDevice,
  type StaffAccount,
  type StoreSettings,
  type StoreSettingsInput,
} from "@thepos/contracts";
import { Field, Password, Pin, Username } from "@/components/fields";
import { Loading } from "@/components/loading";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { confirmAction, notifyError, notifySuccess } from "@/lib/alerts";
import { business, errorMessage } from "@/lib/native";
import { PrinterDialog, ReceiptView } from "../pos/dialogs";
import { readStored, type Receipt } from "../pos/model";
import { defaultPrintSettings, printReceipt } from "../pos/printing";
import { Pagination, Select, Table, thaiDate, toggleSort, type Page, type SortDir } from "../stock/shared";

const roleNames: Record<(typeof roleSchema.options)[number], string> = {
  ADMIN: "ผู้ดูแลระบบ",
  MANAGER: "ผู้จัดการ",
  CASHIER: "แคชเชียร์",
  STOCK_STAFF: "พนักงานคลัง",
};

export type SettingsView = "store" | "hardware" | "staff" | "devices" | "audit";

export function SettingsWorkspace({
  view,
  userId,
  deviceId,
  onRename,
}: {
  view: SettingsView;
  userId?: string;
  deviceId: string;
  onRename: (name: string) => void;
}) {
  return (
    <section className="stock-workspace" aria-label="การตั้งค่า">
      {view === "store" && <StoreSettingsSection onRename={onRename} />}
      {view === "hardware" && <HardwareSettingsSection deviceId={deviceId} />}
      {view === "staff" && <StaffSettingsSection userId={userId} />}
      {view === "devices" && <DevicesSettingsSection deviceId={deviceId} />}
      {view === "audit" && <AuditLogsSection />}
    </section>
  );
}

function StoreSettingsSection({ onRename }: { onRename: (name: string) => void }) {
  const [store, setStore] = useState<StoreSettings>();
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function load() {
    setLoading(true); setError("");
    try { setStore(await business<StoreSettings>("store_settings")); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function save(input: StoreSettingsInput) {
    if (pending.current) return;
    pending.current = true; setSaving(true);
    try {
      const updated = await business<StoreSettings>("update_store_settings", { input });
      setStore(updated); onRename(updated.name); setEditing(false);
      notifySuccess("บันทึกการตั้งค่าร้านแล้ว");
    } catch (reason) { void notifyError("บันทึกการตั้งค่าไม่สำเร็จ", errorMessage(reason)); }
    finally { pending.current = false; setSaving(false); }
  }

  return (
    <div className="stock-content">
      <div className="stock-section-title">
        <h2>ข้อมูลร้านและใบเสร็จ</h2>
        <Button disabled={!store || loading} onClick={() => setEditing(true)}><Pencil /> แก้ไขข้อมูลร้าน</Button>
      </div>
      {loading && <Loading label="กำลังโหลดการตั้งค่าร้าน" variant="skeleton" />}
      {error && <div className="register-inline"><p role="alert" className="form-error">{error}</p>
        <Button variant="outline" onClick={() => void load()}>ลองโหลดอีกครั้ง</Button></div>}
      {store && (
        <dl className="member-facts">
          <div><dt>ชื่อร้าน</dt><dd>{store.name}</dd></div>
          <div><dt>ที่อยู่</dt><dd>{store.address ?? "—"}</dd></div>
          <div><dt>เลขประจำตัวผู้เสียภาษี</dt><dd>{store.taxId ?? "—"}</dd></div>
          <div><dt>ภาษีมูลค่าเพิ่ม</dt><dd>{store.vatActive ? "เปิดใช้งาน" : "ปิดใช้งาน"}{store.vatRate && ` · อัตราที่บันทึก ${store.vatRate}%`}</dd></div>
          <div><dt>ข้อความหัวใบเสร็จ</dt><dd>{store.receiptHeader ?? "—"}</dd></div>
          <div><dt>ข้อความท้ายใบเสร็จ</dt><dd>{store.receiptFooter ?? "—"}</dd></div>
        </dl>
      )}
      {store?.receiptLogo && (
        <div className="register-inline">
          <span className="label">โลโก้ใบเสร็จ</span>
          <img className="receipt-logo" src={store.receiptLogo} alt="โลโก้ร้าน" />
        </div>
      )}
      {editing && store && <StoreEditor store={store} saving={saving} save={save} close={() => setEditing(false)} />}
    </div>
  );
}

function HardwareSettingsSection({ deviceId }: { deviceId: string }) {
  const key = `thepos/printer/${deviceId}`;
  const [printer, setPrinter] = useState(() => readStored(key, defaultPrintSettings));
  const [store, setStore] = useState<StoreSettings>();
  const [editor, setEditor] = useState<"preview" | "printer">();
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<"printer" | "drawer">();
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function load() {
    setLoading(true); setError("");
    try { setStore(await business<StoreSettings>("store_settings")); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const sample: Receipt | undefined = store && {
    id: "printer-test", invoiceNumber: "PRINTER-TEST", completedAt: new Date().toISOString(),
    storeName: store.name, cashierName: "ทดสอบเครื่องพิมพ์", memberName: null,
    receiptHeader: store.receiptHeader, receiptFooter: store.receiptFooter, receiptLogo: store.receiptLogo,
    subtotal: "0.00", netTotal: "0.00", billDiscount: "0.00", discountTotal: "0.00", payments: [],
    items: [{ id: "printer-test-item", name: "ใบเสร็จทดสอบ", sku: "TEST", unit: "ชิ้น",
      quantity: "1", lineTotal: "0.00", lineDiscount: "0.00", billDiscountShare: "0.00" }],
  };

  async function test(mode: "printer" | "drawer") {
    if (!sample || !printer.printer || pending.current) return;
    pending.current = true;
    try {
      if (mode === "drawer" && !await confirmAction({
        title: "ทดสอบเปิดลิ้นชักเงินสด?",
        text: "เครื่องจะพิมพ์ใบเสร็จทดสอบและส่งคำสั่งเปิดลิ้นชัก",
        confirmText: "ทดสอบเปิดลิ้นชัก",
      })) return;
      setTesting(mode);
      await printReceipt(sample, mode === "drawer" ? { ...printer, drawer: true } : printer, mode === "drawer");
      notifySuccess(mode === "drawer" ? "ส่งคำสั่งทดสอบลิ้นชักแล้ว" : "ส่งใบเสร็จทดสอบเข้าคิวแล้ว");
    } catch (reason) { void notifyError("ทดสอบฮาร์ดแวร์ไม่สำเร็จ", errorMessage(reason)); }
    finally { pending.current = false; setTesting(undefined); }
  }

  return (
    <>
      <div className="stock-content">
        <div className="stock-section-title">
          <h2>เครื่องพิมพ์และลิ้นชัก</h2>
          <Button variant="outline" disabled={!!testing} onClick={() => setEditor("printer")}><Printer /> ตั้งค่าเครื่องพิมพ์</Button>
        </div>
        {loading && <Loading label="กำลังโหลดข้อมูลใบเสร็จสำหรับทดสอบ" variant="inline" />}
        {error && <div className="register-inline"><p role="alert" className="form-error">{error}</p>
          <Button variant="outline" onClick={() => void load()}>ลองโหลดอีกครั้ง</Button></div>}
        <p className="stock-help">{printer.printer || "ยังไม่ได้เลือกคิวพิมพ์"} · {printer.paper} มม.</p>
        <div className="register-inline">
          <Button variant="outline" disabled={!sample || !!testing} onClick={() => setEditor("preview")}><ReceiptText /> ดูตัวอย่างใบเสร็จ</Button>
          <Button variant="outline" disabled={!sample || !printer.printer || !!testing} loading={testing === "printer" && "กำลังส่งงานพิมพ์"} onClick={() => void test("printer")}>พิมพ์ทดสอบ</Button>
          <Button variant="outline" disabled={!sample || !printer.printer || !printer.escpos || !!testing} loading={testing === "drawer" && "กำลังส่งคำสั่ง"} onClick={() => void test("drawer")}>ทดสอบลิ้นชัก</Button>
        </div>
      </div>
      <ScannerTest />
      {editor === "preview" && sample && <Modal title="ตัวอย่างใบเสร็จ" close={() => setEditor(undefined)}>
        <ReceiptView receipt={sample} settings={printer} configure={() => setEditor("printer")} />
      </Modal>}
      {editor === "printer" && <Modal title="ตั้งค่าเครื่องพิมพ์ใบเสร็จ" close={() => setEditor(undefined)}>
        <PrinterDialog value={printer} save={(updated) => {
          try {
            localStorage.setItem(key, JSON.stringify(updated));
            setPrinter(updated); setEditor(undefined); notifySuccess("บันทึกการตั้งค่าเครื่องพิมพ์แล้ว");
          } catch { void notifyError("บันทึกการตั้งค่าเครื่องพิมพ์ไม่สำเร็จ"); }
        }} />
      </Modal>}
    </>
  );
}

function StaffSettingsSection({ userId }: { userId?: string }) {
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [staffEditor, setStaffEditor] = useState<StaffAccount | "new">();
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sortBy, setSortBy] = useState("username");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const seqRef = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(qInput), 220);
    return () => window.clearTimeout(t);
  }, [qInput]);

  async function load(next = { q, status, page, pageSize, sortBy, sortDir }) {
    const seq = ++seqRef.current;
    setLoading(true); setError("");
    try {
      const res = await business<Page<StaffAccount>>("users", {
        query: {
          q: next.q.trim() || undefined,
          status: next.status || undefined,
          page: next.page,
          limit: next.pageSize,
          sortBy: next.sortBy,
          sortDir: next.sortDir,
        },
      });
      if (seq !== seqRef.current) return;
      setStaff(res.items);
      setTotal(res.total ?? res.items.length);
      setTotalPages(res.totalPages ?? 1);
    } catch (reason) {
      if (seq === seqRef.current) setError(errorMessage(reason));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }
  useEffect(() => { void load({ q, status, page, pageSize, sortBy, sortDir }); }, [q, status, page, pageSize, sortBy, sortDir]);

  return (
    <div className="stock-content">
      <div className="stock-section-title">
        <h2 className="register-inline"><Users size={19} /> บัญชีพนักงาน</h2>
        <Button type="button" disabled={loading} onClick={() => setStaffEditor("new")}>
          <UserPlus size={16} /> เพิ่มพนักงาน
        </Button>
      </div>
      <div className="stock-toolbar">
        <Field label="ค้นหาพนักงาน" value={qInput} onChange={(e) => { setQInput(e.target.value); setPage(1); }} placeholder="ชื่อผู้ใช้ หรือ ชื่อที่แสดง" />
        <Select label="สถานะ" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">ทั้งหมด</option>
          <option value="active">ใช้งาน</option>
          <option value="inactive">ระงับใช้งาน</option>
        </Select>
      </div>
      {error && <div className="register-inline"><p role="alert" className="form-error">{error}</p>
        <Button variant="outline" onClick={() => void load()}>ลองโหลดอีกครั้ง</Button></div>}
      <Table
        headings={[
          { label: "ชื่อผู้ใช้", sortKey: "username" },
          { label: "ชื่อที่แสดง", sortKey: "name" },
          "บทบาท",
          { label: "สถานะ", sortKey: "isActive" },
          "จัดการ",
        ]}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={(key) => {
          const next = toggleSort(sortBy, sortDir, key, "asc");
          setSortBy(next.sortBy);
          setSortDir(next.sortDir);
          setPage(1);
        }}
        loading={loading && !staff.length}
        empty={!staff.length ? "ยังไม่มีข้อมูลพนักงาน" : undefined}
      >
        {staff.map((account) => (
          <tr key={account.id}>
            <td><strong>{account.username}</strong></td>
            <td>{account.name}</td>
            <td>{account.roles.map((role) => roleNames[role]).join(", ")}</td>
            <td>{account.isActive ? "ใช้งาน" : "ระงับใช้งาน"}</td>
            <td>
              <div className="register-inline">
                <Button type="button" variant="outline" onClick={() => setStaffEditor(account)} aria-label={`แก้ไขพนักงาน ${account.username}`}>
                  แก้ไข
                </Button>
                {account.canDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`ลบพนักงาน ${account.username}`}
                    onClick={async () => {
                      if (!await confirmAction({
                        title: `ลบพนักงาน ${account.username}?`,
                        text: `ต้องการลบบัญชี ${account.name} ออกจากระบบใช่หรือไม่`,
                        confirmText: "ลบบัญชี",
                        danger: true,
                      })) return;
                      try {
                        await business("delete_user", { id: account.id });
                        notifySuccess("ลบบัญชีพนักงานแล้ว");
                        void load();
                      } catch (reason) {
                        void notifyError("ลบบัญชีพนักงานไม่สำเร็จ", errorMessage(reason));
                      }
                    }}
                  >
                    <Trash2 size={15} /> ลบ
                  </Button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </Table>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        totalPages={totalPages}
        onPageChange={setPage}
        onPageSizeChange={(next) => { setPageSize(next); setPage(1); }}
        disabled={loading}
      />
      {staffEditor && (
        <StaffEditor
          account={staffEditor === "new" ? undefined : staffEditor}
          isSelf={staffEditor !== "new" && staffEditor.id === userId}
          close={() => setStaffEditor(undefined)}
          saved={() => {
            setStaffEditor(undefined);
            notifySuccess("บันทึกข้อมูลพนักงานแล้ว");
            void load();
          }}
        />
      )}
    </div>
  );
}

function DevicesSettingsSection({ deviceId }: { deviceId: string }) {
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [deviceEditor, setDeviceEditor] = useState<RegisteredDevice | "new">();
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const seqRef = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(qInput), 220);
    return () => window.clearTimeout(t);
  }, [qInput]);

  async function load(next = { q, status, page, pageSize, sortBy, sortDir }) {
    const seq = ++seqRef.current;
    setLoading(true); setError("");
    try {
      const res = await business<Page<RegisteredDevice>>("devices", {
        query: {
          q: next.q.trim() || undefined,
          status: next.status || undefined,
          page: next.page,
          limit: next.pageSize,
          sortBy: next.sortBy,
          sortDir: next.sortDir,
        },
      });
      if (seq !== seqRef.current) return;
      setDevices(res.items);
      setTotal(res.total ?? res.items.length);
      setTotalPages(res.totalPages ?? 1);
    } catch (reason) {
      if (seq === seqRef.current) setError(errorMessage(reason));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }
  useEffect(() => { void load({ q, status, page, pageSize, sortBy, sortDir }); }, [q, status, page, pageSize, sortBy, sortDir]);

  return (
    <div className="stock-content">
      <div className="stock-section-title">
        <h2 className="register-inline"><Monitor size={19} /> เครื่อง POS ที่ลงทะเบียน</h2>
        <div className="register-inline">
          <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={15} /> รีเฟรชสถานะ
          </Button>
          <Button type="button" disabled={loading} onClick={() => setDeviceEditor("new")}>
            <Plus size={16} /> เพิ่มเครื่อง POS
          </Button>
        </div>
      </div>
      <div className="stock-toolbar">
        <Field label="ค้นหาชื่อเครื่อง" value={qInput} onChange={(e) => { setQInput(e.target.value); setPage(1); }} placeholder="เช่น เครื่องแคชเชียร์ 1" />
        <Select label="สถานะ" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">ทั้งหมด</option>
          <option value="active">ใช้งาน</option>
          <option value="inactive">ระงับใช้งาน</option>
        </Select>
      </div>
      {error && <div className="register-inline"><p role="alert" className="form-error">{error}</p>
        <Button variant="outline" onClick={() => void load()}>ลองโหลดอีกครั้ง</Button></div>}
      <Table
        headings={[
          { label: "ชื่อเครื่อง", sortKey: "name" },
          "ผู้ใช้งานปัจจุบัน",
          "รหัสเครื่อง 6 หลัก",
          { label: "วันที่ลงทะเบียน", sortKey: "createdAt" },
          { label: "สถานะ", sortKey: "isActive" },
          "จัดการ",
        ]}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={(key) => {
          const next = toggleSort(sortBy, sortDir, key, "asc");
          setSortBy(next.sortBy);
          setSortDir(next.sortDir);
          setPage(1);
        }}
        loading={loading && !devices.length}
        empty={!devices.length ? "ยังไม่มีเครื่องที่ลงทะเบียน" : undefined}
      >
        {devices.map((item) => (
          <tr key={item.id}>
            <td><strong>{item.name}</strong>{item.id === deviceId && <small>เครื่องปัจจุบันของคุณ</small>}</td>
            <td>
              {item.activeUser ? (
                <>
                  <strong>{item.activeUser}</strong>
                  <small>{item.sessionLocked ? "ล็อกหน้าจออยู่" : "กำลังใช้งาน"}</small>
                </>
              ) : (
                <span className="field-hint">ว่าง</span>
              )}
            </td>
            <td>{item.hasPin ? "ตั้งรหัสแล้ว" : "ยังไม่ตั้งรหัส"}</td>
            <td>{thaiDate(item.createdAt)}</td>
            <td>{item.isActive ? "ใช้งาน" : "ระงับใช้งาน"}</td>
            <td>
              <div className="register-inline">
                <Button type="button" variant="outline" onClick={() => setDeviceEditor(item)} aria-label={`แก้ไขเครื่อง ${item.name}`}>
                  แก้ไข
                </Button>
                {item.activeUser && item.id !== deviceId && (
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`ตัดเซสชันเครื่อง ${item.name}`}
                    onClick={async () => {
                      if (!await confirmAction({
                        title: `ตัดเซสชันของ ${item.name}?`,
                        text: `ผู้ใช้งาน ${item.activeUser} จะถูกบังคับออกจากระบบ และเครื่องนี้จะกลับมาว่างให้เลือกใช้งานได้`,
                        confirmText: "ตัดเซสชัน",
                        danger: true,
                      })) return;
                      try {
                        await business<RegisteredDevice>("update_device", {
                          id: item.id,
                          input: { name: item.name, isActive: item.isActive, revokeSessions: true },
                        });
                        notifySuccess("ตัดเซสชันและปลดล็อกเครื่องให้ว่างแล้ว");
                        void load();
                      } catch (reason) {
                        void notifyError("ตัดเซสชันไม่สำเร็จ", errorMessage(reason));
                      }
                    }}
                  >
                    <LogOut size={15} /> ตัดเซสชัน
                  </Button>
                )}
                {item.canDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`ลบเครื่อง ${item.name}`}
                    onClick={async () => {
                      if (!await confirmAction({
                        title: `ลบเครื่อง POS ${item.name}?`,
                        text: "เครื่อง POS ที่ยังไม่เคยมีประวัติการขายหรือกะเงินสดจะถูกลบออกจากระบบ",
                        confirmText: "ลบเครื่อง POS",
                        danger: true,
                      })) return;
                      try {
                        await business("delete_device", { id: item.id });
                        notifySuccess("ลบเครื่อง POS แล้ว");
                        void load();
                      } catch (reason) {
                        void notifyError("ลบเครื่อง POS ไม่สำเร็จ", errorMessage(reason));
                      }
                    }}
                  >
                    <Trash2 size={15} /> ลบ
                  </Button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </Table>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        totalPages={totalPages}
        onPageChange={setPage}
        onPageSizeChange={(next) => { setPageSize(next); setPage(1); }}
        disabled={loading}
      />
      {deviceEditor && (
        <DeviceEditor
          device={deviceEditor === "new" ? undefined : deviceEditor}
          isCurrent={deviceEditor !== "new" && deviceEditor.id === deviceId}
          close={() => setDeviceEditor(undefined)}
          saved={() => {
            setDeviceEditor(undefined);
            notifySuccess("บันทึกข้อมูลเครื่อง POS แล้ว");
            void load();
          }}
        />
      )}
    </div>
  );
}

function AuditLogsSection() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [event, setEvent] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const seqRef = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(qInput), 220);
    return () => window.clearTimeout(t);
  }, [qInput]);

  async function load(next = { q, event, start, end, page, pageSize, sortBy, sortDir }) {
    const seq = ++seqRef.current;
    setLoading(true); setError("");
    try {
      const res = await business<Page<AuditLogEntry>>("audit_logs", {
        query: {
          q: next.q.trim() || undefined,
          event: next.event || undefined,
          start: next.start || undefined,
          end: next.end || undefined,
          page: next.page,
          limit: next.pageSize,
          sortBy: next.sortBy,
          sortDir: next.sortDir,
        },
      });
      if (seq !== seqRef.current) return;
      setLogs(res.items);
      setTotal(res.total ?? res.items.length);
      setTotalPages(res.totalPages ?? 1);
    } catch (reason) {
      if (seq === seqRef.current) setError(errorMessage(reason));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }
  useEffect(() => { void load({ q, event, start, end, page, pageSize, sortBy, sortDir }); }, [q, event, start, end, page, pageSize, sortBy, sortDir]);

  function formatDateTime(value: string) {
    return new Intl.DateTimeFormat("th-TH", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "Asia/Bangkok",
    }).format(new Date(value));
  }

  return (
    <div className="stock-content">
      <div className="stock-section-title">
        <h2 className="register-inline"><ShieldCheck size={19} /> บันทึกตรวจสอบ (Audit Log)</h2>
        <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}>
          <RefreshCw size={15} /> รีเฟรช
        </Button>
      </div>
      <div className="stock-toolbar">
        <Field label="ค้นหา" value={qInput} onChange={(e) => { setQInput(e.target.value); setPage(1); }} placeholder="เหตุการณ์ ผู้ใช้ หรือรายละเอียด" />
        <Select label="ประเภทเหตุการณ์" value={event} onChange={(e) => { setEvent(e.target.value); setPage(1); }}>
          <option value="">ทั้งหมด</option>
          {Object.entries(auditEventLabels).map(([key, label]) => (
            <option key={key} value={key}>{label} ({key})</option>
          ))}
        </Select>
        <Field label="ตั้งแต่วันที่" type="date" value={start} onChange={(e) => { setStart(e.target.value); setPage(1); }} />
        <Field label="ถึงวันที่" type="date" value={end} onChange={(e) => { setEnd(e.target.value); setPage(1); }} />
      </div>
      {error && <div className="register-inline"><p role="alert" className="form-error">{error}</p>
        <Button variant="outline" onClick={() => void load()}>ลองโหลดอีกครั้ง</Button></div>}
      <Table
        headings={[
          { label: "วัน-เวลา", sortKey: "createdAt" },
          { label: "เหตุการณ์", sortKey: "event" },
          "ผู้ดำเนินการ",
          "เครื่อง POS",
          "รายละเอียด",
        ]}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={(key) => {
          const next = toggleSort(sortBy, sortDir, key, "desc");
          setSortBy(next.sortBy);
          setSortDir(next.sortDir);
          setPage(1);
        }}
        loading={loading && !logs.length}
        empty={!logs.length ? "ไม่พบบันทึกตรวจสอบตามเงื่อนไขที่เลือก" : undefined}
      >
        {logs.map((entry) => (
          <tr key={entry.id}>
            <td>{formatDateTime(entry.createdAt)}</td>
            <td>
              <strong>{auditEventLabels[entry.event] ?? entry.event}</strong>
              {auditEventLabels[entry.event] && <small>{entry.event}</small>}
            </td>
            <td>{entry.userName ? `${entry.userName} (${entry.username})` : entry.username ?? "ระบบ"}</td>
            <td>{entry.deviceName ?? "-"}</td>
            <td><div className="audit-meta-cell" title={entry.reason ?? ""}>{entry.reason ?? "-"}</div></td>
          </tr>
        ))}
      </Table>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        totalPages={totalPages}
        onPageChange={setPage}
        onPageSizeChange={(next) => { setPageSize(next); setPage(1); }}
        disabled={loading}
      />
    </div>
  );
}

function StaffEditor({
  account,
  isSelf,
  close,
  saved,
}: {
  account?: StaffAccount;
  isSelf: boolean;
  close: () => void;
  saved: (account: StaffAccount) => void;
}) {
  const [roles, setRoles] = useState<(typeof roleSchema.options)[number][]>(account?.roles ?? ["CASHIER"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggleRole(role: (typeof roleSchema.options)[number], checked: boolean) {
    setRoles((current) => (checked ? [...new Set([...current, role])] : current.filter((item) => item !== role)));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    if (!account) {
      const parsed = staffCreateInput.safeParse({
        username: form.get("username"),
        name: form.get("name"),
        password: form.get("password"),
        pin: form.get("pin"),
        roles,
      });
      if (!parsed.success) {
        setError("ตรวจสอบชื่อผู้ใช้ ชื่อ รหัสผ่าน (อย่างน้อย 12 อักขระ) PIN 6 หลัก และบทบาทอย่างน้อย 1 บทบาท");
        return;
      }
      setBusy(true);
      try {
        saved(await business<StaffAccount>("create_user", { input: parsed.data }));
      } catch (reason) {
        void notifyError("เพิ่มพนักงานไม่สำเร็จ", errorMessage(reason));
      } finally {
        setBusy(false);
      }
      return;
    }

    const password = String(form.get("password") ?? "");
    const pin = String(form.get("pin") ?? "");
    const parsed = staffUpdateInput.safeParse({
      name: form.get("name"),
      roles,
      isActive: isSelf ? true : form.get("status") === "active",
      ...(password && { password }),
      ...(pin && { pin }),
    });
    if (!parsed.success) {
      setError("ตรวจสอบชื่อ บทบาท และรหัสผ่านหรือ PIN ใหม่ที่กรอก");
      return;
    }
    setBusy(true);
    try {
      saved(await business<StaffAccount>("update_user", { id: account.id, input: parsed.data }));
    } catch (reason) {
      void notifyError("บันทึกข้อมูลพนักงานไม่สำเร็จ", errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={account ? `แก้ไขพนักงาน · ${account.username}` : "เพิ่มพนักงานใหม่"} close={close} busy={busy && "กำลังบันทึกข้อมูลพนักงาน"}>
      <form className="form-stack" noValidate onSubmit={(event) => void submit(event)}>
        <div className="field-row">
          {!account && <Username autoFocus />}
          <Field label="ชื่อที่แสดง" name="name" required maxLength={120} defaultValue={account?.name} autoFocus={!!account} />
          {account && !isSelf && (
            <Select label="สถานะบัญชี" name="status" defaultValue={account.isActive ? "active" : "inactive"}>
              <option value="active">ใช้งาน</option>
              <option value="inactive">ระงับใช้งาน</option>
            </Select>
          )}
        </div>
        <fieldset className="form-group">
          <legend>บทบาทและสิทธิ์การทำงาน</legend>
          <div className="stock-flags">
            {roleSchema.options.map((role) => (
              <label key={role}>
                <input
                  type="checkbox"
                  checked={roles.includes(role)}
                  disabled={isSelf && role === "ADMIN"}
                  onChange={(event) => toggleRole(role, event.target.checked)}
                />{" "}
                {roleNames[role]}
              </label>
            ))}
          </div>
        </fieldset>
        {!account ? (
          <>
            <Password isNew />
            <Pin hint="ใช้ตัวเลข 6 หลักสำหรับปลดล็อกหน้าจอและอนุมัติรายการ" />
          </>
        ) : (
          <div className="field-row">
            <Field label="ตั้งรหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)" name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" />
            <Field label="ตั้ง PIN 6 หลักใหม่ (เว้นว่างหากไม่เปลี่ยน)" name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="off" />
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>ยกเลิก</Button>
          <Button type="submit" disabled={busy}>บันทึกข้อมูลพนักงาน</Button>
        </div>
      </form>
    </Modal>
  );
}

function DeviceEditor({
  device,
  isCurrent,
  close,
  saved,
}: {
  device?: RegisteredDevice;
  isCurrent: boolean;
  close: () => void;
  saved: (device: RegisteredDevice) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pin = String(form.get("pin") ?? "").trim();
    if (!device) {
      const parsed = deviceCreateInput.safeParse({
        name: form.get("name"),
        pin,
      });
      if (!parsed.success) {
        setError("กรุณาระบุชื่อเครื่อง POS และตั้งรหัสเครื่อง 6 หลัก");
        return;
      }
      setBusy(true);
      setError("");
      try {
        saved(await business<RegisteredDevice>("create_device", { input: parsed.data }));
      } catch (reason) {
        void notifyError("เพิ่มเครื่อง POS ไม่สำเร็จ", errorMessage(reason));
      } finally {
        setBusy(false);
      }
      return;
    }

    const parsed = deviceUpdateInput.safeParse({
      name: form.get("name"),
      isActive: isCurrent ? true : form.get("status") === "active",
      ...(pin ? { pin } : {}),
    });
    if (!parsed.success) {
      setError("กรุณาตรวจสอบชื่อเครื่อง POS และรหัสเครื่อง 6 หลัก (หากต้องการเปลี่ยน)");
      return;
    }
    setBusy(true);
    setError("");
    try {
      saved(await business<RegisteredDevice>("update_device", { id: device.id, input: parsed.data }));
    } catch (reason) {
      void notifyError("บันทึกข้อมูลเครื่องไม่สำเร็จ", errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={device ? `แก้ไขเครื่อง POS · ${device.name}` : "เพิ่มเครื่อง POS ใหม่"} size="sm" close={close} busy={busy && "กำลังบันทึกข้อมูลเครื่อง"}>
      <form className="form-stack" noValidate onSubmit={(event) => void submit(event)}>
        <Field label="ชื่อเครื่อง POS" name="name" required maxLength={120} defaultValue={device?.name} placeholder="เช่น จุดขาย 2 หรือ เครื่องผู้จัดการ" autoFocus />
        {device && !isCurrent && (
          <Select label="สถานะเครื่อง" name="status" defaultValue={device.isActive ? "active" : "inactive"}>
            <option value="active">ใช้งาน</option>
            <option value="inactive">ระงับใช้งาน</option>
          </Select>
        )}
        {!device ? (
          <Pin label="รหัสเครื่อง 6 หลัก" hint="ใช้สำหรับเลือกเชื่อมต่อเครื่อง POS นี้จากหน้าเข้าสู่ระบบ" />
        ) : (
          <Field
            label="เปลี่ยนรหัสเครื่อง 6 หลัก (เว้นว่างหากใช้รหัสเดิม)"
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="off"
            hint={device.hasPin ? "มีรหัสเครื่อง 6 หลักแล้ว กรอกเฉพาะเมื่อต้องการเปลี่ยนใหม่" : "ยังไม่ได้ตั้งรหัสเครื่อง กรอกตัวเลข 6 หลักเพื่อตั้งรหัส"}
          />
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>ยกเลิก</Button>
          <Button type="submit" disabled={busy}>บันทึกข้อมูลเครื่อง</Button>
        </div>
      </form>
    </Modal>
  );
}

function StoreEditor({ store, saving, save, close }: {
  store: StoreSettings; saving: boolean; save: (input: StoreSettingsInput) => Promise<void>; close: () => void;
}) {
  const [logo, setLogo] = useState(store.receiptLogo);
  const [upload, setUpload] = useState(false);
  const [error, setError] = useState("");

  async function chooseLogo(file: File) {
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 3 * 1024 * 1024) {
      setError("เลือกโลโก้ JPG หรือ PNG ขนาดไม่เกิน 3 MB"); return;
    }
    setUpload(true); setError("");
    try {
      const image = await createImageBitmap(file);
      try {
        const scale = Math.min(1, 160 / image.width, 80 / image.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pngData = canvas.toDataURL("image/png");
        setLogo(pngData.length <= 48_000 ? pngData : canvas.toDataURL("image/jpeg", .85));
      } finally { image.close(); }
    } catch { setError("เปิดไฟล์โลโก้ไม่ได้ กรุณาเลือกไฟล์ใหม่"); }
    finally { setUpload(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || upload) return;
    const form = new FormData(event.currentTarget);
    const input = Object.fromEntries(form);
    const parsed = storeSettingsInput.safeParse({
      ...input, taxId: String(input.taxId ?? "").trim() || null,
      vatRate: String(input.vatRate ?? "").trim() || null, receiptLogo: logo,
    });
    if (!parsed.success) {
      setError("ตรวจสอบชื่อร้าน เลขประจำตัวผู้เสียภาษี 13 หลัก และอัตรา VAT 0–100% ก่อนบันทึก");
      return;
    }
    setError(""); void save(parsed.data);
  }
  return <Modal title="แก้ไขข้อมูลร้านและใบเสร็จ" size="lg" close={close}
    busy={saving ? "กำลังบันทึกการตั้งค่า" : upload && "กำลังเตรียมโลโก้"}>
    <form className="form-stack" onSubmit={submit}>
      <Field label="ชื่อร้าน" name="name" maxLength={120} defaultValue={store.name} autoFocus required />
      <Field label="ที่อยู่ร้าน" name="address" maxLength={400} defaultValue={store.address ?? ""} />
      <div className="field-row">
        <Field label="เลขประจำตัวผู้เสียภาษี" name="taxId" inputMode="numeric" maxLength={13} defaultValue={store.taxId ?? ""} />
        <Field label="อัตรา VAT (%)" name="vatRate" inputMode="decimal" maxLength={6} defaultValue={store.vatRate ?? ""}
          hint="เก็บค่าไว้สำหรับเปิดใช้ในอนาคต ขณะนี้ระบบยังไม่คิด VAT" />
      </div>
      <label className="field"><span className="label">หัวใบเสร็จ</span><textarea className="input" name="receiptHeader" rows={2} maxLength={300} defaultValue={store.receiptHeader ?? ""} /></label>
      <label className="field"><span className="label">ท้ายใบเสร็จ</span><textarea className="input" name="receiptFooter" rows={2} maxLength={300} defaultValue={store.receiptFooter ?? ""} /></label>
      <Field label="โลโก้ใบเสร็จ" type="file" accept="image/png,image/jpeg" onChange={(event) => {
        const file = event.target.files?.[0]; if (file) void chooseLogo(file);
        event.target.value = "";
      }} />
      {logo && <div className="register-inline"><img className="receipt-logo" src={logo} alt="โลโก้ร้าน" />
        <Button type="button" variant="ghost" onClick={() => setLogo(null)}>นำโลโก้ออก</Button></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><Button type="button" variant="ghost" onClick={close}>ยกเลิก</Button>
        <Button type="submit">บันทึกข้อมูลร้าน</Button></div>
    </form>
  </Modal>;
}

function ScannerTest() {
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("Enter");
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  function scan(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.key !== "Enter" && event.key !== "Tab") || !event.currentTarget.value || event.shiftKey) return;
    event.preventDefault();
    const code = event.currentTarget.value;
    event.currentTarget.value = "";
    if (event.key !== suffix) { setResult({ ok: false, text: `เครื่องส่งปุ่มท้าย ${event.key} แต่ตั้งไว้เป็น ${suffix}` }); return; }
    if (!code.startsWith(prefix) || code.length === prefix.length) {
      setResult({ ok: false, text: "ไม่พบรหัสหลังข้อความนำหน้าที่กำหนด" }); return;
    }
    setResult({ ok: true, text: `อ่านบาร์โค้ดได้ ${code.slice(prefix.length)} · ปุ่มท้าย ${suffix}` });
  }
  return <div className="stock-content">
    <h2 className="register-inline"><Barcode size={19} /> ทดสอบเครื่องสแกน</h2>
    <div className="field-row">
      <Field label="ข้อความนำหน้า (ถ้ามี)" value={prefix} onChange={(event) => setPrefix(event.target.value)} maxLength={32} />
      <Select label="ปุ่มท้ายบาร์โค้ด" value={suffix} onChange={(event) => setSuffix(event.target.value)}>
        <option value="Enter">Enter</option><option value="Tab">Tab</option>
      </Select>
    </div>
    <Field label="ช่องทดสอบสแกน" autoComplete="off" maxLength={255} onKeyDown={scan}
      hint="คลิกช่องนี้แล้วสแกนบาร์โค้ด ระบบจะแสดงรหัสและปุ่มท้ายที่ได้รับ" />
    {result && <p className={result.ok ? "stock-success" : "form-error"} role="status">{result.text}</p>}
  </div>;
}
