import { useEffect, useState } from "react";
import { Loading } from "@/components/common/loading";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { errorMessage, isDesktopApp } from "@/lib/native";
import { listPrinters, type PrintSettings } from "@/lib/printing/printing";

export function PrinterDialog({ value, save }: { value: PrintSettings; save: (settings: PrintSettings) => void }) {
  const desktop = isDesktopApp();
  const [queues, setQueues] = useState<string[]>();
  const [error, setError] = useState("");
  const [escpos, setEscpos] = useState(value.escpos);
  useEffect(() => {
    if (!desktop) return;
    void listPrinters().then(setQueues).catch((reason) => setError(errorMessage(reason)));
  }, [desktop]);
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        const input = new FormData(event.currentTarget);
        const paper = input.get("paper") === "58" ? 58 : 80;
        if (!desktop) {
          save({
            ...value,
            printer: "",
            paper,
            escpos: false,
            cut: false,
            drawer: false,
          });
          return;
        }
        save({
          printer: String(input.get("printer") ?? value.printer),
          paper,
          escpos,
          cut: escpos && input.has("cut"),
          drawer: escpos && input.has("drawer"),
        });
      }}
    >
      {desktop ? (
        <>
          {error && <div role="alert" className="notice">{error}</div>}
          {!queues && !error && <Loading label="กำลังค้นหาเครื่องพิมพ์ Windows" variant="inline" />}
          <Select autoFocus label="เครื่องพิมพ์ Windows" name="printer" defaultValue={value.printer}>
            <option value="">บันทึก PDF หรือเลือกเครื่องพิมพ์ภายหลัง</option>
            {value.printer && !queues?.includes(value.printer) && <option value={value.printer}>{value.printer}</option>}
            {queues?.map((queue) => <option key={queue}>{queue}</option>)}
          </Select>
          {queues?.length === 0 && <p>Windows ยังไม่มีคิวพิมพ์ที่ใช้งานได้</p>}
          <div className="field-row">
            <Select label="ขนาดกระดาษ" name="paper" defaultValue={String(value.paper)}>
              <option value="80">80 มม.</option>
              <option value="58">58 มม.</option>
            </Select>
            <div className="field">
              <span className="label">คำสั่งเครื่องพิมพ์ใบเสร็จ</span>
              <label>
                <input type="checkbox" checked={escpos} onChange={(event) => setEscpos(event.target.checked)} /> ส่งคำสั่ง ESC/POS โดยตรง
              </label>
            </div>
          </div>
          {escpos && (
            <div className="stock-flags">
              <label><input type="checkbox" name="cut" defaultChecked={value.cut} /> ตัดกระดาษอัตโนมัติ</label>
              <label><input type="checkbox" name="drawer" defaultChecked={value.drawer} /> เปิดลิ้นชักเมื่อรับเงินสด</label>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="stock-help">
            การใช้งานผ่านเบราว์เซอร์จะสร้างใบเสร็จเป็นไฟล์ PDF สำหรับดูหรือดาวน์โหลดตามขนาดกระดาษที่เลือก
          </p>
          <Select autoFocus label="ขนาดกระดาษสำหรับ PDF" name="paper" defaultValue={String(value.paper)}>
            <option value="80">80 มม.</option>
            <option value="58">58 มม.</option>
          </Select>
        </>
      )}
      <Button type="submit">บันทึกการตั้งค่า</Button>
    </form>
  );
}
