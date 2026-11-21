import { useState } from "react";
import { Table } from "@/components/data-table/table";
import { Button } from "@/components/ui/button";
import { notifyError, notifySuccess } from "@/lib/alerts";
import { paymentLabels } from "@/lib/format";
import { errorMessage, isDesktopApp } from "@/lib/native";
import { downloadReceipt, printReceipt, type PrintSettings, type Receipt } from "@/lib/printing/printing";

export function ReceiptView({
  receipt,
  settings,
  configure,
}: {
  receipt: Receipt;
  settings: PrintSettings;
  configure: () => void;
}) {
  const desktop = isDesktopApp();
  const [busy, setBusy] = useState<"print" | "pdf">();

  async function output(action: "print" | "pdf") {
    if (busy) return;
    setBusy(action);
    try {
      if (action === "print") await printReceipt(receipt, settings, false);
      else await downloadReceipt(receipt, settings);
      notifySuccess(action === "print" ? "ส่งคำสั่งพิมพ์แล้ว" : "เตรียมไฟล์ใบเสร็จแล้ว");
    } catch (reason) {
      void notifyError(action === "print" ? "พิมพ์ใบเสร็จไม่สำเร็จ" : "บันทึก PDF ไม่สำเร็จ", errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="form-stack">
      {receipt.receiptLogo && <img className="receipt-logo" src={receipt.receiptLogo} alt="โลโก้ร้าน" />}
      {receipt.receiptHeader && <p className="receipt-message">{receipt.receiptHeader}</p>}
      <div className="register-inline">
        <strong>เลขที่ {receipt.invoiceNumber}</strong>
        {receipt.memberName && <span>สมาชิก {receipt.memberName}</span>}
      </div>
      <Table headings={["สินค้า", "จำนวน", "ส่วนลด", "สุทธิ"]}>
        {receipt.items.map((item) => (
          <tr key={item.id}>
            <td>{item.name}</td>
            <td>{item.quantity} {item.unit}</td>
            <td>{item.lineDiscount}</td>
            <td>{item.lineTotal}</td>
          </tr>
        ))}
      </Table>
      <div className="form-stack">
        <div className="register-inline">
          <span>รวมก่อนลด ฿{receipt.subtotal}</span>
          {receipt.discountTotal !== "0.00" && <span>ส่วนลด ฿{receipt.discountTotal}</span>}
          <strong>ยอดสุทธิ ฿{receipt.netTotal}</strong>
        </div>
        <div className="form-stack">
          {receipt.payments.map((payment, idx) => (
            <span key={idx}>
              {paymentLabels[payment.method] ?? "ชำระเงิน"} ฿{payment.amount}
              {payment.tendered ? ` · รับมา ฿${payment.tendered} · เงินทอน ฿${payment.change ?? "0.00"}` : ""}
              {payment.reference ? ` · อ้างอิง ${payment.reference}` : ""}
            </span>
          ))}
        </div>
      </div>
      {receipt.receiptFooter && <p className="receipt-message">{receipt.receiptFooter}</p>}
      <div className="register-inline">
        {desktop ? (
          <>
            <Button disabled={!!busy} loading={busy === "print" && "กำลังพิมพ์"} onClick={() => void output("print")}>พิมพ์ใบเสร็จ</Button>
            <Button variant="outline" disabled={!!busy} loading={busy === "pdf" && "กำลังเตรียม PDF"} onClick={() => void output("pdf")}>บันทึกเป็น PDF</Button>
            <Button variant="ghost" disabled={!!busy} onClick={configure}>ตั้งค่าเครื่องพิมพ์</Button>
          </>
        ) : (
          <>
            <Button disabled={!!busy} loading={busy === "pdf" && "กำลังเตรียม PDF"} onClick={() => void output("pdf")}>ดาวน์โหลดใบเสร็จ (PDF)</Button>
            <Button variant="ghost" disabled={!!busy} onClick={configure}>ตั้งค่าขนาดกระดาษ</Button>
          </>
        )}
      </div>
    </div>
  );
}
