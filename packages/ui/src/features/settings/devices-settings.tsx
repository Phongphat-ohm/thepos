import { useEffect, useRef, useState, type FormEvent } from "react";
import { LogOut, Monitor, Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { deviceCreateInput, deviceUpdateInput, type RegisteredDevice } from "@thepos/contracts";
import { Field, Pin } from "@/components/common/fields";
import { Modal } from "@/components/common/modal";
import { Pagination, Table, toggleSort, type Page, type SortDir } from "@/components/data-table/table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { AdminGateModal, type AdminCredentials } from "@/features/auth/admin-gate-modal";
import { confirmAction, notifyError, notifySuccess } from "@/lib/alerts";
import { thaiDate } from "@/lib/format";
import { business, errorMessage } from "@/lib/native";

export function DevicesSettingsSection({
  deviceId,
  serverUrl,
  onSwitchTerminal,
}: {
  deviceId: string;
  serverUrl?: string | null;
  onSwitchTerminal?: (target: "connect" | "register", credentials: AdminCredentials | null) => Promise<void>;
}) {
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [deviceEditor, setDeviceEditor] = useState<RegisteredDevice | "new">();
  const [switchTarget, setSwitchTarget] = useState<"connect" | "register" | null>(null);
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
    setLoading(true);
    setError("");
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

  useEffect(() => {
    void load({ q, status, page, pageSize, sortBy, sortDir });
  }, [q, status, page, pageSize, sortBy, sortDir]);

  return (
    <>
      {onSwitchTerminal && (
        <div className="stock-content">
          <div className="stock-section-title">
            <h2 className="register-inline"><Server size={19} /> การเชื่อมต่อของเครื่อง POS นี้</h2>
          </div>
          <p className="stock-help">
            เซิร์ฟเวอร์ปัจจุบัน: <strong>{serverUrl ?? "—"}</strong> · การเปลี่ยนเซิร์ฟเวอร์หรือเปลี่ยนเครื่อง POS ของเครื่องนี้จะออกจากระบบปัจจุบันและต้องยืนยันรหัสผู้ดูแลระบบ
          </p>
          <div className="register-inline">
            <Button type="button" variant="outline" onClick={() => setSwitchTarget("connect")}>
              <Server size={15} /> เปลี่ยนเซิร์ฟเวอร์
            </Button>
            <Button type="button" variant="outline" onClick={() => setSwitchTarget("register")}>
              <Monitor size={15} /> เปลี่ยนเครื่อง POS
            </Button>
          </div>
        </div>
      )}
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
      {error && (
        <div className="register-inline">
          <p role="alert" className="form-error">{error}</p>
          <Button variant="outline" onClick={() => void load()}>ลองโหลดอีกครั้ง</Button>
        </div>
      )}
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
            <td><span className={`status-badge ${item.isActive ? "is-active" : "is-inactive"}`}>{item.isActive ? "ใช้งาน" : "ระงับใช้งาน"}</span></td>
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
                      if (
                        !(await confirmAction({
                          title: `ตัดเซสชันของ ${item.name}?`,
                          text: `ผู้ใช้งาน ${item.activeUser} จะถูกบังคับออกจากระบบ และเครื่องนี้จะกลับมาว่างให้เลือกใช้งานได้`,
                          confirmText: "ตัดเซสชัน",
                          danger: true,
                        }))
                      )
                        return;
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
                      if (
                        !(await confirmAction({
                          title: `ลบเครื่อง POS ${item.name}?`,
                          text: "เครื่อง POS ที่ยังไม่เคยมีประวัติการขายหรือกะเงินสดจะถูกลบออกจากระบบ",
                          confirmText: "ลบเครื่อง POS",
                          danger: true,
                        }))
                      )
                        return;
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
      {switchTarget && onSwitchTerminal && (
        <AdminGateModal
          target={switchTarget}
          close={() => setSwitchTarget(null)}
          onVerified={(credentials) => {
            const target = switchTarget;
            setSwitchTarget(null);
            void onSwitchTerminal(target, credentials);
          }}
          onServerUnreachable={() => {
            setSwitchTarget(null);
            void onSwitchTerminal("connect", null);
          }}
        />
      )}
    </>
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
      const parsed = deviceCreateInput.safeParse({ name: form.get("name"), pin });
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
