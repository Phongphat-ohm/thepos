import { importColumns } from "@thepos/contracts";
import { Workbook } from "exceljs";
import { expect, it } from "vitest";
import { readProductFile } from "./import-file";

it("reads quoted UTF-8 CSV and preserves leading-zero barcodes", async () => {
  const content = "\uFEFF" + importColumns.join(",") + '\r\nA,"ชา, เย็น",เครื่องดื่ม,ขวด,1.0000,2.10,2.00,000123,,true,false\r\n';
  const result = await readProductFile(new File([content], "products.csv"));
  expect(result.rows[0]).toMatchObject({
    row: 2,
    cells: ["A", "ชา, เย็น", "เครื่องดื่ม", "ขวด", "1.0000", "2.10", "2.00", "000123", "", "true", "false"],
  });
});

it("imports Excel barcodes as text and rejects numeric barcode cells", async () => {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("สินค้า");
  sheet.addRow([...importColumns]);
  const row = sheet.addRow(["B", "น้ำดื่ม", "เครื่องดื่ม", "ขวด", "0.1200", "1.20", "1.10", "000999"]);
  const file = async () => new File([new Uint8Array(await workbook.xlsx.writeBuffer())], "products.xlsx");
  expect((await readProductFile(await file())).rows[0].cells[7]).toBe("000999");
  row.getCell(8).value = 999;
  await expect(readProductFile(await file())).rejects.toThrow("คอลัมน์ barcodes");
});
