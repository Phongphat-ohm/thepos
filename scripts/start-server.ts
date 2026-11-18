import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const envPath = resolve(root, ".env");

function parseEnvFile(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

function canConnectTcp(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = net.createConnection({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolvePromise(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function runStep(label: string, cmd: string[], cwd = root): Promise<void> {
  console.info(`▶ ${label}...`);
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`ขั้นตอน "${label}" ล้มเหลว (exit code ${code})`);
  }
}

async function main() {
  console.info("=== เตรียมความพร้อมระบบเซิร์ฟเวอร์ ThePOS ===");

  if (!existsSync(envPath)) {
    console.error("❌ ไม่พบไฟล์ .env ที่โฟลเดอร์หลัก กรุณาคัดลอก .env.example เป็น .env และตั้งค่า JWT_SECRET / DATABASE_URL ก่อน");
    process.exit(1);
  }

  const fileEnv = parseEnvFile(envPath);
  const dbUrlRaw = process.env.DATABASE_URL || fileEnv.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET || fileEnv.JWT_SECRET;

  if (!dbUrlRaw) {
    console.error("❌ ไม่พบค่า DATABASE_URL ใน .env");
    process.exit(1);
  }
  if (!jwtSecret || jwtSecret.length < 32) {
    console.error("❌ ค่า JWT_SECRET ใน .env ต้องมีความยาวอย่างน้อย 32 ตัวอักษร");
    process.exit(1);
  }

  let dbHost = "127.0.0.1";
  let dbPort = 5432;
  try {
    const parsed = new URL(dbUrlRaw);
    dbHost = parsed.hostname || "127.0.0.1";
    dbPort = parsed.port ? Number(parsed.port) : 5432;
  } catch {
    console.error("❌ รูปแบบ DATABASE_URL ใน .env ไม่ถูกต้อง");
    process.exit(1);
  }

  console.info(`▶ ตรวจสอบการเชื่อมต่อฐานข้อมูล (${dbHost}:${dbPort})...`);
  let dbReachable = await canConnectTcp(dbHost, dbPort);
  if (!dbReachable && (dbHost === "127.0.0.1" || dbHost === "localhost")) {
    console.info("⚠ ยังเชื่อมต่อฐานข้อมูลไม่ได้ กำลังพยายามเปิด PostgreSQL ผ่าน Docker Compose...");
    try {
      await runStep("เปิดฐานข้อมูล (docker compose up)", [
        "docker", "compose", "-f", "infra/docker/docker-compose.dev.yml", "up", "-d", "--wait",
      ]);
      dbReachable = await canConnectTcp(dbHost, dbPort, 3000);
    } catch {
      dbReachable = false;
    }
  }

  if (!dbReachable) {
    console.error(`❌ ไม่สามารถเชื่อมต่อฐานข้อมูลที่ ${dbHost}:${dbPort} ได้ กรุณาเปิด PostgreSQL หรือ Docker Desktop ก่อน`);
    process.exit(1);
  }
  console.info("✓ ฐานข้อมูลพร้อมเชื่อมต่อ");

  await runStep("สร้าง Prisma Client (db:generate)", ["bun", "run", "--cwd", "apps/server", "db:generate"]);
  await runStep("อัปเดตโครงสร้างฐานข้อมูล (db:migrate)", ["bun", "run", "--cwd", "apps/server", "db:migrate"]);
  await runStep("ตรวจสอบข้อมูลสิทธิ์เริ่มต้น (db:seed)", ["bun", "run", "--cwd", "apps/server", "db:seed"]);

  console.info("▶ กำลังเริ่มการทำงานของ ThePOS Server...");
  const serverProc = Bun.spawn(["bun", "--env-file=.env", "apps/server/src/index.ts"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  process.on("SIGINT", () => {
    serverProc.kill("SIGINT");
  });
  process.on("SIGTERM", () => {
    serverProc.kill("SIGTERM");
  });

  const exitCode = await serverProc.exited;
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
