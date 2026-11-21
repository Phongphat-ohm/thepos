import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import type { ImportInput, ImportPreview } from "@thepos/contracts";
import { Field } from "@/components/common/fields";
import { Modal } from "@/components/common/modal";
import { Table, type Run } from "@/components/data-table/table";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/lib/alerts";
import { retryKey } from "@/lib/format";
import { business } from "@/lib/native";
import { downloadProductTemplate, readProductFile } from "./import-file";

const issues: Record<string, string> = {
  sku: "รหัส SKU ไม่ถูกต้อง", name: "ชื่อสินค้าไม่ถูกต้อง", category: "ไม่พบหมวดหมู่",
  baseUnit: "หน่วยหลักไม่ถูกต้อง", costPrice: "ต้นทุนไม่ถูกต้อง", regularPrice: "ราคาทั่วไปไม่ถูกต้อง",
  memberPrice: "ราคาสมาชิกไม่ถูกต้อง", barcodes: "บาร์โค้ดไม่ถูกต้อง", units: "หน่วยแปลงไม่ถูกต้อง",
  trackStock: "ค่าติดตามสต็อกไม่ถูกต้อง", trackExpiration: "ค่าติดตามวันหมดอายุไม่ถูกต้อง",
  duplicateSku: "SKU ซ้ำ", duplicateBarcode: "บาร์โค้ดซ้ำ",
};

export function ImportProducts({ run, report, warn, busy }: {
  run: Run; report: (message: string) => void; warn: (message: string) => void; busy: boolean;
}) {
  const [preview, setPreview] = useState<{ input: ImportInput; result: ImportPreview }>();
  const [file, setFile] = useState<File>();
  const retry = useRef<{ payload: string; key: string }>(undefined);

  function inspect() {
    if (!file) return;
    void run(async () => {
      let input: ImportInput;
      try {
        input = await readProductFile(file);
      } catch (error) {
        warn(error instanceof Error ? error.message : "อ่านไฟล์ไม่ได้");
        return;
      }
      const result = await business<ImportPreview>("import_preview", { input });
      setPreview({ input, result });
    });
  }

  async function commit() {
    if (!preview?.result.valid || busy) return;
    if (!await confirmAction({ title: "ยืนยันนำเข้าสินค้า", text: `จะเพิ่มสินค้า ${preview.result.rows.length} รายการจากไฟล์ที่ตรวจแล้ว`, confirmText: "นำเข้าสินค้า" })) return;
    void run(async () => {
      const { createdCount } = await business<{ createdCount: number }>("import_commit", { input: preview.input, key: retryKey(retry, preview.input) });
      setPreview(undefined);
      report(`นำเข้าสินค้าแล้ว ${createdCount} รายการ`);
    });
  }

  return <div className="form-stack">
    <div className="stock-section-title">
      <h2>นำเข้าสินค้า</h2>
      <div className="stock-inline">
        <Button variant="outline" disabled={busy} onClick={() => void run(() => downloadProductTemplate("xlsx"))}>แม่แบบ Excel</Button>
        <Button variant="outline" disabled={busy} onClick={() => void run(() => downloadProductTemplate("csv"))}>แม่แบบ CSV</Button>
      </div>
    </div>
    <p className="stock-help">ใช้ชื่อหมวดหมู่ที่มีอยู่ในระบบ เก็บบาร์โค้ดแบบข้อความ เช่น 000123 และคั่นหลายรหัสด้วย | ระบุหน่วยแปลงเป็น แพ็ค=6|ลัง=24</p>
    <div className="stock-inline import-file-picker">
      <span className="workspace-symbol"><FileUp size={22} aria-hidden="true" /></span>
      <Field
        label="ไฟล์สินค้า"
        type="file"
        accept=".csv,.xlsx"
        disabled={busy}
        onClick={(event) => { event.currentTarget.value = ""; }}
        onChange={(event) => {
          setFile(event.target.files?.[0]);
          setPreview(undefined);
          retry.current = undefined;
        }}
      />
      <Button onClick={inspect} disabled={!file} loading={busy && !preview}>ตรวจสอบไฟล์</Button>
    </div>
    {preview && <Modal title="ผลตรวจสอบไฟล์สินค้า" size="lg" busy={busy && "กำลังนำเข้าสินค้า"} close={() => setPreview(undefined)}><div className="form-stack">
      <p role="status">{preview.result.valid ? "ข้อมูลพร้อมนำเข้า" : "แก้ไขรายการที่แจ้งแล้วตรวจสอบไฟล์อีกครั้ง"}</p>
      <Table headings={["แถว", "SKU", "สินค้า", "ผลตรวจสอบ"]}>
        {preview.result.rows.map(({ row, sku, name, issues: rowIssues }) => <tr key={row}>
          <td>{row}</td><td>{sku}</td><td>{name}</td>
          <td>{rowIssues.length ? rowIssues.map((issue) => issues[issue] ?? "ข้อมูลไม่ถูกต้อง").join(" · ") : "ผ่าน"}</td>
        </tr>)}
      </Table>
      <div className="form-actions"><Button type="button" variant="ghost" onClick={() => setPreview(undefined)}>ปิด</Button>
        <Button disabled={!preview.result.valid} onClick={() => void commit()}>ยืนยันนำเข้า {preview.result.rows.length} รายการ</Button></div>
    </div></Modal>}
  </div>;
}
