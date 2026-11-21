# ThePOS Web Portal (Standalone)

โฟลเดอร์นี้แยกอิสระจากตัวโปรแกรม Desktop และ Backend Server สามารถยกโฟลเดอร์ `web-portal/` ไปติดตั้งหรือ deploy บนเซิร์ฟเวอร์/โดเมนของเว็บได้ทันที

## การรันและ Build ด้วยตัวเอง
```bash
bun install
bun run dev       # รันโหมดพัฒนาที่พอร์ต 4173
bun run build     # ตรวจสอบ TypeScript และ build ไฟล์ static ลง dist/
```

## การ Deploy ด้วย Docker
```bash
docker build -t thepos-web-portal .
docker run -d -p 80:80 --restart unless-stopped thepos-web-portal
```
