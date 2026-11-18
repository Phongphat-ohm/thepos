# MODULE DEPENDENCIES & COUPLING MAP
## แผนผังความเชื่อมโยงระหว่างโมดูล

เอกสารนี้แสดงการพึ่งพากันระหว่างโมดูล (Module Dependency Graph) เพื่อให้มั่นใจว่าการออกแบบเป็นไปตามหลัก Modular Architecture โดยไม่มีการเกิด Circular Dependency หรือการเชื่อมโยงข้ามขอบเขตอย่างไม่เหมาะสม

---

## 1. แผนผังการพึ่งพาของระบบ (Dependency Graph)

```mermaid
graph TD
    Shared["@thepos/shared (Decimal Math, Constants)"]
    Contracts["@thepos/contracts (Zod Schemas & DTOs)"]
    
    Contracts --> Shared

    subgraph ServerModules["apps/server (Backend Modules)"]
        Audit["modules/audit"]
        Auth["modules/auth"]
        Settings["modules/settings"]
        Products["modules/products"]
        Inventory["modules/inventory"]
        Members["modules/members"]
        Shares["modules/shares"]
        Sales["modules/sales"]
        Returns["modules/returns"]
        Shifts["modules/shifts"]
        Dividends["modules/dividends"]
        Payouts["modules/payouts"]
        Reports["modules/reports"]

        Auth --> Audit
        Settings --> Audit
        Products --> Audit
        Products --> Auth
        Inventory --> Products
        Inventory --> Audit
        Sales --> Inventory
        Sales --> Products
        Sales --> Members
        Sales --> Auth
        Sales --> Audit
        Returns --> Sales
        Returns --> Inventory
        Returns --> Members
        Returns --> Audit
        Members --> Audit
        Shares --> Members
        Shares --> Audit
        Shifts --> Auth
        Shifts --> Sales
        Shifts --> Audit
        Dividends --> Members
        Dividends --> Sales
        Dividends --> Shares
        Dividends --> Audit
        Payouts --> Dividends
        Payouts --> Members
        Payouts --> Shifts
        Payouts --> Audit
        Reports --> Sales
        Reports --> Inventory
        Reports --> Members
        Reports --> Dividends
        Reports --> Shifts
    end

    subgraph DesktopFeatures["apps/desktop (Frontend Features)"]
        POSFeature["features/pos"]
        ProductFeature["features/products"]
        InventoryFeature["features/inventory"]
        MemberFeature["features/members"]
        DividendFeature["features/dividends"]
        ShiftFeature["features/shifts"]
        ReportFeature["features/reports"]
        SettingFeature["features/settings"]
        WizardFeature["features/wizard"]

        POSFeature --> Contracts
        POSFeature --> Shared
        ProductFeature --> Contracts
        InventoryFeature --> Contracts
        MemberFeature --> Contracts
        DividendFeature --> Contracts
        ShiftFeature --> Contracts
        ReportFeature --> Contracts
        SettingFeature --> Contracts
        WizardFeature --> Contracts
    end

    ServerModules --> Contracts
    ServerModules --> Shared
```

---

## 2. กฎเกณฑ์การจัดลำดับการพัฒนาและการประกอบโมดูล (Dependency Rules)

1. **ระดับฐานราก (Foundation Layer)**:
   - `@thepos/shared` และ `@thepos/contracts` จะต้องถูกสร้างขึ้นก่อนโมดูลอื่นเสมอ
2. **โมดูลแกนหลักด้านการตรวจสอบสิทธิ์ (Core Auth & Audit)**:
   - `modules/auth` และ `modules/audit` เป็นพื้นฐานที่ทุกโมดูลต้องเรียกใช้เพื่อตรวจสอบสิทธิ์และบันทึกประวัติ
3. **โมดูลสินค้าและคลัง (Catalog & Inventory)**:
   - `modules/products` ต้องพร้อมก่อน `modules/inventory` เพราะล็อตสินค้า (Stock Lots) ต้องผูกโยงกับข้อมูลสินค้า
4. **โมดูลการขาย (Sales & POS)**:
   - `modules/sales` พึ่งพา `products`, `inventory`, `members` และ `auth` เพื่อประมวลผลการตัดล็อตสินค้าและบันทึกยอดสะสมสมาชิกอย่างครบวงจร
5. **โมดูลการเงินและปันผล (Dividends & Payouts)**:
   - `modules/dividends` จะประมวลผลได้ต่อเมื่อมีข้อมูล `sales` (สำหรับคำนวณเงินเฉลี่ยคืนยอดซื้อ) และ `shares` (สำหรับคำนวณเงินปันผลตามหุ้น) อย่างสมบูรณ์
