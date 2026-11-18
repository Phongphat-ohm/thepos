# REQUIREMENT TRACEABILITY MATRIX (RTM)
## ตารางสอบกลับความต้องการของระบบ

ตารางนี้เชื่อมโยงระหว่างข้อกำหนดความต้องการเชิงฟังก์ชัน (SRS Requirements), สถาปัตยกรรมและโมดูลซอฟต์แวร์, ตารางฐานข้อมูล, เฟสการพัฒนา และชุดการทดสอบ

| รหัสความต้องการ | รายละเอียดความต้องการ | โมดูลที่รับผิดชอบ | ตารางฐานข้อมูลที่เกี่ยวข้อง | เฟสที่พัฒนา | ชุดการทดสอบหลัก |
|---|---|---|---|---|---|
| **FR-PROD-01** | ข้อมูลสินค้า SKU และราคา | `modules/products` | `products`, `categories` | Phase 2 | `test/products.crud.test.ts` |
| **FR-PROD-02** | สินค้าหลายบาร์โค้ด | `modules/products` | `product_barcodes` | Phase 2 | `test/products.barcode.test.ts` |
| **FR-PROD-03** | การแปลงหน่วยนับ | `modules/products` | `product_unit_conversions` | Phase 2 | `test/unit.conversion.test.ts` |
| **FR-PROD-04** | นำเข้าสินค้าผ่าน Excel/CSV | `modules/products` | `products`, `product_barcodes` | Phase 2 | `test/products.import.test.ts` |
| **FR-INV-01** | รับสินค้าเข้าคลังตามล็อต | `modules/inventory` | `goods_receipts`, `stock_lots` | Phase 2 | `test/inventory.receipt.test.ts` |
| **FR-INV-02** | ตัดล็อตแบบ FEFO/FIFO | `modules/inventory` | `stock_lots`, `stock_movements` | Phase 2 | `test/inventory.fefo_fifo.test.ts` |
| **FR-INV-03** | บันทึกประวัติการเคลื่อนไหวสต็อก | `modules/inventory` | `stock_movements` | Phase 2 | `test/inventory.movement.test.ts` |
| **FR-INV-04** | ป้องกันสต็อกติดลบและการแย่งสต็อก | `modules/sales` | `stock_lots` (Check constraint) | Phase 3 | `test/concurrency.stock.test.ts` |
| **FR-INV-05** | การตรวจนับและปรับปรุงสต็อก | `modules/inventory` | `stock_adjustments`, `stock_counts` | Phase 2 | `test/inventory.count.test.ts` |
| **FR-POS-01** | หน้าจอขาย แป้นพิมพ์ลัด F2–F10 | `features/pos` (Desktop) | N/A (Frontend State / Zustand) | Phase 3 | `test/ui.shortcuts.spec.ts` |
| **FR-POS-02** | รับค่ายิงบาร์โค้ด USB HID | `features/pos` (Desktop) | `product_barcodes` | Phase 3 | `test/ui.barcode.spec.ts` |
| **FR-POS-03** | เปิดหลายบิลพร้อมกันและพักบิล | `features/pos` (Desktop) | `held_sales` | Phase 3 | `test/pos.held_bills.test.ts` |
| **FR-POS-04** | ดึงราคาสมาชิกอัตโนมัติ | `features/pos`, `modules/sales` | `products`, `members` | Phase 3 | `test/sales.member_price.test.ts` |
| **FR-POS-05** | การให้ส่วนลดและอนุมัติด้วย PIN | `modules/sales` | `sales`, `approval_decisions` | Phase 3 | `test/sales.discounts.test.ts` |
| **FR-POS-06** | ชำระเงินสด, QR, โอน, แยกชำระ | `modules/sales` | `sale_payments` | Phase 3 | `test/sales.payments.test.ts` |
| **FR-POS-07** | ยืนยันบิลแบบ Atomic & Idempotent | `modules/sales` | `sales`, `idempotency_records` | Phase 3 | `test/sales.idempotency.test.ts` |
| **FR-POS-08** | พิมพ์ใบเสร็จ ESC/POS & เตะลิ้นชัก | `src-tauri/hardware` | `system_settings` | Phase 3 | `test/hardware.escpos.test.ts` |
| **FR-RET-01** | คืนสินค้าเต็มบิลและบางรายการ | `modules/returns` | `sale_returns`, `sale_return_items` | Phase 3 | `test/returns.partial.test.ts` |
| **FR-RET-02** | คืนไม่เกินจำนวนขายจริง | `modules/returns` | `sale_return_items`, `sale_items` | Phase 3 | `test/returns.quantity.test.ts` |
| **FR-RET-03** | ส่งผลย้อนกลับต่อสต็อกและยอดซื้อ | `modules/returns` | `stock_movements`, `member_ledgers` | Phase 3 | `test/returns.reversal.test.ts` |
| **FR-RET-04** | อนุมัติการคืนด้วย PIN ผู้จัดการ | `modules/returns` | `approval_decisions` | Phase 3 | `test/returns.approval.test.ts` |
| **FR-MEM-01** | ทะเบียนสมาชิกและการปกป้องข้อมูล | `modules/members` | `members` (AES encrypted ID) | Phase 4 | `test/members.crud.test.ts` |
| **FR-MEM-02** | สมุดบัญชียอดซื้อสะสมของสมาชิก | `modules/members` | `member_purchase_ledgers` | Phase 4 | `test/members.ledger.test.ts` |
| **FR-MEM-03** | บัญชีหุ้นและการเคลื่อนไหวหุ้น | `modules/shares` | `share_accounts`, `share_trans` | Phase 4 | `test/shares.transactions.test.ts` |
| **FR-DIV-01** | การจัดการงวดบัญชี | `modules/dividends` | `accounting_periods` | Phase 5 | `test/dividends.periods.test.ts` |
| **FR-DIV-02** | แยกสูตรปันผลหุ้นและเฉลี่ยคืนยอดซื้อ | `modules/dividends` | `dividend_results`, `rebate_res` | Phase 5 | `test/dividends.formulas.test.ts` |
| **FR-DIV-03** | แม่แบบกฎการคำนวณ (Rule Templates)| `modules/dividends` | `dividend_rules` | Phase 5 | `test/dividends.rules.test.ts` |
| **FR-DIV-04** | การจำลองผลการคำนวณ (Preview) | `modules/dividends` | `dividend_runs` (Draft status) | Phase 5 | `test/dividends.preview.test.ts` |
| **FR-DIV-05** | การล็อกผลอนุมัติและสร้างภาระผูกพัน | `modules/dividends` | `payout_obligations` | Phase 5 | `test/dividends.lock.test.ts` |
| **FR-DIV-06** | การบันทึกจ่ายเงินปันผล/ยอดคงค้าง | `modules/payouts` | `payouts`, `payout_allocations` | Phase 5 | `test/payouts.tracking.test.ts` |
| **FR-SFT-01** | เปิดกะพร้อมเงินทอนเริ่มต้น | `modules/shifts` | `cash_shifts` | Phase 6 | `test/shifts.open.test.ts` |
| **FR-SFT-02** | บันทึกเงินเข้าออกระหว่างกะ | `modules/shifts` | `cash_movements` | Phase 6 | `test/shifts.movements.test.ts` |
| **FR-SFT-03** | ปิดกะและกระทบยอดเงินสดขาด/เกิน | `modules/shifts` | `cash_shifts` | Phase 6 | `test/shifts.reconcile.test.ts` |
| **FR-RPT-01** | แดชบอร์ดสรุปยอดขายตามสิทธิ์ | `modules/reports` | Aggregation queries | Phase 6 | `test/reports.dashboard.test.ts` |
| **FR-RPT-03** | รายงานกำไรขั้นต้นตามล็อตสินค้าจริง | `modules/reports` | `sale_item_lot_allocations` | Phase 6 | `test/reports.profit.test.ts` |
| **FR-RPT-06** | ส่งออกรายงาน Excel และ PDF | `modules/reports` | Export engines | Phase 6 | `test/reports.export.test.ts` |
| **FR-CFG-01** | ตัวช่วยติดตั้งครั้งแรก (Setup Wizard) | `features/wizard` | `stores`, `users`, `devices` | Phase 1 | `test/wizard.bootstrap.test.ts` |
| **FR-CFG-02** | ตั้งค่าใบเสร็จและทดสอบฮาร์ดแวร์ | `features/settings` | `system_settings` | Phase 7 | `test/settings.printer.test.ts` |
| **FR-CFG-03** | โครงสร้างภาษีมูลค่าเพิ่ม (VAT Ready) | `modules/settings` | `system_settings`, `products` | Phase 7 | `test/settings.vat.test.ts` |
