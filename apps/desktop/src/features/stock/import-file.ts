import { importColumns, importInput, importRowLimit, type ImportInput } from "@thepos/contracts";

export const importFormat = "หัวคอลัมน์ไม่ตรงกับแม่แบบ หรือมีข้อมูลที่อ่านไม่ได้";

export async function readProductFile(file: File): Promise<ImportInput> {
  if (file.size > 2 * 1024 * 1024) throw new Error("ไฟล์ต้องมีขนาดไม่เกิน 2 MB");
  const rows: ImportInput["rows"] = [];
  let headers: string[] = [];
  let barcodeCell: number | undefined;
  try {
    if (file.name.toLowerCase().endsWith(".csv")) {
      const { parse } = await import("csv-parse/browser/esm/sync");
      const records = parse(await file.text(), { bom: true, relax_column_count: true });
      headers = records[0] ?? [];
      records.slice(1).forEach((cells, index) => rows.push({ row: index + 2, cells }));
    } else if (file.name.toLowerCase().endsWith(".xlsx")) {
      const { Workbook } = await import("exceljs");
      const workbook = new Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error(importFormat);
      const header = sheet.getRow(1);
      for (let col = importColumns.length + 1; col <= header.cellCount; col++) {
        if (header.getCell(col).text.trim()) throw new Error(importFormat);
      }
      headers = Array.from({ length: importColumns.length }, (_, index) => header.getCell(index + 1).text);
      sheet.eachRow((row, number) => {
        if (number === 1) return;
        const barcode = row.getCell(8).value;
        if (barcode !== null && typeof barcode !== "string") barcodeCell ??= number;
        for (let col = importColumns.length + 1; col <= row.cellCount; col++) {
          if (row.getCell(col).text.trim()) throw new Error(importFormat);
        }
        rows.push({ row: number, cells: importColumns.map((_, index) => {
          const cell = row.getCell(index + 1);
          if (cell.value !== null && !["string", "number", "boolean"].includes(typeof cell.value)) {
            throw new Error(importFormat);
          }
          return cell.text;
        }) });
      });
    } else throw new Error(importFormat);
  } catch {
    if (!barcodeCell) throw new Error(importFormat);
  }
  if (barcodeCell) throw new Error(`แถว ${barcodeCell} ต้องตั้งคอลัมน์ barcodes เป็นข้อความและกรอกรหัสใหม่`);
  if (headers.length !== importColumns.length || importColumns.some((column, index) => column !== headers[index]?.trim())) {
    throw new Error(importFormat);
  }
  const data = rows.filter(({ cells }) => cells.some((cell) => cell.trim()));
  if (!data.length || data.length > importRowLimit) throw new Error(`ไฟล์ต้องมีสินค้า 1–${importRowLimit} รายการ`);
  if (data.some(({ cells }) => cells.length > importColumns.length)) throw new Error(importFormat);
  const input = importInput.safeParse({
    rows: data.map(({ row, cells }) => ({ row, cells: importColumns.map((_, index) => cells[index] ?? "") })),
  });
  if (!input.success) throw new Error("ข้อมูลในช่องยาวเกินขนาดที่รองรับ");
  return input.data;
}

export async function downloadProductTemplate(format: "csv" | "xlsx") {
  let content: Blob;
  if (format === "csv") {
    content = new Blob(["\uFEFF", importColumns.join(","), "\r\n"], { type: "text/csv;charset=utf-8" });
  } else {
    const { Workbook } = await import("exceljs");
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("สินค้า");
    sheet.columns = importColumns.map((header) => ({ header, width: 19, style: { numFmt: "@" } }));
    const bytes = await workbook.xlsx.writeBuffer();
    content = new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const url = URL.createObjectURL(content);
  const link = document.createElement("a");
  link.href = url;
  link.download = `thepos-products.${format}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
