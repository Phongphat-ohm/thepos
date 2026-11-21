async (page) => {
  for (const format of ['excel','pdf']) {
    const downloadPromise=page.waitForEvent('download');
    await page.evaluate(async format=>{
      const exporter=await import('/src/ui/features/reports/export.ts');
      const fixture={store:'ร้านจำลองสำหรับตรวจ',title:'รายงานทดสอบ',start:'2026-10-31',end:'2026-11-01',columns:[{label:'สินค้า'},{label:'ยอดสุทธิ',number:'money'}],rows:[['สินค้า ก','20.50'],['สินค้า ข','-5.25']],note:'ข้อมูลจำลองสำหรับตรวจเท่านั้น',limited:true};
      await exporter[format==='excel'?'exportExcel':'exportPdf'](fixture);
    },format);
    const download=await downloadPromise;
    await download.saveAs('output/playwright/portal-audit-2026-11-21/sample.'+(format==='excel'?'xlsx':'pdf'));
  }
}
