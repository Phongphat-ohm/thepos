import { useEffect, useRef, useState, type FormEvent } from "react";
import { Trash2, UserPlus, Users } from "lucide-react";
import { roleSchema, staffCreateInput, staffUpdateInput, type StaffAccount } from "@thepos/contracts";
import { Field, Password, Pin, Username } from "@/components/common/fields";
import { Modal } from "@/components/common/modal";
import { Pagination, Table, toggleSort, type Page, type SortDir } from "@/components/data-table/table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { confirmAction, notifyError, notifySuccess } from "@/lib/alerts";
import { business, errorMessage } from "@/lib/native";

const roleNames: Record<(typeof roleSchema.options)[number], string> = {
  ADMIN: "ผู้ดูแลระบบ",
  MANAGER: "ผู้จัดการ",
  CASHIER: "แคชเชียร์",
  STOCK_STAFF: "พนักงานคลัง",
};

export function StaffSettingsSection({ userId }: { userId?: string }) {
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
    setLoading(true);
    setError("");
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

  useEffect(() => {
    void load({ q, status, page, pageSize, sortBy, sortDir });
  }, [q, status, page, pageSize, sortBy, sortDir]);

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
      {error && (
        <div className="register-inline">
          <p role="alert" className="form-error">{error}</p>
          <Button variant="outline" onClick={() => void load()}>ลองโหลดอีกครั้ง</Button>
        </div>
      )}
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
            <td><span className={`status-badge ${account.isActive ? "is-active" : "is-inactive"}`}>{account.isActive ? "ใช้งาน" : "ระงับใช้งาน"}</span></td>
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
                      if (
                        !(await confirmAction({
                          title: `ลบพนักงาน ${account.username}?`,
                          text: `ต้องการลบบัญชี ${account.name} ออกจากระบบใช่หรือไม่`,
                          confirmText: "ลบบัญชี",
                          danger: true,
                        }))
                      )
                        return;
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
