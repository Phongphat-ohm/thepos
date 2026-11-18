# ติดตั้ง ThePOS บน Linux และ Windows

## เซิร์ฟเวอร์

1. ติดตั้ง Docker Engine พร้อม Compose plugin บน Linux และตั้ง DNS ของร้านให้ชี้มายังเครื่องนี้ เปิด TCP 80 และ 443 สำหรับ Caddy
2. สร้างรหัสผ่าน PostgreSQL และค่า `JWT_SECRET`, `BOOTSTRAP_SECRET`, `MEMBER_ENCRYPTION_KEY` แยกกันด้วย `openssl rand -hex 32` เก็บไฟล์คอนฟิกด้วยสิทธิ์อ่านเฉพาะผู้ดูแล เก็บกุญแจสมาชิกไว้กับแผนกู้คืน เพราะใช้ถอดรหัสข้อมูลสมาชิกหลังย้ายฐานข้อมูล
3. สร้างคู่กุญแจ GPG ที่มีกุญแจสำหรับเข้ารหัสบนเครื่องผู้ดูแล ส่งออกเฉพาะกุญแจสาธารณะโดยใช้ `gpg --armor --export <fingerprint>` และสร้างไดเรกทอรีสำหรับเก็บสำเนา ตั้งเวลาตรวจผลสำรองและเก็บสำเนาไฟล์เข้ารหัสไว้นอกเครื่องเซิร์ฟเวอร์
4. สร้างไฟล์ `.env.production` ที่รากโครงการโดยกรอกค่าต่อไปนี้

| ตัวแปร | ค่า |
| --- | --- |
| `POS_SITE` | โดเมนร้าน เช่น `pos.example.com` |
| `POSTGRES_PASSWORD` | รหัสผ่านเจ้าของฐานข้อมูล PostgreSQL แบบ hex |
| `MIGRATION_DATABASE_URL` | บัญชีสำหรับรัน Migration เช่น `postgresql://thepos:รหัสผ่าน@postgres:5432/thepos` |
| `API_DATABASE_URL` | บัญชีสำหรับบริการ API (`NOSUPERUSER`) เช่น `postgresql://thepos_app:รหัสผ่าน@postgres:5432/thepos` |
| `BACKUP_DATABASE_URL` | บัญชีอ่านอย่างเดียวสำหรับงานสำรองข้อมูล (`pg_read_all_data`) |
| `JWT_SECRET` | ค่า hex สำหรับลงนามเซสชัน |
| `BOOTSTRAP_SECRET` | ค่า hex สำหรับตั้งค่าร้านครั้งแรก |
| `MEMBER_ENCRYPTION_KEY` | ค่า hex 64 ตัวอักษรสำหรับข้อมูลสมาชิก |
| `SERVER_CONSOLE_CODE` | *(ไม่บังคับ)* รหัสเข้าหน้าเว็บ `/server-admin` (หากไม่ตั้ง ระบบจะสุ่มและพิมพ์ใน Log ตอนเปิดเซิร์ฟเวอร์) |
| `SERVER_CONNECT_SECRET` | *(ไม่บังคับ)* รหัสเชื่อมต่อสำหรับ Desktop App (หากไม่ตั้ง ระบบจะสุ่มและแสดงในหน้า `/server-admin`) |
| `CORS_ORIGINS` | *(ไม่บังคับ)* Origin ของหน้าเว็บกลางที่อนุญาตในอนาคต เช่น `https://web.example.com` |
| `SERVE_WEB_DIST` | ค่าเริ่มต้น `false` (แยก Server เป็น API กลาง) |
| `BACKUP_RECIPIENT` | Fingerprint ของกุญแจ GPG |
| `BACKUP_PUBLIC_KEY_FILE` | พาธเต็มของไฟล์กุญแจสาธารณะ |
| `BACKUP_PATH` | พาธเต็มของไดเรกทอรีเก็บไฟล์เข้ารหัส |
| `BACKUP_INTERVAL_SECONDS` | คาบสำรองเป็นวินาที ค่าเริ่มต้น 86400 |

```sh
chmod 600 .env.production
docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml up -d --build --wait
curl --fail https://pos.example.com/api/v1/health
```

API ทำ migration และเพิ่มสิทธิ์ตามบทบาทตอนเริ่มทำงาน ผลตรวจสุขภาพควรเป็น `{"ready":true}` งานสำรองจะเริ่มหลัง API พร้อมและทำซ้ำตามคาบ ตรวจไฟล์ `*.dump.gpg` และผลล่าสุดด้วย `docker compose --env-file .env.production -f infra/docker/docker-compose.prod.yml logs backup`

## ฝึกกู้คืน

ติดตั้ง PostgreSQL client เวอร์ชัน 16 หรือใหม่กว่าและ GPG บนเครื่องกู้คืน นำเข้ากุญแจลับบนเครื่องนั้น สร้างฐานข้อมูลใหม่ที่ว่างอยู่ และกำหนด `RESTORE_DATABASE_URL` ให้ชี้ไปยังฐานข้อมูลใหม่

```sh
gpg --import /secure/restore-key.asc
sh infra/backup/restore.sh /secure/backups/thepos-example.dump.gpg
```

ตรวจจำนวนรายการและยอดสำคัญหลังคืนข้อมูลก่อนย้ายบริการไปใช้ฐานที่กู้คืน เก็บกุญแจลับแยกจากเซิร์ฟเวอร์สำรอง และใช้ `MEMBER_ENCRYPTION_KEY` เดิมกับฐานที่กู้คืน

## เครื่อง POS (Desktop App)

1. ใช้ Windows 10/11 ที่มี Microsoft Edge WebView2 Runtime และติดตั้งไดรเวอร์เครื่องพิมพ์ตามรุ่น
2. สร้างไฟล์ตัวติดตั้งจากเครื่องพัฒนาด้วยคำสั่ง `bun run build:installer` แล้วนำไฟล์ติดตั้ง (`*-setup.exe` ใน `apps/desktop/src-tauri/target/release/bundle/nsis/` หรือ `*.msi` ใน `bundle/msi/`) ไปติดตั้งบนเครื่อง POS
3. **ดูรหัสเชื่อมต่อเซิร์ฟเวอร์**:
   - ตรวจสอบ Terminal / Docker Logs ของเซิร์ฟเวอร์เพื่อนำ **รหัสเข้าสู่หน้าเว็บเซิร์ฟเวอร์** ไปล็อกอินที่ `https://pos.example.com/server-admin` (หรือ `http://<IP>:3000/server-admin` ในวง LAN)
   - คัดลอก **รหัสเชื่อมต่อเซิร์ฟเวอร์** จากหน้าเว็บ `/server-admin` (สามารถกดสร้างรหัสใหม่ / Rotate Key ได้ตลอดเวลา)
4. **เชื่อมต่อแอป Desktop**:
   - เปิดแอป **ระบบหน้าร้านสหกรณ์** แล้วกรอก **ที่อยู่เซิร์ฟเวอร์** (`https://...` หรือ `http://...`) พร้อม **รหัสเชื่อมต่อเซิร์ฟเวอร์** (ระบบจะตรวจสอบและเก็บโทเค็นลง Windows Credential Manager อย่างปลอดภัย)
   - เครื่องแรกใช้รหัสตั้งค่าระบบ (`BOOTSTRAP_SECRET`) เพื่อตั้งชื่อร้านและสร้างบัญชีผู้ดูแล เครื่องถัดไปใช้บัญชีผู้ดูแลอนุมัติการลงทะเบียนเครื่อง
   - ใช้เมนู **การดูแลระบบ → เครื่องพิมพ์และอุปกรณ์** เลือกคิวพิมพ์และขนาดกระดาษของแต่ละเครื่อง
