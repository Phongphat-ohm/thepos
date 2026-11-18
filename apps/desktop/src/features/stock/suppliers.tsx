import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { supplierInput, type Supplier, type SupplierQuery } from "@thepos/contracts";
import { Field, readFields } from "@/components/fields";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/lib/alerts";
import { business, errorMessage } from "@/lib/native";
import { Pagination, Select, Table, toggleSort, type Page, type Run, type SortDir } from "./shared";

type Filter = Pick<SupplierQuery, "q" | "status">;
const initialFilter: Filter = { q: "", status: "all" };

export function Suppliers({ write, busy, run, report }: {
  write: boolean;
  busy: boolean;
  run: Run;
  report: (message: string) => void;
}) {
  const [page, setPage] = useState<Page<Supplier>>();
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<Supplier | "new">();
  const [updating, setUpdating] = useState<string>();
  const applied = useRef(initialFilter);
  const confirming = useRef(false);

  async function load(filter: Filter, nextPage = pageNum, nextLimit = pageSize, nextSortBy = sortBy, nextSortDir = sortDir) {
    setError("");
    try {
      const next = await business<Page<Supplier>>("suppliers", {
        query: { ...filter, page: nextPage, limit: nextLimit, sortBy: nextSortBy, sortDir: nextSortDir },
      });
      setPage(next);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  useEffect(() => {
    void run(() => load(applied.current, pageNum, pageSize, sortBy, sortDir));
  }, [run, pageNum, pageSize, sortBy, sortDir]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    applied.current = { q: String(form.get("q")).trim(), status: form.get("status") as Filter["status"] };
    setPageNum(1);
    void run(() => load(applied.current, 1, pageSize, sortBy, sortDir));
  }

  async function toggle(supplier: Supplier) {
    if (busy || confirming.current) return;
    confirming.current = true;
    try {
      const isActive = !supplier.isActive;
      if (!await confirmAction({
        title: isActive ? "เปิดใช้งานผู้จัดจำหน่าย?" : "พักใช้งานผู้จัดจำหน่าย?",
        text: isActive ? supplier.name : `${supplier.name} จะเลือกไม่ได้ในใบรับเข้าใหม่ ประวัติการรับเข้ายังเปิดดูได้`,
        confirmText: isActive ? "เปิดใช้งาน" : "พักใช้งาน",
        danger: !isActive,
      })) return;
      await run(async () => {
        setUpdating(supplier.id);
        await business<Supplier>("set_supplier_status", { id: supplier.id, input: { isActive } });
        report(isActive ? "เปิดใช้งานผู้จัดจำหน่ายแล้ว" : "พักใช้งานผู้จัดจำหน่ายแล้ว");
        await load(applied.current, pageNum, pageSize, sortBy, sortDir);
      });
    } finally {
      confirming.current = false;
      setUpdating(undefined);
    }
  }

  return <div className="form-stack">
    <div className="stock-section-title">
      <h2>ทะเบียนผู้จัดจำหน่าย</h2>
      {write && <Button type="button" disabled={busy} onClick={() => setEditor("new")}><Plus size={16} /> เพิ่มผู้จัดจำหน่าย</Button>}
    </div>
    <form className="stock-inline stock-search" onSubmit={search}>
      <Field name="q" label="ค้นหาผู้จัดจำหน่าย" placeholder="ชื่อ ผู้ติดต่อ เบอร์โทร หรืออีเมล" maxLength={255} disabled={busy} />
      <Select name="status" label="สถานะ" defaultValue="all" disabled={busy}>
        <option value="all">ทุกสถานะ</option><option value="active">เปิดใช้งาน</option><option value="inactive">พักใช้งาน</option>
      </Select>
      <Button type="submit" variant="outline" disabled={busy} loading={busy && !editor && !updating}>ค้นหา</Button>
    </form>
    {error && <div className="stock-inline">
      <p className="form-error" role="alert">{error}</p>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => load(applied.current, pageNum, pageSize, sortBy, sortDir))}>ลองโหลดอีกครั้ง</Button>
    </div>}
    {(!error || page) && <Table
      headings={[
        { label: "ผู้จัดจำหน่าย", sortKey: "name" },
        { label: "ผู้ติดต่อ", sortKey: "contactName" },
        "โทรศัพท์และอีเมล",
        { label: "สถานะ", sortKey: "isActive" },
        ...(write ? ["จัดการ"] : []),
      ]}
      sortBy={sortBy}
      sortDir={sortDir}
      onSort={(key) => {
        const next = toggleSort(sortBy, sortDir, key, "asc");
        setSortBy(next.sortBy);
        setSortDir(next.sortDir);
        setPageNum(1);
      }}
      loading={!page && !error}
      empty={page?.items.length ? undefined : "ไม่พบผู้จัดจำหน่ายตามเงื่อนไข"}
    >
      {page?.items.map((row) => <tr key={row.id}>
        <td><strong>{row.name}</strong>{row.address && <small>{row.address}</small>}</td>
        <td>{row.contactName ?? "—"}</td>
        <td>{row.phone ?? (row.email ? null : "—")}{row.email && <div>{row.email}</div>}</td>
        <td><span className="shell-meta-pill">{row.isActive ? "เปิดใช้งาน" : "พักใช้งาน"}</span></td>
        {write && <td><div className="register-inline">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setEditor(row)} aria-label={`แก้ไขผู้จัดจำหน่าย ${row.name}`}>แก้ไข</Button>
          <Button type="button" variant="ghost" disabled={busy} loading={updating === row.id} onClick={() => void toggle(row)}
            aria-label={`${row.isActive ? "พักใช้งาน" : "เปิดใช้งาน"} ${row.name}`}>{row.isActive ? "พักใช้งาน" : "เปิดใช้งาน"}</Button>
        </div></td>}
      </tr>)}
    </Table>}
    {page && <Pagination
      page={page.page ?? pageNum}
      pageSize={page.pageSize ?? pageSize}
      total={page.total ?? page.items.length}
      totalPages={page.totalPages ?? 1}
      onPageChange={setPageNum}
      onPageSizeChange={(next) => { setPageSize(next); setPageNum(1); }}
      disabled={busy}
    />}
    {editor && <SupplierEditor supplier={editor === "new" ? undefined : editor} busy={busy} run={run}
      close={() => setEditor(undefined)} saved={async () => {
        setEditor(undefined);
        report(editor === "new" ? "เพิ่มผู้จัดจำหน่ายแล้ว" : "บันทึกข้อมูลผู้จัดจำหน่ายแล้ว");
        await load(applied.current, pageNum, pageSize, sortBy, sortDir);
      }} />}
  </div>;
}

function SupplierEditor({ supplier, busy, run, close, saved }: {
  supplier?: Supplier;
  busy: boolean;
  run: Run;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  function save(event: FormEvent<HTMLFormElement>) {
    const fields = readFields(event, setError);
    if (!fields) return;
    const result = supplierInput.safeParse(fields);
    if (!result.success) {
      setError(result.error.issues[0]?.path[0] === "email" ? "กรุณาตรวจสอบรูปแบบอีเมล" : "กรุณาตรวจสอบชื่อและข้อมูลผู้จัดจำหน่าย");
      return;
    }
    setError("");
    void run(async () => {
      await business<Supplier>(supplier ? "update_supplier" : "create_supplier", { id: supplier?.id, input: result.data });
      await saved();
    });
  }
  return <Modal title={supplier ? "แก้ไขผู้จัดจำหน่าย" : "เพิ่มผู้จัดจำหน่าย"} close={close} busy={busy && "กำลังบันทึกผู้จัดจำหน่าย"}>
    <form className="form-stack" noValidate onSubmit={save}>
      <Field name="name" label="ชื่อผู้จัดจำหน่าย" required maxLength={120} defaultValue={supplier?.name} autoFocus />
      <Field name="contactName" label="ชื่อผู้ติดต่อ" maxLength={120} defaultValue={supplier?.contactName ?? ""} />
      <div className="field-row">
        <Field name="phone" label="โทรศัพท์" type="tel" maxLength={40} defaultValue={supplier?.phone ?? ""} />
        <Field name="email" label="อีเมล" type="email" maxLength={254} defaultValue={supplier?.email ?? ""} />
      </div>
      <Field name="address" label="ที่อยู่" maxLength={400} defaultValue={supplier?.address ?? ""} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <Button type="button" variant="ghost" onClick={close}>ยกเลิก</Button>
        <Button type="submit">บันทึกผู้จัดจำหน่าย</Button>
      </div>
    </form>
  </Modal>;
}
