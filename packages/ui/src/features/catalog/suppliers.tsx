import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { supplierInput, type Supplier, type SupplierQuery } from "@thepos/contracts";
import { Field, readFields } from "@/components/common/fields";
import { Modal } from "@/components/common/modal";
import { Pagination, Table, toggleSort, type Page, type Run, type SortDir } from "@/components/data-table/table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { confirmAction } from "@/lib/alerts";
import { business, errorMessage } from "@/lib/native";

type Filter = Pick<SupplierQuery, "q" | "status">;
const initialFilter: Filter = { q: "", status: "all" };

type SupplierRequest = Filter & {
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: SortDir;
  version: number;
};

export function Suppliers({ write, busy, run, report }: {
  write: boolean;
  busy: boolean;
  run: Run;
  report: (message: string) => void;
}) {
  const [page, setPage] = useState<Page<Supplier>>();
  const [request, setRequest] = useState<SupplierRequest>({
    ...initialFilter,
    page: 1,
    pageSize: 25,
    sortBy: "name",
    sortDir: "asc",
    version: 0,
  });
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<Supplier | "new">();
  const [updating, setUpdating] = useState<string>();
  const [loading, setLoading] = useState(false);
  const loadSeq = useRef(0);
  const confirming = useRef(false);

  const load = useCallback(async (next: SupplierRequest) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError("");
    try {
      const result = await business<Page<Supplier>>("suppliers", {
        query: {
          q: next.q,
          status: next.status,
          page: next.page,
          limit: next.pageSize,
          sortBy: next.sortBy,
          sortDir: next.sortDir,
        },
      });
      if (seq !== loadSeq.current) return;
      setPage(result);
    } catch (reason) {
      if (seq === loadSeq.current) setError(errorMessage(reason));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(request);
    return () => {
      loadSeq.current++;
    };
  }, [load, request]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextFilter: Filter = {
      q: String(form.get("q") ?? "").trim(),
      status: form.get("status") as Filter["status"],
    };
    setRequest((current) => ({ ...current, ...nextFilter, page: 1, version: current.version + 1 }));
  }

  async function toggle(supplier: Supplier) {
    if (busy || loading || confirming.current) return;
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
        await load(request);
      });
    } finally {
      confirming.current = false;
      setUpdating(undefined);
    }
  }

  const working = busy || loading;

  return <div className="form-stack">
    <div className="stock-section-title">
      <h2>ทะเบียนผู้จัดจำหน่าย</h2>
      {write && <Button type="button" disabled={working} onClick={() => setEditor("new")}><Plus size={16} /> เพิ่มผู้จัดจำหน่าย</Button>}
    </div>
    <form className="stock-inline stock-search" onSubmit={search}>
      <Field name="q" label="ค้นหาผู้จัดจำหน่าย" placeholder="ชื่อ ผู้ติดต่อ เบอร์โทร หรืออีเมล" maxLength={255} disabled={working} />
      <Select name="status" label="สถานะ" defaultValue="all" disabled={working}>
        <option value="all">ทุกสถานะ</option><option value="active">เปิดใช้งาน</option><option value="inactive">พักใช้งาน</option>
      </Select>
      <Button type="submit" variant="outline" disabled={working} loading={working && !editor && !updating}>ค้นหา</Button>
    </form>
    {error && <div className="stock-inline">
      <p className="form-error" role="alert">{error}</p>
      <Button type="button" variant="outline" disabled={working} onClick={() => setRequest((current) => ({ ...current, version: current.version + 1 }))}>ลองโหลดอีกครั้ง</Button>
    </div>}
    {(!error || page) && <Table
      headings={[
        { label: "ผู้จัดจำหน่าย", sortKey: "name" },
        { label: "ผู้ติดต่อ", sortKey: "contactName" },
        "โทรศัพท์และอีเมล",
        { label: "สถานะ", sortKey: "isActive" },
        ...(write ? ["จัดการ"] : []),
      ]}
      sortBy={request.sortBy}
      sortDir={request.sortDir}
      onSort={(key) => {
        setRequest((current) => {
          const next = toggleSort(current.sortBy, current.sortDir, key, "asc");
          return { ...current, sortBy: next.sortBy, sortDir: next.sortDir, page: 1 };
        });
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
          <Button type="button" variant="outline" disabled={working} onClick={() => setEditor(row)} aria-label={`แก้ไขผู้จัดจำหน่าย ${row.name}`}>แก้ไข</Button>
          <Button type="button" variant="ghost" disabled={working} loading={updating === row.id} onClick={() => void toggle(row)}
            aria-label={`${row.isActive ? "พักใช้งาน" : "เปิดใช้งาน"} ${row.name}`}>{row.isActive ? "พักใช้งาน" : "เปิดใช้งาน"}</Button>
        </div></td>}
      </tr>)}
    </Table>}
    {page && <Pagination
      page={page.page ?? request.page}
      pageSize={page.pageSize ?? request.pageSize}
      total={page.total ?? page.items.length}
      totalPages={page.totalPages ?? 1}
      onPageChange={(nextPage) => setRequest((current) => ({ ...current, page: nextPage }))}
      onPageSizeChange={(next) => setRequest((current) => ({ ...current, pageSize: next, page: 1 }))}
      disabled={working}
    />}
    {editor && <SupplierEditor supplier={editor === "new" ? undefined : editor} busy={busy} run={run}
      close={() => setEditor(undefined)} saved={async () => {
        setEditor(undefined);
        report(editor === "new" ? "เพิ่มผู้จัดจำหน่ายแล้ว" : "บันทึกข้อมูลผู้จัดจำหน่ายแล้ว");
        await load(request);
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
