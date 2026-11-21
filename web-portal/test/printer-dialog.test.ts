import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrinterDialog } from "@/components/common/printer-dialog";
import { ReceiptView } from "@/components/common/receipt-view";
import { defaultPrintSettings, type Receipt } from "@/lib/printing/printing";

const sampleReceipt: Receipt = {
  id: "r1",
  invoiceNumber: "INV-001",
  completedAt: "2026-11-21T05:00:00.000Z",
  storeName: "ร้านสหกรณ์ทดสอบ",
  cashierName: "พนักงานทดสอบ",
  memberName: null,
  receiptHeader: null,
  receiptFooter: null,
  receiptLogo: null,
  subtotal: "100.00",
  netTotal: "100.00",
  billDiscount: "0.00",
  discountTotal: "0.00",
  payments: [{ method: "CASH", amount: "100.00" }],
  items: [
    {
      id: "i1",
      name: "น้ำดื่ม",
      sku: "W01",
      unit: "ขวด",
      quantity: "1",
      lineTotal: "100.00",
      lineDiscount: "0.00",
      billDiscountShare: "0.00",
    },
  ],
};

describe("browser printing UX in web-portal", () => {
  it("shows PDF paper options instead of Windows queues or ESC/POS in PrinterDialog on web", () => {
    const html = renderToStaticMarkup(
      createElement(PrinterDialog, { value: defaultPrintSettings, save: () => undefined }),
    );

    expect(html).toContain("PDF");
    expect(html).toContain("80 มม.");
    expect(html).toContain("58 มม.");
    expect(html).not.toContain("Windows ยังไม่มีคิวพิมพ์ที่ใช้งานได้");
    expect(html).not.toContain("เครื่องพิมพ์ Windows");
    expect(html).not.toContain("ส่งคำสั่ง ESC/POS โดยตรง");
  });

  it("shows PDF download and paper size configuration in ReceiptView on web", () => {
    const html = renderToStaticMarkup(
      createElement(ReceiptView, {
        receipt: sampleReceipt,
        settings: defaultPrintSettings,
        configure: () => undefined,
      }),
    );

    expect(html).toContain("ดาวน์โหลดใบเสร็จ (PDF)");
    expect(html).toContain("ตั้งค่าขนาดกระดาษ");
    expect(html).not.toContain("พิมพ์ใบเสร็จ");
  });
});
