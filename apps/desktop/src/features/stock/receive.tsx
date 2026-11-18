import { useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { receiptInput, type ReceiptInput, type Supplier } from "@thepos/contracts";
import { Field } from "@/components/fields";
import { Autocomplete } from "@/components/autocomplete";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/lib/alerts";
import { business, errorCode } from "@/lib/native";
import { productText, retryKey, Select, Table, type Page, type Product, type Run } from "./shared";

const searchSuppliers = (q: string, after?: string) => business<Page<Supplier>>("suppliers", { query: { q, after, status: "active" } });
const searchReceivable = (q: string, after?: string) => business<Page<Product>>("products", { query: { q, after, receivable: "true" } });

export function Receive({
  run,
  report,
  warn,
  busy,
}: {
  run: Run;
  report: (message: string) => void;
  warn: (message: string) => void;
  busy: boolean;
}) {
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [lotModal, setLotModal] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [lines, setLines] = useState<(ReceiptInput["lines"][number] & { name: string; lineId: string })[]>([]);
  const retry = useRef<{ payload: string; key: string }>(undefined);
  const confirming = useRef(false);

  function addLine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const candidate = {
      productId: selected.id,
      unit: String(form.get("unit")),
      quantity: String(form.get("quantity")),
      lotNumber: String(form.get("lotNumber")).trim(),
      expirationDate: String(form.get("expirationDate") ?? "") || null,
      unitCostPerBaseUnit: String(form.get("cost")),
    };
    const parsed = receiptInput.shape.lines.element.safeParse(candidate);
    if (!parsed.success) {
      warn("ตรวจสอบจำนวน เลขล็อต วันหมดอายุ และต้นทุนก่อนเพิ่ม");
      return;
    }
    setLines((current) => [...current, { ...parsed.data, name: selected.name, lineId: crypto.randomUUID() }]);
    setLotModal(false);
    report("เพิ่มล็อตในใบรับเข้าแล้ว");
  }

  async function save() {
    if (!supplier || busy || confirming.current || !lines.length) return;
    const input = { supplierId: supplier.id, lines: lines.map(({ name: _name, lineId: _lineId, ...line }) => line) };
    confirming.current = true;
    try {
      if (!await confirmAction({ title: "ยืนยันรับสินค้าเข้าคลัง", text: `${supplier.name} · ${lines.length} ล็อต`, confirmText: "บันทึกใบรับเข้า" })) return;
      await run(async () => {
        try {
          const result = await business<{ id: string; lots: unknown[] }>("receive", { input, key: retryKey(retry, input) });
          setLines([]);
          retry.current = undefined;
          report(`บันทึกใบรับเข้าแล้ว ${result.lots.length} ล็อต`);
        } catch (reason) {
          if (errorCode(reason) === "SUPPLIER_INACTIVE") setSupplier(null);
          throw reason;
        }
      });
    } finally { confirming.current = false; }
  }

  return (
    <div className="form-stack">
      <h2>ใบรับเข้าใหม่</h2>

      <div className="stock-grid">
        <Autocomplete label="ผู้จัดจำหน่าย" placeholder="ชื่อ ผู้ติดต่อ หรือเบอร์โทร" value={supplier} onChange={setSupplier}
          text={({ name }) => name} load={searchSuppliers} disabled={busy} />
        <Autocomplete label="สินค้าที่รับเข้า" placeholder="ชื่อสินค้า รหัส SKU หรือบาร์โค้ด" value={selected} onChange={setSelected}
          maxLength={255} text={productText} load={searchReceivable} disabled={busy} />
      </div>

      {selected && <div><Button type="button" variant="outline" disabled={busy || lines.length >= 50} onClick={() => setLotModal(true)}>
        <Plus size={16} /> เพิ่มล็อต
      </Button></div>}
      {selected && lotModal && (
        <Modal key={selected.id} title={`เพิ่มล็อต · ${selected.name}`} close={() => setLotModal(false)}>
        <form className="form-stack" onSubmit={addLine}>
          <div className="stock-grid">
            <Field label="เลขล็อต" name="lotNumber" maxLength={100} required autoFocus />
            <Select label="หน่วยรับเข้า" name="unit">
              {[selected.baseUnit, ...selected.units.map(({ name }) => name)].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </Select>
            <Field label="จำนวนรับเข้า" name="quantity" inputMode="decimal" required />
            <Field label="วันหมดอายุ" type="date" name="expirationDate" required={selected.trackExpiration} />
            <Field label={`ต้นทุนต่อ${selected.baseUnit} (บาท)`} name="cost" inputMode="decimal" required />
          </div>
          <div className="form-actions">
            <Button type="button" variant="ghost" onClick={() => setLotModal(false)}>ยกเลิก</Button>
            <Button type="submit" variant="outline" disabled={lines.length >= 50}>
              <Plus size={16} /> เพิ่มล็อต
            </Button>
          </div>
        </form>
        </Modal>
      )}

      <Table
        headings={["สินค้า", "ล็อต", "จำนวน", "ต้นทุนต่อหน่วยหลัก", "วันหมดอายุ", "จัดการ"]}
        empty={lines.length ? undefined : "ยังไม่มีล็อตในใบรับเข้า"}
      >
        {lines.map((line) => (
          <tr key={line.lineId}>
            <td>{line.name}</td>
            <td>{line.lotNumber}</td>
            <td>{line.quantity} {line.unit}</td>
            <td>{line.unitCostPerBaseUnit}</td>
            <td>{line.expirationDate ?? "—"}</td>
            <td>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setLines((current) => current.filter(({ lineId }) => lineId !== line.lineId))}
                aria-label={`นำล็อต ${line.lotNumber} ออก`}
              >
                นำออก
              </Button>
            </td>
          </tr>
        ))}
      </Table>

      <div>
        <Button disabled={!supplier || !lines.length} loading={busy} onClick={() => void save()}>
          บันทึกใบรับเข้า
        </Button>
      </div>
    </div>
  );
}
