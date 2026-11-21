import { paymentLabels, printerDate } from "@/lib/format";
import { invokeDesktop, isDesktopApp } from "@/lib/native";
import { isDarkPixel } from "./raster";
import { defaultPrintSettings, type PrintSettings, type Receipt } from "./types";

export { defaultPrintSettings, isDarkPixel, type PrintSettings, type Receipt };

export const listPrinters = () => (isDesktopApp() ? invokeDesktop<string[]>("receipt_printers") : Promise.resolve([]));

type Raster = { width: number; height: number; image: Uint8Array<ArrayBuffer> };

export async function rasterReceipt(receipt: Receipt, paper: 58 | 80): Promise<Raster> {
  await document.fonts.load("600 22px Kanit", "ใบเสร็จ บาท");
  const width = paper === 58 ? 384 : 576;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw "PRINT_FAILED";
  const context = ctx;
  const textWidth = width - 24;
  const normal = "600 21px Kanit, sans-serif";
  const bold = "700 25px Kanit, sans-serif";
  const lines: { text: string; font: string; rule?: boolean }[] = [];
  const segmenter = new Intl.Segmenter("th", { granularity: "grapheme" });
  function line(text: string, font = normal) {
    context.font = font;
    let row = "";
    for (const { segment } of segmenter.segment(text)) {
      if (row && context.measureText(row + segment).width > textWidth) {
        lines.push({ text: row, font });
        row = "";
      }
      row += segment;
    }
    lines.push({ text: row, font });
  }
  const rule = () => lines.push({ text: "", font: normal, rule: true });
  const logo = receipt.receiptLogo ? new Image() : null;
  if (logo && receipt.receiptLogo) {
    logo.src = receipt.receiptLogo;
    await logo.decode().catch(() => undefined);
  }
  const logoWidth = logo?.naturalWidth ? Math.min(width - 24, 160, logo.naturalWidth) : 0;
  const logoHeight = logo && logoWidth ? Math.ceil((logo.naturalHeight * logoWidth) / logo.naturalWidth) : 0;
  const logoSpace = logoHeight ? logoHeight + 12 : 0;
  line(receipt.storeName, bold);
  for (const text of receipt.receiptHeader?.split(/\r?\n/) ?? []) line(text);
  line("ใบเสร็จรับเงิน", bold);
  line(receipt.invoiceNumber);
  line(printerDate(receipt.completedAt));
  line("พนักงาน " + receipt.cashierName);
  if (receipt.memberName) line("สมาชิก " + receipt.memberName);
  rule();
  for (const item of receipt.items) {
    line(item.name);
    line(`${item.quantity} ${item.unit}  ${item.lineTotal} บาท`);
  }
  rule();
  line("รวมก่อนลด " + receipt.subtotal + " บาท");
  if (receipt.discountTotal !== "0.00") line("ส่วนลด " + receipt.discountTotal + " บาท");
  line("ยอดสุทธิ " + receipt.netTotal + " บาท", bold);
  for (const payment of receipt.payments) {
    line((paymentLabels[payment.method] ?? "ชำระเงิน") + " " + payment.amount + " บาท");
    if (payment.tendered) line("รับ " + payment.tendered + "  ทอน " + payment.change + " บาท");
    if (payment.reference) line("อ้างอิง " + payment.reference);
  }
  if (receipt.receiptFooter) {
    rule();
    for (const text of receipt.receiptFooter.split(/\r?\n/)) line(text);
  }
  const height = 24 + logoSpace + lines.length * 32;
  if (height > 8000) throw "PRINT_FAILED";
  canvas.height = height;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  if (logo && logoHeight) ctx.drawImage(logo, (width - logoWidth) / 2, 10, logoWidth, logoHeight);
  ctx.fillStyle = "#000";
  for (const [index, { text, font, rule: separator }] of lines.entries()) {
    const y = 30 + logoSpace + index * 32;
    if (separator) ctx.fillRect(12, y - 10, textWidth, 2);
    else {
      ctx.font = font;
      ctx.fillText(text, 12, y);
    }
  }
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const image = new Uint8Array((width * height) / 8);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4;
    if (isDarkPixel(rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!, rgba[offset + 3]!)) {
      image[pixel >> 3] |= 0x80 >> (pixel & 7);
    }
  }
  return { width, height, image };
}

export async function printReceipt(receipt: Receipt, settings: PrintSettings, freshCash: boolean) {
  if (!isDesktopApp()) {
    await downloadReceipt(receipt, settings);
    return;
  }
  if (!settings.printer) throw "PRINT_FAILED";
  const { width, height, image } = await rasterReceipt(receipt, settings.paper);
  let bytes = "";
  for (let offset = 0; offset < image.length; offset += 8192) {
    bytes += String.fromCharCode(...image.subarray(offset, offset + 8192));
  }
  await invokeDesktop("print_receipt", {
    job: {
      ...settings,
      width,
      height,
      raster: btoa(bytes),
      drawer: settings.escpos && settings.drawer && freshCash,
    },
  });
}

export function receiptPdf({ width, height, image }: Raster, paper: 58 | 80) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const offsets: number[] = [];
  let length = 0;
  function append(data: string | Uint8Array<ArrayBuffer>) {
    const chunk = typeof data === "string" ? encoder.encode(data) : data;
    chunks.push(chunk);
    length += chunk.length;
  }
  function object(id: number, body: string, stream?: Uint8Array<ArrayBuffer>) {
    offsets[id] = length;
    append(`${id} 0 obj\n${body}\n`);
    if (stream) {
      append("stream\n");
      append(stream);
      append("\nendstream\n");
    }
    append("endobj\n");
  }
  const mm = 72 / 25.4;
  const pageWidth = paper * mm;
  const imageWidth = (width / 203) * 72;
  const imageHeight = (height / 203) * 72;
  const margin = 3 * mm;
  const pageHeight = imageHeight + 2 * margin;
  const draw = encoder.encode(`q ${imageWidth} 0 0 ${imageHeight} ${(pageWidth - imageWidth) / 2} ${margin} cm /Receipt Do Q`);
  append("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Receipt 4 0 R >> >> /Contents 5 0 R >>`,
  );
  object(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 1 /Decode [1 0] /Length ${image.length} >>`,
    image,
  );
  object(5, `<< /Length ${draw.length} >>`, draw);
  const start = length;
  append("xref\n0 6\n0000000000 65535 f \n");
  for (const offset of offsets.slice(1)) append(`${String(offset).padStart(10, "0")} 00000 n \n`);
  append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
  return new Blob(chunks, { type: "application/pdf" });
}

export async function downloadReceipt(receipt: Receipt, settings: PrintSettings) {
  const blob = receiptPdf(await rasterReceipt(receipt, settings.paper), settings.paper);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = receipt.invoiceNumber.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-") + ".pdf";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
