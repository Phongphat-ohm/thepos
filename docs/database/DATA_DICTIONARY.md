# DATA DICTIONARY
## พจนานุกรมข้อมูล ชนิดข้อมูล และข้อกำหนดความถูกต้อง

---

## 1. มาตรฐานชนิดข้อมูลและการปัดเศษ (Data Type Conventions)

| หมวดหมู่ข้อมูล | ชนิดข้อมูลใน PostgreSQL | การจัดการใน TypeScript | วัตถุประสงค์และเหตุผล |
|---|---|---|---|
| **รหัสประจำตัว (Primary Key)** | `VARCHAR(36)` หรือ `UUID` | `string` | ใช้ UUID v4/v7 เพื่อความปลอดภัยและป้องกันการเดา ID |
| **จำนวนเงิน (Currency)** | `DECIMAL(12, 2)` | `Decimal` (`decimal.js`) | เก็บค่าเงินบาทไทย ทศนิยม 2 ตำแหน่ง ห้ามใช้ Float เด็ดขาด |
| **ต้นทุน / ราคาต่อหน่วย** | `DECIMAL(14, 4)` | `Decimal` (`decimal.js`) | ป้องกันการสูญเสียความแม่นยำเมื่อคำนวณราคาเฉลี่ยหรืออัตราทด |
| **จำนวนสินค้า (Quantity)** | `DECIMAL(12, 3)` | `Decimal` (`decimal.js`) | รองรับหน่วยนับละเอียด เช่น กิโลกรัม (ทศนิยม 3 ตำแหน่ง) |
| **อัตราส่วน / เปอร์เซ็นต์** | `DECIMAL(6, 4)` | `Decimal` (`decimal.js`) | รองรับอัตราเงินปันผล/ภาษี เช่น `0.0700` หรือ `0.0525` |
| **วันและเวลา (Timestamp)** | `TIMESTAMPTZ` | `Date` (ISO 8601 String) | บันทึกเวลาพร้อมเขตเวลา (Timezone Aware: Asia/Bangkok) |

---

## 2. รายละเอียดตารางและฟิลด์สำคัญ (Selected Table Specifications)

### 2.1 ตาราง `products` (สินค้า)
- `id` (UUID, PK): รหัสสินค้าภายใน
- `sku` (VARCHAR(50), UNIQUE): รหัสสินค้าสำหรับคลัง
- `name` (VARCHAR(255), NOT NULL): ชื่อสินค้าภาษาไทย
- `description` (TEXT): คำอธิบายสินค้า
- `category_id` (UUID, FK -> categories.id): หมวดหมู่สินค้า
- `base_unit` (VARCHAR(50), NOT NULL): หน่วยนับหลัก (เช่น ชิ้น, กล่อง)
- `cost_price` (DECIMAL(14,4), NOT NULL): ต้นทุนมาตรฐาน
- `regular_price` (DECIMAL(12,2), NOT NULL): ราคาขายปลีกทั่วไป
- `member_price` (DECIMAL(12,2), NOT NULL): ราคาขายพิเศษสำหรับสมาชิก
- `is_active` (BOOLEAN, DEFAULT true): สถานะเปิด/ปิดการขาย
- `track_stock` (BOOLEAN, DEFAULT true): เปิดใช้งานการติดตามสต็อกหรือไม่
- `track_expiration` (BOOLEAN, DEFAULT false): ติดตามวันหมดอายุหรือไม่ (กำหนดการตัดล็อต FEFO)

### Suppliers

- `id` and `store_id` identify the supplier and its store. The supplier name is unique within the store.
- `contact_name`, `phone`, `email`, and `address` are optional contact fields.
- `is_active` defaults to true, including for pre-existing suppliers. Inactive suppliers remain linked to historical receipts and lots. A new receipt requires an active supplier.

### 2.2 ตาราง `stock_lots` (ล็อตสินค้าคงคลัง)
- `id` (UUID, PK): รหัสล็อตสินค้า
- `product_id` (UUID, FK -> products.id): สินค้าประจำล็อต
- `lot_number` (VARCHAR(100), NOT NULL): หมายเลขล็อตจากผู้ผลิตหรือบิลรับเข้า
- `supplier_id` (UUID, FK -> suppliers.id): ผู้จัดจำหน่ายที่ส่งมอบ
- `goods_receipt_id` (UUID, FK -> goods_receipts.id): ใบรับสินค้าเข้า
- `initial_quantity` (DECIMAL(12,3), NOT NULL): จำนวนที่รับเข้าครั้งแรก
- `remaining_quantity` (DECIMAL(12,3), NOT NULL): จำนวนคงเหลือที่พร้อมขาย
- `unit_cost` (DECIMAL(14,4), NOT NULL): ต้นทุนจริงที่รับเข้าต่อหน่วย
- `expiration_date` (DATE, NULLABLE): วันหมดอายุ (ถ้ามี)
- `received_at` (TIMESTAMPTZ, NOT NULL): วันที่เวลาที่รับสินค้าเข้า
- **Constraint**: `CHECK (remaining_quantity >= 0)`

### 2.3 ตาราง `sales` (บิลขายหน้าร้าน)
- `id` (UUID, PK): รหัสรายการขาย
- `invoice_number` (VARCHAR(50), UNIQUE, NOT NULL): เลขที่ใบเสร็จ (เช่น `INV-20261116-0001`)
- `terminal_id` (UUID, FK -> devices.id): เครื่อง POS ที่ทำรายการ
- `cashier_id` (UUID, FK -> users.id): พนักงานแคชเชียร์
- `member_id` (UUID, FK -> members.id, NULLABLE): สมาชิกที่ซื้อ (เป็น Null ได้หากเป็นบุคคลทั่วไป)
- `status` (VARCHAR(30), NOT NULL): `PENDING`, `COMPLETED`, `CANCELLED`, `RETURNED`
- `subtotal` (DECIMAL(12,2), NOT NULL): ยอดรวมก่อนหักส่วนลด
- `discount_total` (DECIMAL(12,2), NOT NULL): ยอดส่วนลดรวม
- `tax_total` (DECIMAL(12,2), NOT NULL): ยอดภาษี (0.00 หากปิดระบบ VAT)
- `net_total` (DECIMAL(12,2), NOT NULL): ยอดสุทธิที่ต้องชำระ
- `idempotency_key` (UUID, UNIQUE, NOT NULL): คีย์ป้องกันการส่งคำขอซ้ำ
- `completed_at` (TIMESTAMPTZ): วันเวลาที่ยืนยันการขายสำเร็จ

### 2.4 ตาราง `sale_item_lot_allocations` (การจัดสรรล็อตสินค้าขาย)
- `id` (UUID, PK): รหัสรายการจัดสรร
- `sale_item_id` (UUID, FK -> sale_items.id): รายการสินค้าในบิลขาย
- `lot_id` (UUID, FK -> stock_lots.id): ล็อตสินค้าที่ถูกตัดขาย
- `quantity_allocated` (DECIMAL(12,3), NOT NULL): จำนวนที่หักออกจากล็อตนี้
- `unit_cost_snapshot` (DECIMAL(14,4), NOT NULL): ภาพถ่ายต้นทุนจริง ณ วันเวลาที่ขาย

### 2.5 ตาราง `member_purchase_ledgers` (สมุดบัญชียอดซื้อสะสมของสมาชิก)
- `id` (UUID, PK): รหัสรายการบัญชีซื้อ
- `member_id` (UUID, FK -> members.id): สมาชิกเจ้าของยอด
- `sale_id` (UUID, FK -> sales.id, NULLABLE): เชื่อมโยงบิลขาย
- `sale_return_id` (UUID, FK -> sale_returns.id, NULLABLE): เชื่อมโยงใบคืนสินค้า
- `transaction_type` (VARCHAR(30), NOT NULL): `SALE`, `RETURN`, `ADJUSTMENT`
- `gross_amount` (DECIMAL(12,2), NOT NULL): ยอดซื้อรวม
- `net_eligible_amount` (DECIMAL(12,2), NOT NULL): ยอดซื้อสุทธิที่เข้าเกณฑ์ได้รับเงินเฉลี่ยคืน
- งวดของรายการขายและคืนใช้ `recorded_at` ตามเวลา Asia/Bangkok ส่วนรายการปรับยอดอ้างงวดผ่าน `purchase_adjustments`
- `recorded_at` (TIMESTAMPTZ, NOT NULL): เวลาที่บันทึกรายการ

### 2.6 ตาราง `share_accounts` และ `share_transactions` (บัญชีหุ้นสหกรณ์)
- `share_accounts`: `id`, `member_id` (UNIQUE), `share_value` (DECIMAL(12,2), มูลค่าคงที่ต่อหุ้น) ยอดหุ้นคงเหลือคำนวณจากผลรวม `share_quantity` และมูลค่าคงเหลือคำนวณจากยอดหุ้นคูณมูลค่าต่อหุ้น
- `share_transactions`: `id`, `share_account_id`, `transaction_type` (`INITIAL`, `PURCHASE_ADD`, `TRANSFER`, `WITHDRAWAL`, `CORRECTION`), `share_quantity` (จำนวนหุ้นแบบมีเครื่องหมาย), `unit_value`, `total_amount`, `effective_date`, `recorded_at`, `approved_by`, `reason`, `transfer_id` (เชื่อมรายการโอนสองฝั่ง)
- `share_requests`: `store_id`, `key`, `fingerprint`, `transaction_id` ใช้ตรวจคำขอเดิมและป้องกันบันทึกซ้ำ

### 2.7 ตาราง `accounting_periods` (งวดบัญชีสหกรณ์)
- `id` (UUID, PK): รหัสงวดบัญชี
- `period_name` (VARCHAR(100), NOT NULL): ชื่องวดบัญชี (เช่น งวดปีบัญชี 2569)
- `start_date` (DATE, NOT NULL): วันเริ่มต้นงวด
- `end_date` (DATE, NOT NULL): วันสิ้นสุดงวด
- `status` (VARCHAR(30), NOT NULL): `DRAFT`, `CALCULATED`, `APPROVED_LOCKED`, `CLOSED`
- `locked_at` (TIMESTAMPTZ, NULLABLE): วันที่ล็อกผลอนุมัติ
- `locked_by` (UUID, FK -> users.id, NULLABLE): ผู้มีอำนาจที่อนุมัติล็อกงวด
- `rule_id`, `current_run_id`: รุ่นแม่แบบและผลจำลองที่เลือก งวดที่ปิดแล้วเก็บผลและรายการจ่ายย้อนหลัง

### 2.8 ตาราง `payout_obligations` และ `payouts` (ภาระผูกพันและการจ่ายเงินปันผล)
- `payout_obligations`: `id`, `member_id`, `accounting_period_id`, `dividend_amount`, `rebate_amount`, `total_obligation` ยอดจ่ายแล้วมาจากผลรวม `payout_allocations` ยอดคงค้างและสถานะคำนวณจากผลรวมนั้น
- `payouts`: `id`, `payout_receipt_number`, `payment_method` (`CASH`, `BANK_TRANSFER`), `total_amount`, `transfer_reference`, `paid_by_user_id`, `paid_at`, `idempotency_key` สมาชิกอ้างผ่าน `payout_allocations` และภาระผูกพัน
- `payout_allocations`: `payout_id`, `obligation_id`, `amount` ยอดจัดสรรต้องเท่ากับยอดใบจ่ายและจ่ายสะสมไม่เกินภาระผูกพัน

### 2.9 แม่แบบ ผลคำนวณ และรายการปรับยอด
- `dividend_rules` เก็บชื่อ รุ่น สูตรหุ้น และอัตราทั้งสองประเภท
- `dividend_runs` เก็บรุ่นที่ใช้ ผู้คำนวณ วันเวลา ผลรายสมาชิกและยอดรวม ณ เวลาคำนวณ
- `dividend_results` และ `purchase_rebate_results` เก็บยอดที่อนุมัติแยกประเภทตามรุ่นผลคำนวณและสมาชิก
- `purchase_adjustments` อ้างถึงงวดเปิดและรายการ `ADJUSTMENT` ในสมุดบัญชียอดซื้อ พร้อมผู้อนุมัติและเหตุผล

### 2.10 กะเงินสดและการกระทบยอด
- `cash_shifts` ระบุร้าน เครื่อง แคชเชียร์ เวลาเปิด และเงินทอนเริ่มกะ เครื่องหนึ่งมีกะเปิดได้เพียงกะเดียว เมื่อปิดจะบันทึกเวลาปิด ยอดตามระบบ ยอดนับจริง ผลต่าง เกณฑ์ผลต่าง และผู้อนุมัติถ้าต้องใช้ PIN
- `cash_movements` เป็นประวัติเพิ่มรายการอย่างเดียว เก็บยอดเป็นบวกและกำหนดทิศทางด้วยประเภท `SALE`, `REFUND`, `CASH_IN`, `CASH_DROP`, `PETTY_CASH` หรือ `PAYOUT_OUT` รายการอัตโนมัติอ้างบิลขาย ใบคืน หรือใบจ่ายต้นทาง
- `sale_items.category_name` เก็บชื่อหมวดหมู่ ณ เวลาขายสำหรับรายงาน รายการย้อนหลังที่ยังไม่มีข้อมูลนี้ใช้หมวดหมู่ปัจจุบัน
