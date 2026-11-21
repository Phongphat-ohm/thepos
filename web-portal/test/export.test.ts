import type { Report } from "@thepos/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportPdf, PDF_LINE_HEIGHT, PDF_ROW_PADDING, planRowSlices } from "@/features/reports/export";

describe("PDF pagination slice planning", () => {
  const pageTopY = 260;
  const maxPageY = 1190 - 75; // 1115

  it("keeps short rows on the current page when they fit", () => {
    const plan = planRowSlices(3, 300, pageTopY, maxPageY);
    expect(plan.startNewPageBefore).toBe(false);
    expect(plan.slices).toEqual([{ offset: 0, count: 3, breakAfter: false }]);
  });

  it("moves a row that fits on a fresh page without splitting it", () => {
    const nearBottomY = maxPageY - 60;
    const plan = planRowSlices(5, nearBottomY, pageTopY, maxPageY);
    expect(plan.startNewPageBefore).toBe(true);
    expect(plan.slices).toEqual([{ offset: 0, count: 5, breakAfter: false }]);
  });

  it("terminates without blank-page loops when a row taller than one page starts near the bottom", () => {
    const freshLines = Math.floor((maxPageY - pageTopY - PDF_ROW_PADDING) / PDF_LINE_HEIGHT);
    const maxLines = freshLines * 2 + 5;
    // Only 1 line of space left at bottom of previous page (the condition that previously infinite-looped)
    const nearBottomY = maxPageY - PDF_ROW_PADDING - PDF_LINE_HEIGHT;

    const plan = planRowSlices(maxLines, nearBottomY, pageTopY, maxPageY);
    expect(plan.startNewPageBefore).toBe(true);
    expect(plan.slices.length).toBe(3);

    // Every line from 0 to maxLines-1 must be covered contiguously with positive progress per slice
    let expectedOffset = 0;
    for (const [idx, slice] of plan.slices.entries()) {
      expect(slice.count).toBeGreaterThanOrEqual(1);
      expect(slice.offset).toBe(expectedOffset);
      expect(slice.breakAfter).toBe(idx < plan.slices.length - 1);
      expectedOffset += slice.count;
    }
    expect(expectedOffset).toBe(maxLines);
  });

  it("still makes forward progress even when pageTopY leaves tiny vertical space", () => {
    const plan = planRowSlices(4, 1100, 1100, 1115);
    expect(plan.startNewPageBefore).toBe(false);
    expect(plan.slices.map((s) => s.count)).toEqual([1, 1, 1, 1]);
  });
});

describe("exportPdf end-to-end with mocked canvas", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("completes and produces a PDF blob for a very long cell starting near the bottom of page 1", async () => {
    let downloadedBlob: Blob | undefined;
    let finishedPages = 0;

    const ctx = {
      fillStyle: "",
      font: "",
      textAlign: "left" as CanvasTextAlign,
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 14 }),
    };

    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (cb: (blob: Blob | null) => void) => {
        finishedPages++;
        cb(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }));
      },
    };

    const anchor = { href: "", download: "", click: vi.fn() };

    vi.stubGlobal("document", {
      fonts: { load: vi.fn(async () => []) },
      createElement: (tag: string) => (tag === "canvas" ? canvas : anchor),
    });
    vi.stubGlobal("window", { setTimeout: (fn: () => void) => { fn(); return 1; } });
    const createObjectURL = vi.fn((blob: Blob) => {
      downloadedBlob = blob;
      return "blob:mock";
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    // Fill page 1 near the bottom with short rows, then add a 2,500-char cell
    const fillerRows = Array.from({ length: 18 }, (_, idx) => [`R${idx + 1}`, "รายการปกติ", "10.00"]);
    const hugeRow = ["LONG", "ข้อความยาวมาก ".repeat(220), "999.00"];

    const report: Report = {
      store: "ร้านสหกรณ์ทดสอบ",
      title: "รายงานทดสอบเซลล์ยาว",
      start: "2026-11-01",
      end: "2026-11-21",
      columns: [{ label: "รหัส" }, { label: "รายละเอียด" }, { label: "ยอด", number: "money" }],
      rows: [...fillerRows, hugeRow],
      limited: false,
    };

    await exportPdf(report);

    expect(anchor.click).toHaveBeenCalledOnce();
    expect(downloadedBlob).toBeInstanceOf(Blob);
    expect(finishedPages).toBeGreaterThanOrEqual(2);
    expect(finishedPages).toBeLessThan(10);
    const header = await downloadedBlob!.slice(0, 8).text();
    expect(header).toBe("%PDF-1.4");
  });
});
