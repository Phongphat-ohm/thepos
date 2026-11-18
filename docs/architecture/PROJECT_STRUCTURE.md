# PROJECT STRUCTURE & MONOREPO ARCHITECTURE
## โครงสร้างโปรเจกต์และข้อกำหนดการจัดวางไฟล์

---

## 1. แผนผังโฟลเดอร์โดยสมบูรณ์ (Monorepo Directory Layout)

```text
thepos/
├── apps/
│   ├── desktop/                         # แอปพลิเคชันเดสก์ท็อปหน้าร้าน POS (Tauri 2 + React)
│   │   ├── src/
│   │   │   ├── app/                     # App Router, Layouts, Providers
│   │   │   ├── features/
│   │   │   │   ├── pos/                 # หน้าขายหลัก, แป้นพิมพ์ลัด, ตัวสแกนบาร์โค้ด
│   │   │   │   ├── products/            # รายการสินค้า, การเพิ่ม/แก้ไข, หมวดหมู่
│   │   │   │   ├── inventory/           # รับสินค้าเข้า, สต็อกล็อต, ตรวจนับสต็อก
│   │   │   │   ├── members/             # ทะเบียนสมาชิก, บัญชีหุ้น, ประวัติยอดซื้อ
│   │   │   │   ├── dividends/           # คำนวณเงินปันผล/เฉลี่ยคืน, อนุมัติ, จ่ายเงิน
│   │   │   │   ├── shifts/              # เปิด-ปิดกะ, นับเงินสดในลิ้นชัก, กระทบยอด
│   │   │   │   ├── reports/             # แดชบอร์ด, รายงานยอดขาย, กำไร, ส่งออก Excel/PDF
│   │   │   │   ├── settings/            # ตั้งค่าร้านค้า, ฮาร์ดแวร์, ภาษี, ใบเสร็จ
│   │   │   │   └── wizard/              # ตัวช่วยติดตั้งครั้งแรก (Setup Wizard)
│   │   │   ├── components/
│   │   │   │   ├── ui/                  # shadcn/ui primitives (Button, Dialog, Table ฯลฯ)
│   │   │   │   └── common/              # คอมโพเนนต์ส่วนกลาง (Header, Modal, Toast)
│   │   │   ├── hooks/                   # useKeyboardShortcuts, useBarcodeScanner, useCart
│   │   │   ├── services/                # บริการเรียกใช้งาน API ฝั่งเซิร์ฟเวอร์
│   │   │   ├── stores/                  # Zustand stores (useCartStore, useShiftStore)
│   │   │   ├── lib/                     # ฟังก์ชันยูทิลิตี (ตัวแปลงเงิน, วันที่ภาษาไทย, เสียงเตือน)
│   │   │   ├── i18n/                    # พจนานุกรมคำแปลภาษาไทยส่วนกลาง
│   │   │   ├── styles/                  # Tailwind CSS, Theme variables (Light Mode)
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── src-tauri/                   # Rust Backend สำหรับ Tauri 2
│   │   │   ├── Cargo.toml
│   │   │   ├── tauri.conf.json          # การกำหนดค่าสิทธิ์และความปลอดภัยของ Tauri
│   │   │   └── src/
│   │   │       ├── main.rs
│   │   │       ├── hardware/            # ESC/POS Thermal Printer Adapter & Drawer
│   │   │       └── security/            # Windows Credential Vault Integration
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── server/                          # บริการเซิร์ฟเวอร์ส่วนกลาง (Bun + Hono + Prisma)
│       ├── src/
│       │   ├── index.ts                 # Server Entrypoint
│       │   ├── modules/                 # โดเมนเซอร์วิสและเร้าเตอร์ (Domain Modules)
│       │   │   ├── auth/                # Login, PIN verification, Sessions, Devices
│       │   │   ├── products/            # สินค้า, หลายบาร์โค้ด, แปลงหน่วยนับ
│       │   │   ├── inventory/           # รับสินค้า, ล็อต FEFO/FIFO, ปรับปรุงสต็อก
│       │   │   ├── sales/               # ขายหน้าร้าน, หักสต็อกแบบ Atomic, Idempotency
│       │   │   ├── returns/             # คืนสินค้า, คืนสต็อกเข้าล็อต, ปรับยอดซื้อ
│       │   │   ├── members/             # สมาชิก, สมุดบัญชียอดซื้อ (Purchase Ledger)
│       │   │   ├── shares/              # บัญชีหุ้น, เพิ่ม/ลด/โอนหุ้น, ประวัติหุ้น
│       │   │   ├── dividends/           # งวดบัญชี, กฎปันผล, คำนวณผล, ล็อกอนุมัติ
│       │   │   ├── payouts/             # ภาระผูกพัน, จ่ายเงินสด/โอน, ติดตามคงค้าง
│       │   │   ├── shifts/              # กะแคชเชียร์, เงินทอน, กระทบยอดเงินขาดเกิน
│       │   │   ├── reports/             # สรุปยอดขาย, กำไรขั้นต้นตามล็อต, ส่งออกไฟล์
│       │   │   ├── settings/            # ข้อมูลร้านค้า, ตั้งค่าภาษี, รูปแบบใบเสร็จ
│       │   │   └── audit/               # บันทึกประวัติการแก้ไขที่ไม่สามารถเปลี่ยนแปลงได้
│       │   ├── middleware/              # CORS, RateLimit, Auth, RBAC, Idempotency, Logging
│       │   ├── lib/                     # Decimal helper, วันที่, รหัสข้อผิดพลาด
│       │   └── prisma/
│       │       ├── schema.prisma        # Schema ฐานข้อมูลอย่างสมบูรณ์
│       │       └── migrations/          # สคริปต์ Migration ตามเวอร์ชัน
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   ├── contracts/                       # สัญญา API ร่วม (Shared Zod Schemas & DTOs)
│   │   ├── src/
│   │   │   ├── auth.contract.ts
│   │   │   ├── products.contract.ts
│   │   │   ├── inventory.contract.ts
│   │   │   ├── sales.contract.ts
│   │   │   ├── members.contract.ts
│   │   │   ├── dividends.contract.ts
│   │   │   ├── shifts.contract.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── shared/                          # ยูทิลิตีการคำนวณและค่าคงที่ส่วนกลาง
│   │   ├── src/
│   │   │   ├── decimal.ts               # เครื่องมือคำนวณ Decimal ป้องกัน Floating-Point
│   │   │   ├── constants.ts             # Roles, Permissions, PaymentMethods, ShiftStatus
│   │   │   ├── formatters.ts            # การจัดรูปแบบเงินบาทไทย และวันที่ พ.ศ.
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── config/                          # การตั้งค่าเครื่องมือส่วนกลาง (ESLint, Prettier)
│       ├── eslint.config.js
│       ├── prettier.config.js
│       └── tsconfig.base.json
│
├── infra/
│   ├── docker/
│   │   ├── docker-compose.prod.yml      # Caddy + Bun API + Postgres 16 Production Stack
│   │   ├── docker-compose.dev.yml       # Local PostgreSQL Container สำหรับการพัฒนา
│   │   ├── Dockerfile.server            # Multi-stage Dockerfile สำหรับ Bun Server
│   │   └── Caddyfile                    # การตั้งค่า HTTPS Reverse Proxy อัตโนมัติ
│   └── backup/
│       ├── backup.sh                    # สคริปต์สำรองฐานข้อมูลพร้อมเข้ารหัส GPG
│       └── restore.sh                   # สคริปต์กู้คืนฐานข้อมูลที่ผ่านการทดสอบจริง
│
├── docs/                                # เอกสารโครงการทั้งหมด (SRS, ERD, Roadmap ฯลฯ)
├── package.json                         # Bun Root Workspace Configuration
├── PROJECT_MASTER_SPEC.md               # ข้อกำหนดและระเบียบการสำหรับ AI ทุกตัว
└── README.md                            # คู่มือแนะนำโครงการ
```

---

## 2. กฎการนำเข้าโมดูลข้ามแพ็กเกจ (Package Import Rules)

1. **`@thepos/contracts`**:
   - ใช้เป็น Single Source of Truth สำหรับ Data Transfer Objects (DTOs) และ Zod Validation Schemas
   - ห้ามมี Dependency ผูกกับฐานข้อมูลหรือ UI
   - ทั้ง `apps/desktop` และ `apps/server` นำเข้าสัญญานี้ไปใช้งานร่วมกัน
2. **`@thepos/shared`**:
   - บรรจุฟังก์ชันการคำนวณ Decimal เลขคณิตแท้จริง และค่าคงที่ระบบ
   - เป็น Pure TypeScript ไร้ Side-effect สามารถรันได้ทั้งบนเบราว์เซอร์, Node และ Bun
3. **การแยกส่วนฮาร์ดแวร์**:
   - คำสั่งที่เกี่ยวข้องกับเครื่องพิมพ์ใบเสร็จและลิ้นชักเก็บเงิน จะต้องเรียกผ่าน Tauri IPC Commands ไปยัง `src-tauri/hardware` เท่านั้น ห้ามเรียก API ของระบบปฏิบัติการโดยตรงจากฝั่ง React UI
