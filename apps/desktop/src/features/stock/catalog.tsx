import { useRef, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { productInput, productUnitInput, productUnitLimit, type ProductInput } from "@thepos/contracts";
import { Field } from "@/components/fields";
import { Autocomplete } from "@/components/autocomplete";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { business } from "@/lib/native";
import { Pagination, Table, type Page, type Product, type Reference, type Run, type SortDir } from "./shared";

const searchCategories = (q: string, after?: string) => business<Page<Reference>>("categories", { query: { q, after } });

const textList = (field: FormDataEntryValue | null) =>
  String(field ?? "").split("|").map((part) => part.trim()).filter(Boolean);
type UnitRow = ProductInput["units"][number] & { id: string };

export function Catalog({
  products,
  page,
  pageSize,
  total,
  totalPages,
  sortBy,
  sortDir,
  onPageChange,
  onPageSizeChange,
  onSort,
  write,
  busy,
  run,
  refresh,
  report,
  warn,
}: {
  products: Product[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sortBy: string;
  sortDir: SortDir;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSort: (key: string) => void;
  write: boolean;
  busy: boolean;
  run: Run;
  refresh: () => Promise<void>;
  report: (message: string) => void;
  warn: (message: string) => void;
}) {
  const [editor, setEditor] = useState<Product | "new">();

  return (
    <>
      <div className="stock-section-title">
        <h2>รายการสินค้า</h2>
        {write && (
          <Button disabled={busy} onClick={() => setEditor("new")}>
            <Plus size={16} /> เพิ่มสินค้า
          </Button>
        )}
      </div>
      <Table
        loading={busy && !products.length}
        headings={[
          { label: "SKU", sortKey: "sku" },
          { label: "สินค้า", sortKey: "name" },
          "หน่วยหลัก",
          { label: "ราคาทั่วไป", sortKey: "regularPrice", numeric: true },
          { label: "ราคาสมาชิก", sortKey: "memberPrice", numeric: true },
          { label: "สถานะ", sortKey: "isActive" },
          "จัดการ",
        ]}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={onSort}
        empty={products.length ? undefined : "ไม่พบสินค้า"}
      >
        {products.map((product) => (
          <tr key={product.id}>
            <td>{product.sku}</td>
            <td>
              <strong>{product.name}</strong>
              {product.barcodes.length > 0 && <small>{product.barcodes.join(", ")}</small>}
            </td>
            <td>{product.baseUnit}</td>
            <td className="report-number">{product.regularPrice}</td>
            <td className="report-number">{product.memberPrice}</td>
            <td>{product.isActive ? "เปิดใช้งาน" : "ปิดใช้งาน"}</td>
            <td>
              {write && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={`แก้ไข ${product.name}`}
                  onClick={() => setEditor(product)}
                >
                  แก้ไข
                </Button>
              )}
            </td>
          </tr>
        ))}
      </Table>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        totalPages={totalPages}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        disabled={busy}
      />
      {write && editor && <ProductEditor key={editor === "new" ? "new" : editor.id} busy={busy}
        product={editor === "new" ? undefined : editor} run={run} report={report} warn={warn}
        close={() => setEditor(undefined)} saved={async () => {
          setEditor(undefined);
          report("บันทึกสินค้าแล้ว");
          await refresh();
        }} />}
    </>
  );
}

function ProductEditor({
  product,
  busy,
  run,
  report,
  warn,
  close,
  saved,
}: {
  product?: Product;
  busy: boolean;
  run: Run;
  report: (message: string) => void;
  warn: (message: string) => void;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [category, setCategory] = useState<Reference | null>(product ? {
    id: product.categoryId, name: product.categoryName ?? "หมวดหมู่ปัจจุบัน",
  } : null);
  const [categoryModal, setCategoryModal] = useState(false);
  const [baseUnit, setBaseUnit] = useState(product?.baseUnit ?? "");
  const [units, setUnits] = useState<UnitRow[]>(() =>
    product?.units.map((unit, index) => ({ ...unit, id: `saved-${index}` })) ?? [],
  );
  const [newUnitId, setNewUnitId] = useState<string>();
  const [unitError, setUnitError] = useState("");
  const addUnitButton = useRef<HTMLButtonElement>(null);
  const unitsHeading = useRef<HTMLLegendElement>(null);

  function addUnit() {
    const id = crypto.randomUUID();
    setUnits((rows) => rows.length < productUnitLimit ? [...rows, { id, name: "", multiplier: "" }] : rows);
    setNewUnitId(id);
    setUnitError("");
  }

  function editUnit(id: string, field: "name" | "multiplier", value: string) {
    setUnits((rows) => rows.map((row) => row.id === id ? { ...row, [field]: value } : row));
    setUnitError("");
  }

  function removeUnit(id: string) {
    setUnits((rows) => rows.filter((row) => row.id !== id));
    setUnitError("");
    requestAnimationFrame(() => addUnitButton.current?.focus());
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = productInput.safeParse({
      sku: form.get("sku"),
      name: form.get("name"),
      categoryId: category?.id,
      description: form.get("description") || null,
      baseUnit,
      costPrice: form.get("costPrice"),
      regularPrice: form.get("regularPrice"),
      memberPrice: form.get("memberPrice"),
      barcodes: textList(form.get("barcodes")),
      units: units.map(({ name, multiplier }) => ({ name, multiplier: multiplier.trim() })),
      isActive: form.has("active"),
      trackStock: form.has("stock"),
      trackExpiration: form.has("expiry"),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues.find(({ path }) => path[0] === "units");
      if (issue) {
        const row = issue.path[1];
        if (typeof row === "number") {
          setUnitError(issue.path[2] === "multiplier"
            ? `แถวที่ ${row + 1} กรุณาระบุจำนวนมากกว่า 0 ใช้ทศนิยมได้ไม่เกิน 3 ตำแหน่ง`
            : `แถวที่ ${row + 1} กรุณาระบุชื่อหน่วยแปลง`);
        } else {
          setUnitError(issue.code === "too_big"
            ? `เพิ่มหน่วยแปลงได้สูงสุด ${productUnitLimit} หน่วย`
            : "ชื่อหน่วยแปลงต้องไม่ซ้ำกันและไม่ซ้ำกับหน่วยหลัก");
        }
        unitsHeading.current?.focus();
      } else {
        warn("ตรวจสอบหมวดหมู่ ราคา บาร์โค้ด และตัวเลือกสต็อกก่อนบันทึก");
      }
      return;
    }
    void run(async () => {
      await business(product ? "update_product" : "create_product", { id: product?.id, input: parsed.data });
      await saved();
    });
  }

  function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      const category = await business<Reference>("create_category", { input: { name: form.get("newCategory") } });
      setCategory(category);
      setCategoryModal(false);
      report("เพิ่มหมวดหมู่แล้ว");
    });
  }

  return (
    <Modal title={product ? `แก้ไขสินค้า · ${product.name}` : "เพิ่มสินค้าใหม่"} size="lg" close={close}
      busy={!categoryModal && busy && "กำลังบันทึกสินค้า"}>

      <form className="form-stack" onSubmit={submit}>
        <div className="stock-grid">
          <Field label="รหัส SKU" name="sku" defaultValue={product?.sku} maxLength={50} required autoFocus />
          <Field label="ชื่อสินค้า" name="name" defaultValue={product?.name} maxLength={255} required />
          <div className="field-with-action">
            <Autocomplete label="หมวดหมู่" placeholder="พิมพ์ชื่อหมวดหมู่" required value={category} onChange={setCategory}
              text={({ name }) => name} load={searchCategories} />
            <div className="field-inline-actions">
              <Button type="button" variant="outline" onClick={() => setCategoryModal(true)}>
                <Plus size={14} /> เพิ่มหมวดหมู่
              </Button>
            </div>
          </div>
          <Field label="หน่วยหลัก" name="baseUnit" value={baseUnit} onChange={(event) => {
            setBaseUnit(event.target.value); setUnitError("");
          }} maxLength={50} required />
          <Field label="ต้นทุนอ้างอิง (บาท)" name="costPrice" defaultValue={product?.costPrice} inputMode="decimal" required />
          <Field label="ราคาทั่วไป (บาท)" name="regularPrice" defaultValue={product?.regularPrice} inputMode="decimal" required />
          <Field label="ราคาสมาชิก (บาท)" name="memberPrice" defaultValue={product?.memberPrice} inputMode="decimal" required />
          <Field label="รายละเอียด" name="description" defaultValue={product?.description ?? ""} maxLength={2000} />
          <Field label="บาร์โค้ด" name="barcodes" hint="คั่นด้วย | เมื่อมีหลายรหัส" defaultValue={product?.barcodes.join("|")} />
        </div>

        <fieldset className="product-units">
          <legend ref={unitsHeading} tabIndex={-1}>หน่วยแปลง</legend>
          <p className="stock-help">ระบุจำนวนหน่วยหลักใน 1 หน่วยแปลง เช่น 1 แพ็ค = 6 ชิ้น</p>
          {units.map(({ id, name, multiplier }, index) => <div className="product-unit-row" key={id}>
            <Field label="ชื่อหน่วยแปลง" aria-label={`ชื่อหน่วยแปลง แถวที่ ${index + 1}`}
              value={name} onChange={(event) => editUnit(id, "name", event.target.value)}
              placeholder="เช่น แพ็ค" maxLength={50} autoFocus={id === newUnitId} required />
            <Field label={`จำนวน${baseUnit.trim() || "หน่วยหลัก"}ต่อ 1 หน่วยแปลง`}
              aria-label={`จำนวนหน่วยหลัก แถวที่ ${index + 1}`} inputMode="decimal"
              value={multiplier} onChange={(event) => editUnit(id, "multiplier", event.target.value)}
              placeholder="เช่น 6" maxLength={13} required />
            <Button type="button" variant="ghost" aria-label={`ลบหน่วยแปลง แถวที่ ${index + 1}`}
              title="ลบหน่วยแปลง" onClick={() => removeUnit(id)}><Trash2 size={16} /></Button>
            {baseUnit.trim() && productUnitInput.safeParse({ name, multiplier: multiplier.trim() }).success &&
              <p className="product-unit-conversion">1 {name.trim()} = {multiplier.trim()} {baseUnit.trim()}</p>}
          </div>)}
          {unitError && <p className="form-error" role="alert">{unitError}</p>}
          <div>
            <Button ref={addUnitButton} type="button" variant="outline" disabled={units.length >= productUnitLimit} onClick={addUnit}>
              <Plus size={15} /> เพิ่มหน่วยแปลง
            </Button>
            {units.length >= productUnitLimit && <p className="field-hint">ครบ {productUnitLimit} หน่วยแปลงแล้ว</p>}
          </div>
        </fieldset>

        <div className="stock-flags">
          <label><input type="checkbox" name="active" defaultChecked={product?.isActive ?? true} /> เปิดใช้งาน</label>
          <label><input type="checkbox" name="stock" defaultChecked={product?.trackStock ?? true} /> นับสต็อก</label>
          <label><input type="checkbox" name="expiry" defaultChecked={product?.trackExpiration ?? false} /> ระบุวันหมดอายุ</label>
        </div>

        <div className="form-actions">
          <Button type="button" variant="ghost" onClick={close}>ยกเลิก</Button>
          <Button type="submit" className="primary-action">บันทึกสินค้า</Button>
        </div>
      </form>

      {categoryModal && (
        <Modal title="เพิ่มหมวดหมู่ใหม่" size="sm" close={() => setCategoryModal(false)} busy={busy && "กำลังบันทึกหมวดหมู่"}>
          <form className="form-stack" onSubmit={createCategory}>
            <Field name="newCategory" label="ชื่อหมวดหมู่" maxLength={120} required autoFocus />
            <div className="form-actions">
              <Button type="button" variant="ghost" onClick={() => setCategoryModal(false)}>ยกเลิก</Button>
              <Button type="submit" className="primary-action">บันทึกหมวดหมู่</Button>
            </div>
          </form>
        </Modal>
      )}
    </Modal>
  );
}
