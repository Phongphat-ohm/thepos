# PROJECT STRUCTURE & MONOREPO ARCHITECTURE
## โครงสร้างโปรเจกต์แบบแยกระบบตามโดเมน (Domain-Separated Monorepo Layout)

ทุกชั้นของระบบ (`packages/contracts`, `apps/server`, `packages/ui`, `apps/desktop/src-tauri`) ถูกจัดระเบียบโดย **แยกระบบของใครของมันไว้คนละโฟลเดอร์** เพื่อให้สามารถเปิดแก้ไขเฉพาะระบบที่ต้องการได้ทันทีโดยไม่ต้องไล่อ่านไฟล์อื่นทั้งโปรเจกต์

---

## 1. แผนผังโฟลเดอร์โดยสมบูรณ์ (Monorepo Directory Layout)

```text
thepos/
├── apps/
│   ├── server/                              # เซิร์ฟเวอร์กลาง (Bun + Hono + Prisma + PostgreSQL)
│   │   ├── prisma/                          # schema.prisma, migrations, seed, roles
│   │   ├── test/                            # Unit & Integration tests
│   │   └── src/
│   │       ├── index.ts                     # Server entrypoint (HTTP/HTTPS, static web, brand logo)
│   │       ├── app.ts                       # Composition root (middleware + mount route ของแต่ละระบบ)
│   │       ├── core/                        # โครงสร้างพื้นฐานกลางของเซิร์ฟเวอร์ (ไม่ใช่ business domain)
│   │       │   ├── errors.ts                # ApiError
│   │       │   ├── security.ts              # JWT, Argon2id, Token, IP/LAN/Proxy guards
│   │       │   ├── server-security.ts       # Connect Key & Server Admin Console code
│   │       │   ├── tls.ts                   # Self-signed HTTPS cert & LAN IP detection
│   │       │   ├── http.ts                  # validate/body/uuid, rate limit, auth & cookie RouteContext
│   │       │   ├── audit.ts                 # audit(), StoreActor, translateDuplicate()
│   │       │   ├── pagination.ts            # pageMeta(), resolveOrder()
│   │       │   ├── finance-lock.ts          # PostgreSQL advisory lock สำหรับงานบัญชี/การเงิน
│   │       │   ├── date.ts                  # Decimal (40-digit), bangkokDay(), dayDate()
│   │       │   └── approval.ts              # managerApproval(), lockSaleRequest()
│   │       └── modules/                     # แยกระบบธุรกิจของใครของมัน (1 โฟลเดอร์ = 1 ระบบ)
│   │           ├── auth/                    # service.ts + routes.ts (Login/Lock/Unlock/Refresh/Password)
│   │           ├── setup/                   # service.ts + routes.ts (Health/Bootstrap/Device Enroll)
│   │           ├── server-admin/            # routes.ts (หน้าเว็บผู้ดูแลเซิร์ฟเวอร์ /server-admin)
│   │           ├── catalog/                 # service.ts + import.service.ts + routes.ts (สินค้า/หมวดหมู่/ผู้จัดจำหน่าย/นำเข้า)
│   │           ├── inventory/               # service.ts + routes.ts (รับสินค้าเข้า/ล็อต FEFO-FIFO/เคลื่อนไหวสต็อก)
│   │           ├── stock-counts/            # service.ts + routes.ts (ใบตรวจนับสต็อกและการอนุมัติ)
│   │           ├── mobile-stock-counts/     # service.ts + routes.ts (รอบนับสต๊อกผ่านมือถือในวง LAN)
│   │           ├── sales/                   # sales.service.ts + drafts.service.ts + returns.service.ts + routes.ts
│   │           ├── members/                 # service.ts + routes.ts (ทะเบียนสมาชิก/ยอดซื้อ/บัญชีหุ้น)
│   │           ├── dividends/               # calculation.ts + service.ts + payouts.service.ts + routes.ts
│   │           ├── shifts/                  # service.ts + routes.ts (กะเงินสด/ลิ้นชัก/กระทบยอด)
│   │           ├── reports/                 # service.ts + routes.ts (แดชบอร์ด/รายงาน 14 ประเภท)
│   │           └── settings/                # service.ts + routes.ts (ร้านค้า/พนักงาน/เครื่อง POS/Audit Log)
│   │
│   ├── desktop/                             # แอปเดสก์ท็อปหน้าร้าน POS (Tauri 2 + React shell)
│   │   ├── src/main.tsx                     # Desktop entrypoint (ลงทะเบียน Tauri transport)
│   │   └── src-tauri/src/
│   │       ├── main.rs                      # Tauri builder & command handlers
│   │       ├── api/                         # แยกส่วนเรียก API ของเครื่องเดสก์ท็อป
│   │       │   ├── mod.rs                   # HTTP client, session refresh, execute()
│   │       │   ├── routes.rs                # Command, BusinessRoute, BusinessQuery (จัดหมวดตามโดเมน)
│   │       │   ├── url.rs                   # การตรวจสอบ Server URL + unit tests
│   │       │   └── logo.rs                  # โหลดโลโก้ร้านค้า
│   │       ├── hardware/printing.rs         # พิมพ์ใบเสร็จ ESC/POS / GDI & เปิดลิ้นชัก
│   │       └── security/vault.rs            # Windows Credential Manager
│   │
│   └── web/                                 # เว็บพอร์ทัล (React shell ใช้ @thepos/ui ร่วมกับ desktop)
│       └── src/main.tsx
│
├── packages/
│   ├── contracts/                           # Zod Schemas & DTOs แยกตามระบบ (re-export ผ่าน src/index.ts)
│   │   └── src/
│   │       ├── index.ts                     # Barrel export ทุกระบบ
│   │       ├── shared/                      # primitives.ts, pagination.ts, permissions.ts, errors.ts
│   │       ├── auth/index.ts
│   │       ├── setup/index.ts
│   │       ├── catalog/index.ts
│   │       ├── inventory/index.ts
│   │       ├── stock-counts/index.ts
│   │       ├── mobile-stock-counts/index.ts
│   │       ├── sales/index.ts
│   │       ├── members/index.ts
│   │       ├── dividends/index.ts
│   │       ├── shifts/index.ts
│   │       ├── reports/index.ts
│   │       └── settings/index.ts
│   │
│   ├── ui/                                  # ส่วนติดต่อผู้ใช้กลาง (@thepos/ui) ใช้ร่วมกันระหว่าง Desktop & Web
│   │   └── src/
│   │       ├── app.tsx                      # Root router & session lifecycle
│   │       ├── styles.css                   # Entrypoint รวมไฟล์ CSS แยกหมวด
│   │       ├── styles/                      # base, auth, shell, dashboard, components, stock, modal, pos, alerts, responsive, data-table
│   │       ├── lib/
│   │       │   ├── native.ts                # Barrel export สำหรับ API client
│   │       │   ├── api/                     # errors.ts, routes.ts, web-transport.ts, client.ts
│   │       │   ├── printing/                # types.ts, raster.ts, printing.ts, printing.test.ts
│   │       │   ├── format.ts                # thaiDate, today, printerDate, decimal, readStored, retryKey
│   │       │   ├── alerts.ts                # SweetAlert2 wrappers
│   │       │   ├── idle-lock.ts             # ล็อกหน้าจออัตโนมัติ
│   │       │   └── utils.ts
│   │       ├── components/
│   │       │   ├── ui/                      # button.tsx, input.tsx, label.tsx, select.tsx
│   │       │   ├── data-table/              # table.tsx (Table, Pagination, LoadMore, toggleSort)
│   │       │   ├── common/                  # autocomplete, brand-logo, fields, loading, modal, pin, manager-approval, printer-dialog, receipt-view, web-access-modal
│   │       │   └── layout/                  # app-shell.tsx, navigation.ts, change-password-modal.tsx
│   │       └── features/                    # แยกระบบหน้าจอของใครของมัน (1 โฟลเดอร์ = 1 ระบบ)
│   │           ├── auth/                    # access-panel, access-screen, wizard (เชื่อมต่อ/ลงทะเบียน/เข้าสู่ระบบ/ล็อก)
│   │           ├── dashboard/               # home-page, store-dashboard
│   │           ├── pos/                     # workspace, checkout-dialog, member-dialog, history, history-page, model
│   │           ├── catalog/                 # workspace, catalog, suppliers, import-products, import-file, types
│   │           ├── inventory/               # workspace, receive, stock-lots, stock-movements, product-filter, types
│   │           ├── stock-counts/            # workspace, count-sheets
│   │           ├── mobile-count/            # sessions-workspace (ฝั่งเดสก์ท็อป), mobile-count-app (ฝั่งมือถือ), barcode-scanner, mobile-count.css
│   │           ├── members/                 # workspace, share-form
│   │           ├── dividends/               # workspace, forms, payouts
│   │           ├── shifts/                  # workspace
│   │           ├── reports/                 # workspace, options, export
│   │           └── settings/                # workspace, store-settings, hardware-settings, staff-settings, devices-settings, audit-logs
│   │
│   ├── shared/                              # ยูทิลิตีการคำนวณ Decimal ส่วนกลาง
│   └── config/                              # การตั้งค่า TypeScript / ESLint / Prettier กลาง
│
├── infra/                                   # Docker, Caddy, Backup scripts, Windows Inno Setup installer
├── scripts/                                 # pos-ctl.ts, start-server.ts
└── docs/                                    # architecture, database, deployment, requirements, roadmap, security, testing, user-guides
```

---

## 2. กฎการนำเข้าโมดูลข้ามระบบ (Module Boundary Rules)

1. **`@thepos/contracts`**:
   - แยกสคีมา Zod และ DTO ตามโฟลเดอร์ของแต่ละระบบ และ re-export รวมที่ `src/index.ts`
   - ห้ามมี Dependency ผูกกับฐานข้อมูลหรือ UI
2. **Backend (`apps/server/src`)**:
   - โค้ดส่วนกลาง (error, security, pagination, date, audit, lock, approval, HTTP context) อยู่ใน `core/`
   - แต่ละระบบอยู่ใน `modules/<system>/` พร้อม `routes.ts` และ `service.ts` ของตัวเอง `app.ts` ทำหน้าที่ mount route เท่านั้น
3. **Frontend (`packages/ui/src`)**:
   - คอมโพเนนต์และยูทิลิตีที่ใช้ร่วมกันหลายระบบอยู่ใน `components/` และ `lib/`
   - ห้าม feature หนึ่งนำเข้า utility ทั่วไปจากอีก feature หนึ่งโดยตรง
4. **Desktop Hardware (`apps/desktop/src-tauri/src`)**:
   - แยกชัดเจนเป็น `api/` (การสื่อสารกับเซิร์ฟเวอร์), `hardware/` (เครื่องพิมพ์/ลิ้นชัก), และ `security/` (Windows Credential Manager)
