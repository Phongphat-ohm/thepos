import type { Report } from "@thepos/contracts";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const sanitizeFilename = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
const filename = (report: Report, ext: string) =>
  sanitizeFilename(`thepos-${report.title}-${report.start}-${report.end}.${ext}`);

export async function exportExcel(report: Report) {
  const Excel = (await import("exceljs")).default;
  const book = new Excel.Workbook();
  const sheet = book.addWorksheet("รายงาน", { views: [{ state: "frozen", ySplit: 4 }] });
  sheet.mergeCells(1, 1, 1, report.columns.length);
  sheet.getCell("A1").value = report.title;
  sheet.getCell("A1").font = { name: "Tahoma", size: 16, bold: true, color: { argb: "FF1E3A8A" } };
  sheet.mergeCells(2, 1, 2, report.columns.length);
  sheet.getCell("A2").value = `${report.store} · ${report.start} ถึง ${report.end} (เวลาไทย)`;
  sheet.mergeCells(3, 1, 3, report.columns.length);
  sheet.getCell("A3").value = [report.note, report.limited && "แสดง 10,000 รายการแรก"].filter(Boolean).join(" · ");
  sheet.getRow(3).alignment = { wrapText: true }; sheet.getRow(3).height = 34;
  const header = sheet.getRow(4);
  header.values = report.columns.map(({ label }) => label);
  report.columns.forEach(({ number }, index) => { sheet.getColumn(index + 1).width = number ? 22 : 35; });
  header.height = 28;
  header.eachCell((cell) => {
    cell.font = { name: "Tahoma", color: { argb: "FFFFFFFF" }, bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  for (const values of report.rows) {
    const row = sheet.addRow(values);
    row.eachCell((cell, index) => {
      const type = report.columns[index - 1]?.number;
      const source = values[index - 1] ?? "";
      if (type && /^-?\d+(\.\d+)?$/.test(source) && source.replace(/[.\-]/g, "").length <= 15) {
        cell.value = Number(source);
        cell.numFmt = type === "money" ? "#,##0.00;[Red]-#,##0.00" : type === "quantity" ? "#,##0.000" : "#,##0";
      }
      cell.font = { name: "Tahoma", size: 11 };
      cell.alignment = { vertical: "top", wrapText: true };
    });
  }
  if (report.rows.length) sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + report.rows.length, column: report.columns.length } };
  const buffer = await book.xlsx.writeBuffer();
  download(new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename(report, "xlsx"));
}

function landscapePdf(images: Uint8Array<ArrayBuffer>[], width: number, height: number) {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const offsets: number[] = [];
  const encoder = new TextEncoder();
  let cursor = 0;
  function write(value: string | Uint8Array<ArrayBuffer>) {
    const chunk = typeof value === "string" ? encoder.encode(value) : value;
    chunks.push(chunk); cursor += chunk.length;
  }
  function object(id: number, dictionary: string, stream?: Uint8Array<ArrayBuffer>) {
    offsets[id] = cursor;
    write(`${id} 0 obj\n${dictionary}\n`);
    if (stream) { write("stream\n"); write(stream); write("\nendstream\n"); }
    write("endobj\n");
  }
  write("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Count ${images.length} /Kids [${images.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`);
  const drawing = encoder.encode("q 842 0 0 595 0 0 cm /Report Do Q");
  for (const [index, image] of images.entries()) {
    const id = 3 + index * 3;
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /XObject << /Report ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    object(id + 1, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>`, image);
    object(id + 2, `<< /Length ${drawing.length} >>`, drawing);
  }
  const xref = cursor;
  write(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) write(`${String(offset).padStart(10, "0")} 00000 n \n`);
  write(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: "application/pdf" });
}

export async function exportPdf(report: Report) {
  const sample = "รายงาน 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  await Promise.all([document.fonts.load("400 22px Kanit", sample), document.fonts.load("600 22px Kanit", sample)]);
  const canvas = document.createElement("canvas");
  canvas.width = 1684; canvas.height = 1190;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw "PRINT_FAILED";
  const margin = 62;
  const area = canvas.width - 2 * margin;
  const weights = report.columns.map(({ number }) => number ? 1 : 1.45);
  const widths = weights.map((weight) => area * weight / weights.reduce((sum, n) => sum + n, 0));
  const words = new Intl.Segmenter("th", { granularity: "word" });
  const graphemes = new Intl.Segmenter("th", { granularity: "grapheme" });
  const images: Uint8Array<ArrayBuffer>[] = [];
  let y = 0;

  function wrap(value: string, width: number) {
    const lines: string[] = [];
    let line = "";
    function add(segment: string) {
      if (line && ctx!.measureText(line + segment).width > width) {
        lines.push(line.trimEnd());
        line = "";
      }
      line += line ? segment : segment.trimStart();
    }
    for (const { segment } of words.segment(value)) {
      if (ctx!.measureText(segment).width <= width) add(segment);
      else for (const { segment: letter } of graphemes.segment(segment)) add(letter);
    }
    lines.push(line.trimEnd());
    return lines;
  }

  function draw(cells: string[][], header = false) {
    const height = Math.max(...cells.map((lines) => lines.length), 1) * 29 + 16;
    ctx!.fillStyle = header ? "#e9eff8" : "#ffffff";
    ctx!.fillRect(margin, y, area, height);
    ctx!.fillStyle = "#0f172a";
    let x = margin;
    for (const [index, lines] of cells.entries()) {
      const width = widths[index]!;
      const numeric = !header && !!report.columns[index]?.number;
      ctx!.textAlign = numeric ? "right" : "left";
      lines.forEach((line, i) => ctx!.fillText(line, numeric ? x + width - 10 : x + 10, y + 29 + i * 29));
      x += width;
    }
    y += height;
    ctx!.fillStyle = "#cbd5e1";
    ctx!.fillRect(margin, y, area, 1);
  }

  function startPage() {
    ctx!.fillStyle = "#fff"; ctx!.fillRect(0, 0, canvas.width, canvas.height);
    ctx!.textAlign = "left"; ctx!.fillStyle = "#1e3a8a"; ctx!.font = "600 40px Kanit";
    ctx!.fillText(report.title, margin, 92);
    ctx!.font = "400 22px Kanit"; ctx!.fillStyle = "#334155";
    ctx!.fillText(`${report.store} · ${report.start} ถึง ${report.end} (เวลาไทย)`, margin, 132);
    y = 164;
    const note = [report.note, report.limited && "แสดง 10,000 รายการแรก"].filter(Boolean).join(" · ");
    if (note) { for (const line of wrap(note, area)) { ctx!.fillText(line, margin, y); y += 30; } }
    ctx!.font = "600 22px Kanit";
    draw(report.columns.map(({ label }, index) => wrap(label, widths[index]! - 20)), true);
    ctx!.font = "400 22px Kanit";
  }

  async function finishPage() {
    ctx!.textAlign = "right"; ctx!.font = "400 20px Kanit"; ctx!.fillStyle = "#334155";
    ctx!.fillText(`หน้า ${images.length + 1}`, canvas.width - margin, canvas.height - 34);
    const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject("PRINT_FAILED"), "image/jpeg", 0.78));
    images.push(new Uint8Array(await jpeg.arrayBuffer()));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  startPage();
  const maxPageY = canvas.height - 75;
  for (const row of report.rows) {
    const cells = row.map((value, index) => wrap(value, widths[index]! - 20));
    const maxLines = Math.max(...cells.map((lines) => lines.length), 1);
    const fullHeight = maxLines * 29 + 16;
    if (y + fullHeight <= maxPageY) {
      draw(cells);
      continue;
    }
    const maxLinesPerPage = Math.max(1, Math.floor((maxPageY - y - 16) / 29));
    if (y > 260 && maxLines <= Math.floor((maxPageY - 260) / 29)) {
      await finishPage();
      startPage();
      draw(cells);
      continue;
    }
    let lineOffset = 0;
    while (lineOffset < maxLines) {
      const remainingLines = Math.max(1, Math.floor((maxPageY - y - 16) / 29));
      const sliceCount = lineOffset === 0 && maxLinesPerPage < 2 ? 0 : remainingLines;
      if (sliceCount <= 0) {
        await finishPage();
        startPage();
        continue;
      }
      const chunk = cells.map((colLines) => colLines.slice(lineOffset, lineOffset + sliceCount));
      draw(chunk);
      lineOffset += sliceCount;
      if (lineOffset < maxLines) {
        await finishPage();
        startPage();
      }
    }
  }
  if (!report.rows.length) { ctx.fillStyle = "#334155"; ctx.fillText("ไม่มีข้อมูลในช่วงที่เลือก", margin + 10, y + 36); }
  await finishPage();
  download(landscapePdf(images, canvas.width, canvas.height), filename(report, "pdf"));
}
