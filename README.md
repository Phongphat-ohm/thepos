# ThePOS: ระบบขายหน้าร้านและปันผลสมาชิกสหกรณ์

ระบบขายหน้าร้าน (POS), จัดการคลังสินค้า, สมาชิก, หุ้น, กะเงินสด และคำนวณเงินปันผล-เฉลี่ยคืนสำหรับสหกรณ์ร้านค้าชุมชน พัฒนาในรูปแบบ Monorepo ประกอบด้วย Desktop App (Tauri 2 + React 19 + Rust), API Server (Bun + Hono + Prisma ORM) และฐานข้อมูล PostgreSQL 16

---

## สารบัญ

1. [โครงสร้างโปรเจกต์](#โครงสร้างโปรเจกต์)
2. [ความต้องการของระบบ (Prerequisites)](#ความต้องการของระบบ-prerequisites)
3. [การติดตั้งและการตั้งค่า `.env`](#การติดตั้งและการตั้งค่า-env)
4. [การเตรียมฐานข้อมูลและรันในโหมดพัฒนา](#การเตรียมฐานข้อมูลและรันในโหมดพัฒนา)
5. [การใช้งานเครื่องมือควบคุม `thepos` CLI](#การใช้งานเครื่องมือควบคุม-thepos-cli)
6. [การตั้งค่าครั้งแรกและการใช้งาน Web Portal](#การตั้งค่าครั้งแรกและการใช้งาน-web-portal)
7. [ความสามารถหลักและปุ่มลัดหน้าจอขาย](#ความสามารถหลักและปุ่มลัดหน้าจอขาย)
8. [การรันชุดทดสอบและตรวจสอบโค้ด](#การรันชุดทดสอบและตรวจสอบโค้ด)
9. [การ Build แอปและตัวติดตั้ง Windows](#การ-build-แอปและตัวติดตั้ง-windows)
10. [การ Deploy Production ด้วย Docker และการสำรองข้อมูล](#การ-deploy-production-ด้วย-docker-และการสำรองข้อมูล)
11. [การแก้ปัญหาที่พบบ่อย](#การแก้ปัญหาที่พบบ่อย)

---

## โครงสร้างโปรเจกต์

```text
thepos/
├── apps/
│   ├── desktop/                  # Desktop POS App (Tauri 2 + Rust + เชื่อม @thepos/ui)
│   │   └── src-tauri/            # Rust backend (API proxy, Credential Vault, ESC/POS thermal printing)
│   ├── web/                      # บริการหน้าเว็บกลาง (Standalone SPA ใช้ @thepos/ui)
│   └── server/                   # Backend API (Bun + Hono + Zod + Prisma 6 + Auto HTTPS)
│       ├── prisma/               # schema.prisma, migrations, seed.ts, roles.ts
│       ├── src/                  # index.ts, app.ts, tls.ts, server-admin.ts, server-security.ts, modules/
│       └── test/                 # Unit tests และ PostgreSQL integration tests
├── packages/
│   ├── ui/                       # React 19 UI ส่วนกลางใช้ร่วมกันระหว่าง desktop และ web
│   ├── contracts/                # Zod schemas และ TypeScript types ใช้ร่วมกันระหว่าง client/server
│   ├── shared/                   # ค่าคงที่และ Decimal utilities กลาง
│   └── config/                   # Shared TypeScript config
├── infra/
│   ├── docker/                   # Dockerfile, Caddyfile, docker-compose.dev.yml, docker-compose.prod.yml
│   ├── backup/                   # คอนเทนเนอร์และสคริปต์สำรอง/กู้คืนฐานข้อมูลเข้ารหัส GPG
│   └── installer/                # สคริปต์ Inno Setup สำหรับ Windows (thepos-desktop.iss)
├── scripts/                      # pos-ctl.ts (CLI จัดการระบบ) และ start-server.ts
└── docs/                         # เอกสารสถาปัตยกรรม, ERD, SRS และคู่มือภาษาไทย
```

---

## ความต้องการของระบบ (Prerequisites)

### สำหรับรัน Backend Server และฐานข้อมูลพัฒนา
- **Bun** `1.3+` (ทดสอบและรันด้วย `1.3.11`)
- **Node.js** `22+` (ใช้ร่วมกับ Vite และ Vitest)
- **Docker Desktop** (สำหรับเปิด PostgreSQL 16 ผ่าน `infra/docker/docker-compose.dev.yml`) หรือใช้ PostgreSQL 16 ที่ติดตั้งเองในเครื่อง

### สำหรับพัฒนาและ Build Desktop App (Tauri 2 บน Windows)
- **Rust Toolchain** (`rustc` และ `cargo`)
- **Microsoft C++ Build Tools** (Desktop development with C++ สำหรับคอมไพล์ Rust และ WebView2)
- **WebView2 Runtime** (ติดตั้งมาแล้วใน Windows 10/11 รุ่นปัจจุบัน)
- **Inno Setup 6** (เฉพาะกรณีต้องการสร้างตัวติดตั้งด้วยคำสั่ง `bun run build:inno`)

---

## การติดตั้งและการตั้งค่า `.env`

### 1. ติดตั้ง Dependencies ทั้ง Monorepo

```powershell
bun install --frozen-lockfile
```

### 2. สร้างไฟล์ `.env` จากไฟล์ตัวอย่าง

```powershell
Copy-Item .env.example .env
```

### 3. สร้างค่าความลับที่จำเป็น

รันคำสั่งด้านล่างเพื่อสุ่มค่าคีย์ 3 ตัว แล้วนำไปใส่ใน `.env` (`JWT_SECRET` และ `BOOTSTRAP_SECRET` ต้องเป็นคนละค่ากัน และยาวอย่างน้อย 32 ตัวอักษร):

```powershell
# สุ่ม JWT_SECRET และ BOOTSTRAP_SECRET (รันแยก 2 ครั้งเพื่อไม่ให้ค่าซ้ำกัน)
bun -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"

# สุ่ม MEMBER_ENCRYPTION_KEY (เลขฐานสิบหก 64 ตัวสำหรับเข้ารหัสเลขบัตรประชาชนสมาชิก)
bun -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

### 4. สรุปตัวแปรสภาพแวดล้อมสำคัญ

| ตัวแปร | ค่าเริ่มต้น / รูปแบบ | คำอธิบาย |
|---|---|---|
| `DATABASE_URL` | `postgresql://thepos:thepos_dev@127.0.0.1:54329/thepos` | URL เชื่อมต่อ PostgreSQL 16 |
| `API_HOST` / `API_PORT` | `127.0.0.1` / `3000` | โฮสต์และพอร์ตที่ Backend Server เปิดรับการเชื่อมต่อ |
| `JWT_SECRET` | บังคับ (>= 32 ตัวอักษร) | คีย์สำหรับเซ็น JWT และอนุพันธ์คีย์ความปลอดภัยของเซิร์ฟเวอร์ |
| `BOOTSTRAP_SECRET` | ทางเลือก (>= 32 ตัวอักษร) | รหัสลับใช้ตั้งค่าร้านค้าครั้งแรก |
| `MEMBER_ENCRYPTION_KEY` | 64 hex chars | คีย์สำหรับเข้ารหัสเลขบัตรประชาชนสมาชิก (AES-256-GCM) |
| `CASH_VARIANCE_LIMIT` | `0.00` | ส่วนต่างปิดกะสูงสุด (บาท) ที่ปิดได้โดยไม่ต้องขอ PIN ผู้จัดการ |
| `SERVER_CONSOLE_CODE` | ว่าง (สุ่มอัตโนมัติ) | รหัสเข้าหน้าเว็บ `/server-admin` (6-64 ตัวอักษร) |
| `SERVER_CONNECT_SECRET` | ว่าง (สุ่มและเก็บใน DB) | รหัสเชื่อมต่อเซิร์ฟเวอร์เริ่มต้นสำหรับเครื่องลูก |
| `SERVE_WEB_DIST` | `false` | ตั้งเป็น `true` หากต้องการให้ API Server เสิร์ฟหน้าเว็บจาก `apps/desktop/dist` ด้วย |
| `CORS_ORIGINS` | ว่าง | รายชื่อ Origin ที่อนุญาตสำหรับ Web Portal คั่นด้วย `,` |
| `TRUSTED_PROXY_IPS` | ว่าง (`127.0.0.1,::1`) | IP หรือ IPv4 CIDR ของ Reverse Proxy ที่เชื่อถือสำหรับอ่าน `X-Forwarded-For` |
| `TEST_DATABASE_URL` | ว่าง | URL ฐานข้อมูลที่มีสิทธิ์ `CREATEDB` สำหรับรัน `test:integration` |

---

## การเตรียมฐานข้อมูลและรันในโหมดพัฒนา

### ขั้นตอนเตรียมฐานข้อมูลครั้งแรก

```powershell
# 1. เปิด PostgreSQL 16 บนพอร์ต 54329 (ผ่าน Docker)
bun run db:up

# 2. สร้าง Prisma Client (ทำซ้ำทุกครั้งที่แก้ schema.prisma)
bun run db:generate

# 3. รัน Migration ทั้งหมด
bun run db:migrate

# 4. เพิ่มข้อมูลสิทธิ์เริ่มต้นของระบบ (ADMIN, MANAGER, CASHIER, STOCK_STAFF)
bun run db:seed
```

### วิธีรันโปรแกรม

สามารถเลือกวิธีรันได้ 3 แบบตามลักษณะงาน:

#### แบบที่ 1: รัน Server แบบคำสั่งเดียว (`scripts/start-server.ts`)
สคริปต์จะตรวจสอบ `.env`, เปิด Docker PostgreSQL อัตโนมัติ (ถ้าเชื่อมต่อ `127.0.0.1` ไม่ได้), รัน `db:generate`, `db:migrate`, `db:seed` และเปิด Server ทันที:

```powershell
bun run start
# หรือ
bun run start:server
```

#### แบบที่ 2: รันแยก Server และ Desktop App สำหรับพัฒนา (Hot Reload)
เปิด PowerShell 2 หน้าต่าง:

```powershell
# หน้าต่างที่ 1: รัน Backend API Server ที่พอร์ต 3000 (Watch mode)
bun run dev:server

# หน้าต่างที่ 2: รัน Tauri Desktop App (Vite dev server พอร์ต 1420 + หน้าต่างแอป)
bun run dev:desktop
```

#### แบบที่ 3: รัน Frontend อย่างเดียวบนเว็บเบราว์เซอร์
เหมาะสำหรับการทดสอบ UI อย่างรวดเร็ว (ต้องเปิด Backend Server ไว้ด้วย และตั้งค่า `SERVE_WEB_DIST` หรือใช้ URL ของ Server):

```powershell
bun run --cwd apps/desktop dev
```

---

## การใช้งานเครื่องมือควบคุม `thepos` CLI

โปรเจกต์มีสคริปต์ควบคุมแบบครบวงจรที่ `scripts/pos-ctl.ts` สามารถเรียกผ่าน `.\thepos` (Windows) หรือ `bun run pos`:

```powershell
.\thepos                       # เปิดเมนูโต้ตอบ (Interactive Menu)
.\thepos check                 # ตรวจความพร้อมของ Bun, Rust, Node, Docker, .env และ Migration
.\thepos status                # แสดงสถานะ Database, Server และ Desktop App พร้อมดูพอร์ตที่ใช้งาน
.\thepos start all             # เปิด Database + Server + Web Portal + Desktop App พร้อมกัน
.\thepos start web             # เปิดเฉพาะบริการหน้าเว็บกลาง (apps/web พอร์ต 4173)
.\thepos start server          # เปิดเฉพาะ Server (เลือก start db | server | web | desktop ได้)
.\thepos stop all              # หยุด Desktop, Web Portal, Server และ Database
.\thepos restart server        # รีสตาร์ทบริการที่ต้องการ (all | db | server | web | desktop)
.\thepos logs server           # ดู Log แบบเรียลไทม์ (all | server | web | desktop | db)
.\thepos test all              # รันชุดทดสอบ (all | unit | integration | typecheck | rust)
.\thepos reset                 # ล้างข้อมูลทั้งหมดเพื่อเริ่มระบบใหม่ (ถามยืนยัน "RESET", ใส่ -y เพื่อข้ามการถาม)
```

> **หมายเหตุคำสั่ง `reset`**: จะหยุดบริการ, ลบไฟล์ตั้งค่าเครื่อง POS, ล้าง Credential Vault ของ Windows (`thepos-desktop`), ลบไฟล์ Log และสร้างฐานข้อมูล Docker ใหม่ทั้งหมด เหมาะสำหรับสภาพแวดล้อมทดสอบเท่านั้น

---

## การตั้งค่าครั้งแรกและการใช้งาน Web Portal

### 1. ตั้งค่าเซิร์ฟเวอร์และร้านค้าครั้งแรก
1. เมื่อรัน Backend Server (`bun run dev:server` หรือ `bun run start`), ดูข้อความใน Terminal เพื่อนำ **รหัสเข้าสู่หน้าเว็บเซิร์ฟเวอร์** ไปล็อกอินที่ `http://127.0.0.1:3000/server-admin`
2. ในหน้า `/server-admin` ให้คัดลอก **รหัสเชื่อมต่อเซิร์ฟเวอร์** (สามารถกดหมุนเปลี่ยนรหัสใหม่ได้ และค่าเวอร์ชัน/คีย์จะถูกบันทึกไว้ในฐานข้อมูล `server_security_state`)
3. เปิด Desktop App แล้วกรอก **ที่อยู่เซิร์ฟเวอร์** (`http://127.0.0.1:3000` หรือ IP เครื่องแม่ข่ายในวง LAN) พร้อม **รหัสเชื่อมต่อเซิร์ฟเวอร์**
   - แอป Desktop ยอมรับ `https://` สำหรับโดเมนสาธารณะ และยอมรับ `http://` เฉพาะ Loopback (`localhost`, `127.0.0.1`, `::1`) หรือ IP วง LAN ส่วนตัว (RFC 1918) เท่านั้น
4. หากร้านยังไม่เคยตั้งค่า ให้กรอก `BOOTSTRAP_SECRET` จาก `.env`, ชื่อร้าน, และสร้างบัญชี `ADMIN` คนแรกพร้อม PIN 6 หลัก

หน้า `/server-admin` แสดงสถานะฐานข้อมูล ร้านค้า เวลาทำงาน รายละเอียดเซิร์ฟเวอร์ และเครื่อง POS ที่ลงทะเบียน ปุ่ม **ล้างข้อมูลทั้งหมด** อยู่เฉพาะหน้านี้ ต้องเข้าสู่ระบบผู้ดูแลเซิร์ฟเวอร์ กรอกรหัสจาก Terminal ซ้ำ และพิมพ์ `ล้างข้อมูลทั้งหมด` ก่อนยืนยัน การล้างจะลบข้อมูลร้าน ผู้ใช้ เครื่อง POS สินค้า สต็อก สมาชิก หุ้น ธุรกรรม การเงิน และประวัติทั้งหมดอย่างถาวร ควรสำรองฐานข้อมูลก่อนใช้

ระบบคงโครงสร้างฐานข้อมูล ประวัติ migration บทบาทและสิทธิ์มาตรฐาน รวมถึงรหัสเชื่อมต่อเซิร์ฟเวอร์ไว้ ต้องกำหนด `BOOTSTRAP_SECRET` ก่อนจึงจะล้างได้ เพื่อให้ตั้งค่าร้านใหม่ผ่าน Desktop App ได้หลังล้าง เครื่อง POS ทุกเครื่องต้องลงทะเบียนใหม่ หากฐานข้อมูลล้างไม่สำเร็จ การเปลี่ยนแปลงทั้งชุดจะถูกย้อนกลับ

### 2. การเปิดใช้งานโหมดเว็บ (Web Portal)
หากต้องการให้ผู้จัดการหรือแอดมินเปิดระบบผ่านเว็บเบราว์เซอร์ (เช่น จากแท็บเล็ตหรือมือถือผ่าน QR Code หรือ URL):
1. Build ไฟล์หน้าเว็บก่อน:
   ```powershell
   bun run --cwd apps/desktop build
   ```
2. ตั้งค่า `SERVE_WEB_DIST=true` ใน `.env` (และตั้ง `API_HOST=0.0.0.0` หากเปิดรับจากเครื่องอื่นในวง LAN) แล้วรีสตาร์ท Server
3. การเข้าใช้งานผ่านเว็บนอกเครื่องตัวเอง (`localhost` / `127.0.0.1` / `[::1]`) ต้องเชื่อมต่อผ่าน **HTTPS** (เช่น วางหลัง Caddy Reverse Proxy) เพื่อให้เว็บทำงานกับ Cookie และ Session ได้ปลอดภัย
4. เครื่องที่ล็อกอินจากเว็บจะถูกบันทึกเป็นอุปกรณ์เว็บ (`isWebDevice = true`) แยกตามเบราว์เซอร์ และ **สงวนสิทธิ์เฉพาะงานหลังบ้าน** (รายงาน, สต็อก, สมาชิก, ปันผล, ตั้งค่า, ปิดกะแทนสำหรับผู้จัดการ) โดยไม่อนุญาตให้ทำรายการขายหน้าร้าน (`sales:checkout`) หรือเปิด/คุมลิ้นชักกะหน้าร้าน (`shift:operate`) เพื่อความปลอดภัยของเงินสด

---

## ความสามารถหลักและปุ่มลัดหน้าจอขาย

### โมดูลหลักในระบบ
- **POS และคืนสินค้า**: เปิดหลายบิลพร้อมกัน, สแกนบาร์โค้ด, คิดราคาสมาชิกอัตโนมัติ, แยกหลายวิธีชำระเงิน, พักบิลบนเซิร์ฟเวอร์, ออกใบเสร็จความร้อน ESC/POS (ผ่าน Rust) หรือ PDF, และทำคืนสินค้าพร้อมตรวจสอบ quote ก่อนบันทึกจริง
- **กะเงินสดและลิ้นชัก**: รายการเงินสดหน้าร้านผูกกับกะเงินสดที่เปิดอยู่เสมอ, รองรับนำเงินเข้า-ออก (`CASH_IN`, `CASH_DROP`, `PETTY_CASH`), ขอ PIN ผู้จัดการเมื่อผลต่างเกิน `CASH_VARIANCE_LIMIT`, และผู้ที่มีสิทธิ์ `shift:review` สามารถปิดกะที่แคชเชียร์เปิดค้างไว้แทนได้พร้อมบันทึกผู้อนุมัติใน Audit Log
- **สินค้าและคลัง**: จัดการหลายหน่วยนับและบาร์โค้ด, นำเข้าจำนวนมากจาก `.xlsx` / `.csv`, รับสต็อกแยกล็อตพร้อมวันหมดอายุ, ตัดสต็อกแบบ FEFO/FIFO ด้วย lock ระดับแถว และระบบตรวจนับสต็อกแบบแยกคนนับกับคนอนุมัติ
- **สมาชิก หุ้น และปันผล**: เข้ารหัสเลขบัตรประชาชนสมาชิก, สมุดบัญชียอดซื้อสุทธิ, บัญชีหุ้น (ซื้อ/ถอน/โอน/ปรับปรุง), กำหนดสูตรปันผล-เฉลี่ยคืน, จำลองผล, ล็อกงวด, จ่ายเงินเป็นงวด (รองรับจ่ายบางส่วน) และปิดงวดบัญชี
- **รายงานและ Audit Log**: รายงาน 14 ประเภทพร้อมแบ่งหน้า/เรียงลำดับจากเซิร์ฟเวอร์ ส่งออก Excel (`.xlsx`) และ PDF ภาษาไทยได้

### ปุ่มลัดแป้นพิมพ์หน้าจอขาย (POS)

| ปุ่มลัด | หน้าที่การทำงาน |
|---|---|
| `F2` | โฟกัสช่องค้นหาสินค้า / ยิงบาร์โค้ด |
| `F3` | เลือกสมาชิกสหกรณ์ |
| `F4` | แก้ไขจำนวนสินค้าในรายการที่เลือก |
| `F6` | สลับบิลขายที่เปิดอยู่ |
| `F7` | ใส่ส่วนลดรายการหรือท้ายบิล |
| `F8` | พักบิลปัจจุบันไว้บนเซิร์ฟเวอร์ |
| `F9` | เปิดหน้าต่างรับชำระเงิน |
| `F10` | เปิดประวัติการขายและทำรายการคืนสินค้า |
| `Ctrl+N` | เปิดแท็บบิลขายใหม่ |
| `Esc` | ปิดหน้าต่างป๊อปอัปหรือยกเลิก |

---

## การรันชุดทดสอบและตรวจสอบโค้ด

```powershell
# 1. ตรวจสอบ TypeScript ทั้ง 4 แพ็กเกจ
bun run typecheck

# 2. รัน Unit Tests (Vitest)
bun run test

# 3. รัน Integration Tests บน PostgreSQL 16
# ต้องเปิดฐานข้อมูลไว้ก่อน และผู้ใช้ใน URL ต้องมีสิทธิ์ CREATEDB
$env:TEST_DATABASE_URL = "postgresql://thepos:thepos_dev@127.0.0.1:54329/thepos"
bun run test:integration -- --no-file-parallelism

# 4. รัน Rust Unit Tests ในฝั่ง Tauri
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

> การส่ง flag `--no-file-parallelism` ให้ Integration Tests ช่วยลดภาระการสร้าง/ลบฐานข้อมูลทดสอบชั่วคราวพร้อมกันหลายไฟล์บนเครื่องที่มี Docker PostgreSQL

---

## การ Build แอปและตัวติดตั้ง Windows

### 1. Build เฉพาะ Frontend (Static Assets สำหรับ Web Portal หรือตรวจสอบ Bundle)

```powershell
bun run --cwd apps/desktop build
```
ผลลัพธ์จะถูกสร้างที่ `apps/desktop/dist/`

### 2. Build ไฟล์โปรแกรม Desktop แบบไฟล์เดียว (`thepos-desktop.exe`)

```powershell
bun run build:desktop
```
ไฟล์ผลลัพธ์อยู่ที่ `apps/desktop/src-tauri/target/release/thepos-desktop.exe`

### 3. Build ตัวติดตั้งมาตรฐานผ่าน Tauri (NSIS และ MSI)

```powershell
bun run build:installer
```
ไฟล์ผลลัพธ์อยู่ที่:
- **NSIS Setup**: `apps/desktop/src-tauri/target/release/bundle/nsis/*-setup.exe`
- **MSI Installer**: `apps/desktop/src-tauri/target/release/bundle/msi/*.msi`

### 4. Build ตัวติดตั้งด้วย Inno Setup 6 (ทางเลือกเพิ่มเติม)

```powershell
bun run build:inno
```
คำสั่งนี้จะรัน `build:desktop` ก่อน แล้วเรียก `"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"` คอมไพล์ไฟล์ `infra/installer/thepos-desktop.iss` ได้ไฟล์ติดตั้งที่:
- `apps/desktop/src-tauri/target/release/bundle/inno/ThePOS-Setup-0.1.0.exe`

---

## การ Deploy Production ด้วย Docker และการสำรองข้อมูล

ชุด Production Compose อยู่ที่ [infra/docker/docker-compose.prod.yml](infra/docker/docker-compose.prod.yml) ประกอบด้วย 5 services:
- **`postgres`**: PostgreSQL 16 บนเครือข่ายภายใน (`data`)
- **`migrate`**: One-shot service (`restart: "no"`) สำหรับรัน `prisma migrate deploy` และ `prisma/seed.ts` โดยใช้ `MIGRATION_DATABASE_URL` แยกออกจากสิทธิ์ของตัวแอปจริง
- **`api`**: รันแอปเซิร์ฟเวอร์โดยใช้ `API_DATABASE_URL` (ไม่มี `MIGRATION_DATABASE_URL` ใน runtime container) และตั้งค่า `TRUSTED_PROXY_IPS` เริ่มต้นเฉพาะเครือข่ายภายใน (`172.16.0.0/12,10.0.0.0/8,192.168.0.0/16,127.0.0.1,::1`)
- **`caddy`**: Reverse Proxy และ HTTPS อัตโนมัติตาม [infra/docker/Caddyfile](infra/docker/Caddyfile) โดยบล็อกเส้นทาง `/server-admin*` จากอินเทอร์เน็ตสาธารณะ (ตอบกลับ `403` เว้นแต่มาจาก `private_ranges`, `127.0.0.1` หรือ `::1`)
- **`backup`**: รันในฐานะ non-root (`USER postgres`) สตรีม `pg_dump` เข้า `gpg` โดยตรงแบบไม่เขียนไฟล์ dump เปล่าลงดิสก์ และเก็บประวัติตาม `BACKUP_RETENTION_DAYS` (ค่าเริ่มต้น `30` วัน)

### ตัวอย่างการรัน Production Stack

1. เตรียมตัวแปรสภาพแวดล้อมให้ครบ: `POSTGRES_PASSWORD`, `API_DATABASE_URL`, `MIGRATION_DATABASE_URL`, `BACKUP_DATABASE_URL`, `JWT_SECRET`, `BOOTSTRAP_SECRET`, `MEMBER_ENCRYPTION_KEY`, `POS_SITE`, `BACKUP_RECIPIENT`, `BACKUP_PUBLIC_KEY_FILE`, `BACKUP_PATH`
2. สั่ง Build และรัน:
   ```bash
   docker compose -f infra/docker/docker-compose.prod.yml up -d --build
   ```

### การสำรองและกู้คืนข้อมูล (`infra/backup/`)

- **รันสำรองข้อมูลทันที**:
  ```bash
  docker compose -f infra/docker/docker-compose.prod.yml exec backup backup.sh
  ```
- **กู้คืนข้อมูลไปยังฐานข้อมูลว่างใหม่**:
  เตรียมฐานข้อมูลปลายทางที่ยังไม่มีตารางผู้ใช้ ตั้งค่า `RESTORE_DATABASE_URL` และนำเข้า private key GPG จากนั้นรัน:
  ```sh
  RESTORE_DATABASE_URL="postgresql://user:pass@host:5432/new_empty_db" \
    /usr/local/bin/restore.sh /backups/thepos-YYYYMMDDTHHMMSSZ-xxxxxxxx.dump.gpg
  ```

---

## การแก้ปัญหาที่พบบ่อย

- **รัน `bun run db:generate` แล้วขึ้น `EPERM: operation not permitted` บนไฟล์ `.node`**
  มักเกิดจากโปรเซส Backend Server หรือ CLI ที่ยังเปิดค้างอยู่ล็อกไฟล์ Prisma Query Engine DLL ให้ปิดเซิร์ฟเวอร์ก่อน (เช่น `.\thepos stop server` หรือปิด Terminal ที่รัน `dev:server`) แล้วค่อยรัน `bun run db:generate` ใหม่
- **`test:integration` เชื่อมต่อฐานข้อมูลไม่ได้**
  ตรวจสอบว่า Container `thepos-dev-postgres-1` กำลังทำงานอยู่ (`bun run db:up`) และตั้งค่า `TEST_DATABASE_URL="postgresql://thepos:thepos_dev@127.0.0.1:54329/thepos"` ใน shell เดียวกันก่อนรัน
- **เข้า Web Portal จากเครื่องอื่นใน LAN ไม่ได้**
  ให้รันหลัง HTTPS (เช่น Caddy) เพราะเบราว์เซอร์จำกัดการตั้งค่า Cookie และบริบทปลอดภัยนอก `localhost` / `127.0.0.1`
- **เข้า `/server-admin` ผ่านโดเมนสาธารณะไม่ได้**
  [Caddyfile](infra/docker/Caddyfile) ออกแบบให้ `/server-admin*` เข้าได้เฉพาะ localhost, LAN ภายใน หรือผ่าน SSH Tunnel เท่านั้น หากต้องการจัดการเซิร์ฟเวอร์จากระยะไกลให้เชื่อมต่อผ่าน SSH port forwarding แทนการเปิดออกสาธารณะ

---

## เอกสารเพิ่มเติม

- คู่มือติดตั้งฉบับละเอียด: [docs/user-guides/INSTALLATION_TH.md](docs/user-guides/INSTALLATION_TH.md)
- คู่มือผู้ใช้งาน: [docs/user-guides/USER_MANUAL_TH.md](docs/user-guides/USER_MANUAL_TH.md)
- สถาปัตยกรรมระบบ: [docs/architecture/SYSTEM_ARCHITECTURE.md](docs/architecture/SYSTEM_ARCHITECTURE.md)
- โครงสร้างฐานข้อมูลและข้อกำหนดทางการเงิน: [docs/database/ERD.md](docs/database/ERD.md), [docs/database/FINANCIAL_INVARIANTS.md](docs/database/FINANCIAL_INVARIANTS.md)
