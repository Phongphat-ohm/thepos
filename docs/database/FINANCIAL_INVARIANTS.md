# FINANCIAL INVARIANTS & INTEGRITY RULES
## กฎเหล็กความถูกต้องทางการเงิน การตัดสต็อก และสูตรปันผล

เอกสารนี้ระบุหลักการทางคณิตศาสตร์และกฎความถูกต้องที่ไม่สามารถประนีประนอมได้ (Invariants) สำหรับระบบสหกรณ์ร้านค้าชุมชน เพื่อป้องกันข้อผิดพลาดทางการเงินและปัญหาทางกฎหมาย

---

## 1. กฎการคำนวณตัวเลขและทศนิยม (Monetary Arithmetic Invariants)

1. **ห้ามใช้ Binary Floating-Point เด็ดขาด**:
   - การคำนวณเงินทั้งหมดในภาษา TypeScript ต้องผ่านคลาส `Decimal` จากไลบรารี `decimal.js` หรือ Prisma `Decimal` เท่านั้น
   - ในฐานข้อมูล PostgreSQL ฟิลด์ตัวเงินต้องเป็นชนิด `DECIMAL(12, 2)` และต้นทุนต่อหน่วยเป็น `DECIMAL(14, 4)`
2. **นโยบายการปัดเศษ (Rounding Policy)**:
   - รายการสินค้าในบิล: `line_total = round(quantity * unit_price - discount, 2)` (ปัดเศษแบบ Half-Up ไปยังทศนิยม 2 ตำแหน่ง)
   - ยอดสุทธิของบิล: `net_total = sum(line_totals) - bill_discount`
   - ผลรวมของการชำระเงิน: `sum(payment_amounts) == net_total` โดยไม่มีผลต่างแม้แต่เศษสตางค์เดียว
3. **การกระทบยอดเงินทอน (Cash Tender & Change)**:
   - `change_amount = cash_tendered - net_total_allocated_to_cash`
   - `change_amount >= 0.00` เสมอ ห้ามรับเงินสดต่ำกว่ายอดที่ต้องชำระ

---

## 2. กฎความสมบูรณ์ของสต็อกและต้นทุน (Stock & COGS Invariants)

1. **การไม่ติดลบของสต็อก (Non-negative Inventory)**:
   - ทุกล็อตสินค้าต้องมี `remaining_quantity >= 0` ซึ่งบังคับด้วย Database CHECK Constraint
   - การตัดสต็อกต้องใช้คำสั่งแบบล็อกแถว:
     ```sql
     SELECT * FROM stock_lots
     WHERE product_id = $1 AND remaining_quantity > 0
     ORDER BY expiration_date ASC NULLS LAST, received_at ASC
     FOR UPDATE;
     ```
2. **การคงอยู่ของต้นทุนประวัติศาสตร์ (Historical COGS Snapshot)**:
   - เมื่อเกิดการขาย ระบบจะบันทึกล็อตที่ถูกตัดและราคาต้นทุนจริง ณ วันที่ขายลงในตาราง `sale_item_lot_allocations`
   - กำไรขั้นต้น (Gross Profit) ของการขายในอดีต จะต้องคำนวณจาก `unit_cost_snapshot` เสมอ ห้ามนำต้นทุนสินค้าปัจจุบันไปคำนวณย้อนหลังเด็ดขาด
3. **การคืนสินค้า (Return Quantity Cap)**:
   - สินค้าที่จะรับคืนได้ ต้องมีจำนวน `return_quantity <= sold_quantity - previously_returned_quantity`

---

## 3. กฎการคำนวณเงินปันผลและเงินเฉลี่ยคืน (Dividend & Rebate Invariants)

### 3.1 การแยกประเภทผลตอบแทน (Strict Separation)
- **เงินปันผลตามหุ้น (Share Dividend)**: ตอบแทนตาม "เงินทุน" ที่สมาชิกนำมาลงหุ้นกับสหกรณ์
- **เงินเฉลี่ยคืนตามยอดซื้อ (Purchase Rebate)**: ตอบแทนตาม "การมีส่วนร่วมทางธุรกิจ" ของสมาชิกที่มาอุดหนุนสินค้า
- **กฎเหล็ก**: ห้ามรวมสูตรการคำนวณทั้งสองประเภทนี้เข้าเป็นสูตรเดียวที่ไม่มีเอกสารรับรอง

### 3.2 สูตรการคำนวณเงินปันผลตามหุ้น (Share Dividend Formulas)
- **แม่แบบ A (End-of-Year Balance)**:
  $$\text{Dividend} = \text{Share Balance at Period End} \times \text{Approved Dividend Rate}$$
- **แม่แบบ B (Time-Weighted Monthly Balance)**:
  $$\text{Dividend} = \left( \frac{\sum_{m=1}^{12} \text{Eligible Share Balance}_m}{12} \right) \times \text{Approved Dividend Rate}$$

### 3.3 สูตรการคำนวณเงินเฉลี่ยคืนตามยอดซื้อ (Purchase Rebate Formula)
$$\text{Purchase Rebate} = (\text{Total Member Purchases in Period} - \text{Refunds/Returns}) \times \text{Rebate Rate}$$

### 3.4 การปิดงวดบัญชีอย่างไม่สามารถเปลี่ยนแปลงได้ (Immutability of Closed Periods)
1. เมื่องวดบัญชีได้รับการอนุมัติ สถานะจะเปลี่ยนเป็น `APPROVED_LOCKED`
2. ระบบจะสร้าง `payout_obligations` ผูกกับสมาชิกทุกคนที่มีสิทธิ์
3. ข้อมูลใน `dividend_results` และ `purchase_rebate_results` จะไม่สามารถถูกแก้ไข ลบ หรือเขียนทับได้อีกต่อไป
4. หากพบความผิดพลาดหรือมีการคืนสินค้าในภายหลัง จะต้องบันทึกเป็นรายการปรับปรุง (Adjustment) ในงวดบัญชีปัจจุบันที่ยังเปิดอยู่เท่านั้น

---

## 4. กฎการจ่ายเงินปันผล (Payout Invariants)

1. **ยอดจ่ายสะสมไม่เกินภาระผูกพัน**:
   $$\sum \text{Allocated Payouts} \le \text{Total Obligation}$$
   ห้ามจ่ายเงินเกินสิทธิ์ที่ได้รับอนุมัติ เว้นแต่จะมีการบันทึก Adjustment ที่ได้รับการอนุมัติเป็นลายลักษณ์อักษร
2. **การจ่ายเงินสดต้องกระทบยอดกับกะแคชเชียร์**:
   - หากจ่ายเงินปันผลด้วยเงินสดจากลิ้นชักหน้าร้าน จะต้องบันทึกเป็นรายการ `CASH_DROP` หรือ `PAYOUT_OUT` ในกะแคชเชียร์ปัจจุบัน เพื่อให้ยอดเงินสดในลิ้นชักกระทบยอดถูกต้อง
