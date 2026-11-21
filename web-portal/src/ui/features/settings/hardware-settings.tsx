import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Barcode, Printer, ReceiptText } from "lucide-react";
import type { StoreSettings } from "@thepos/contracts";
import { Field } from "@/components/common/fields";
import { Loading } from "@/components/common/loading";
import { Modal } from "@/components/common/modal";
import { PrinterDialog } from "@/components/common/printer-dialog";
import { ReceiptView } from "@/components/common/receipt-view";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { confirmAction, notifyError, notifySuccess } from "@/lib/alerts";
import { readStored } from "@/lib/format";
import { business, errorMessage, isDesktopApp } from "@/lib/native";
import { defaultPrintSettings, downloadReceipt, printReceipt, type Receipt } from "@/lib/printing/printing";

export function HardwareSettingsSection({ deviceId }: { deviceId: string }) {
  const desktop = isDesktopApp();
  const key = `thepos/printer/${deviceId}`;
  const [printer, setPrinter] = useState(() => readStored(key, defaultPrintSettings));
  const [store, setStore] = useState<StoreSettings>();
  const [editor, setEditor] = useState<"preview" | "printer">();
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<"printer" | "drawer">();
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setStore(await business<StoreSettings>("store_settings"));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const sample: Receipt | undefined = store && {
    id: "printer-test",
    invoiceNumber: "PRINTER-TEST",
    completedAt: new Date().toISOString(),
    storeName: store.name,
    cashierName: "ทดสอบเครื่องพิมพ์",
    memberName: null,
    receiptHeader: store.receiptHeader,
    receiptFooter: store.receiptFooter,
    receiptLogo: store.receiptLogo,
    subtotal: "0.00",
    netTotal: "0.00",
    billDiscount: "0.00",
    discountTotal: "0.00",
    payments: [],
    items: [
      {
        id: "printer-test-item",
        name: "ใบเสร็จทดสอบ",
        sku: "TEST",
        unit: "ชิ้น",
        quantity: "1",
        lineTotal: "0.00",
        lineDiscount: "0.00",
        billDiscountShare: "0.00",
      },
    ],
  };

  async function test(mode: "printer" | "drawer" | "pdf") {
    if (!sample || pending.current) return;
    if (mode !== "pdf" && !printer.printer) return;
    pending.current = true;
    try {
      if (
        mode === "drawer" &&
        !(await confirmAction({
          title: "ทดสอบเปิดลิ้นชักเงินสด?",
          text: "เครื่องจะพิมพ์ใบเสร็จทดสอบและส่งคำสั่งเปิดลิ้นชัก",
          confirmText: "ทดสอบเปิดลิ้นชัก",
        }))
      )
        return;
      setTesting(mode === "pdf" ? "printer" : mode);
      if (mode === "pdf") {
        await downloadReceipt(sample, printer);
        notifySuccess("เตรียมไฟล์ใบเสร็จทดสอบ (PDF) แล้ว");
      } else {
        await printReceipt(sample, mode === "drawer" ? { ...printer, drawer: true } : printer, mode === "drawer");
        notifySuccess(mode === "drawer" ? "ส่งคำสั่งทดสอบลิ้นชักแล้ว" : "ส่งใบเสร็จทดสอบเข้าคิวแล้ว");
      }
    } catch (reason) {
      void notifyError(mode === "pdf" ? "สร้าง PDF ทดสอบไม่สำเร็จ" : "ทดสอบฮาร์ดแวร์ไม่สำเร็จ", errorMessage(reason));
    } finally {
      pending.current = false;
      setTesting(undefined);
    }
  }

  return (
    <>
      <div className="stock-content">
        <div className="stock-section-title">
          <h2>{desktop ? "เครื่องพิมพ์และลิ้นชัก" : "การพิมพ์ใบเสร็จ (PDF)"}</h2>
          <Button variant="outline" disabled={!!testing} onClick={() => setEditor("printer")}>
            <Printer /> {desktop ? "ตั้งค่าเครื่องพิมพ์" : "ตั้งค่าขนาดกระดาษ"}
          </Button>
        </div>
        {loading && <Loading label="กำลังโหลดข้อมูลใบเสร็จสำหรับทดสอบ" variant="inline" />}
        {error && (
          <div className="register-inline">
            <p role="alert" className="form-error">{error}</p>
            <Button variant="outline" onClick={() => void load()}>ลองโหลดอีกครั้ง</Button>
          </div>
        )}
        <p className="stock-help">
          {desktop
            ? `${printer.printer || "ยังไม่ได้เลือกคิวพิมพ์"} · ${printer.paper} มม.`
            : `ดาวน์โหลดใบเสร็จเป็นไฟล์ PDF · ขนาดกระดาษ ${printer.paper} มม.`}
        </p>
        <div className="register-inline">
          <Button variant="outline" disabled={!sample || !!testing} onClick={() => setEditor("preview")}>
            <ReceiptText /> ดูตัวอย่างใบเสร็จ
          </Button>
          {desktop ? (
            <>
              <Button
                variant="outline"
                disabled={!sample || !printer.printer || !!testing}
                loading={testing === "printer" && "กำลังส่งงานพิมพ์"}
                onClick={() => void test("printer")}
              >
                พิมพ์ทดสอบ
              </Button>
              <Button
                variant="outline"
                disabled={!sample || !printer.printer || !printer.escpos || !!testing}
                loading={testing === "drawer" && "กำลังส่งคำสั่ง"}
                onClick={() => void test("drawer")}
              >
                ทดสอบลิ้นชัก
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              disabled={!sample || !!testing}
              loading={testing === "printer" && "กำลังเตรียม PDF"}
              onClick={() => void test("pdf")}
            >
              ดาวน์โหลด PDF ทดสอบ
            </Button>
          )}
        </div>
      </div>
      <ScannerTest />
      {editor === "preview" && sample && (
        <Modal title="ตัวอย่างใบเสร็จ" close={() => setEditor(undefined)}>
          <ReceiptView receipt={sample} settings={printer} configure={() => setEditor("printer")} />
        </Modal>
      )}
      {editor === "printer" && (
        <Modal title="ตั้งค่าเครื่องพิมพ์ใบเสร็จ" close={() => setEditor(undefined)}>
          <PrinterDialog
            value={printer}
            save={(updated) => {
              try {
                localStorage.setItem(key, JSON.stringify(updated));
                setPrinter(updated);
                setEditor(undefined);
                notifySuccess("บันทึกการตั้งค่าเครื่องพิมพ์แล้ว");
              } catch {
                void notifyError("บันทึกการตั้งค่าเครื่องพิมพ์ไม่สำเร็จ");
              }
            }}
          />
        </Modal>
      )}
    </>
  );
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
    if (event.key !== suffix) {
      setResult({ ok: false, text: `เครื่องส่งปุ่มท้าย ${event.key} แต่ตั้งไว้เป็น ${suffix}` });
      return;
    }
    if (!code.startsWith(prefix) || code.length === prefix.length) {
      setResult({ ok: false, text: "ไม่พบรหัสหลังข้อความนำหน้าที่กำหนด" });
      return;
    }
    setResult({ ok: true, text: `อ่านบาร์โค้ดได้ ${code.slice(prefix.length)} · ปุ่มท้าย ${suffix}` });
  }

  return (
    <div className="stock-content">
      <h2 className="register-inline"><Barcode size={19} /> ทดสอบเครื่องสแกน</h2>
      <div className="field-row">
        <Field label="ข้อความนำหน้า (ถ้ามี)" value={prefix} onChange={(event) => setPrefix(event.target.value)} maxLength={32} />
        <Select label="ปุ่มท้ายบาร์โค้ด" value={suffix} onChange={(event) => setSuffix(event.target.value)}>
          <option value="Enter">Enter</option>
          <option value="Tab">Tab</option>
        </Select>
      </div>
      <Field
        label="ช่องทดสอบสแกน"
        autoComplete="off"
        maxLength={255}
        onKeyDown={scan}
        hint="คลิกช่องนี้แล้วสแกนบาร์โค้ด ระบบจะแสดงรหัสและปุ่มท้ายที่ได้รับ"
      />
      {result && <p className={result.ok ? "stock-success" : "form-error"} role="status">{result.text}</p>}
    </div>
  );
}
