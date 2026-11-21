#!/usr/bin/env bun
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const releaseMode = process.argv.includes("--release");
const releaseExe = resolve(import.meta.dir, "../apps/desktop/src-tauri/target/release/thepos-desktop.exe");

const c = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
};

function killTree(pid: number | undefined) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // Process may already be exited
  }
}

function prefixStream(stream: NodeJS.ReadableStream | null, label: string, color: string) {
  if (!stream) return;
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) {
        console.log(`${color}[${label}]${c.reset} ${line}`);
      }
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) {
      console.log(`${color}[${label}]${c.reset} ${buffer}`);
    }
  });
}

async function ensureDatabase() {
  console.log(`${c.cyan}[DB]${c.reset} ตรวจสอบและเริ่มต้นฐานข้อมูล PostgreSQL...`);
  try {
    execSync("docker compose -f infra/docker/docker-compose.dev.yml up -d --wait", { stdio: "inherit" });
  } catch {
    console.error(`${c.red}[DB] ไม่สามารถเริ่ม PostgreSQL ผ่าน Docker Compose ได้ กรุณาตรวจสอบ Docker Desktop${c.reset}`);
    process.exit(1);
  }
}

async function waitForServer(timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://127.0.0.1:3000/api/v1/health", { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      // Wait for server startup
    }
    await Bun.sleep(400);
  }
  return false;
}

async function main() {
  await ensureDatabase();

  const children: ChildProcess[] = [];
  let shuttingDown = false;

  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${c.yellow}กำลังหยุด Server และ Desktop...${c.reset}`);
    for (const child of children) {
      killTree(child.pid);
    }
    process.exit(code);
  };

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  const useRelease = releaseMode && existsSync(releaseExe);
  if (releaseMode && !useRelease) {
    console.log(`${c.yellow}ยังไม่พบไฟล์ build release กำลังรันโหมด dev แทน (รัน bun run build:desktop เพื่อสร้างไฟล์เร็ว)${c.reset}`);
  }
  console.log(`${c.green}เริ่มต้น Server และ Desktop (${useRelease ? "Fast Release" : "Dev"}) ใน Terminal เดียว (กด Ctrl+C เพื่อหยุดทั้งหมด)${c.reset}`);

  const serverArgs = useRelease
    ? ["--env-file=.env", "apps/server/src/index.ts"]
    : ["run", "--cwd", "apps/server", "dev"];
  const server = spawn("bun", serverArgs, {
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(server);
  prefixStream(server.stdout, "SERVER", c.cyan);
  prefixStream(server.stderr, "SERVER", c.cyan);

  server.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`${c.red}[SERVER] ปิดตัวลง (exit code: ${code ?? 0})${c.reset}`);
      shutdown(code ?? 1);
    }
  });

  await waitForServer();

  const desktop = useRelease
    ? spawn(releaseExe, [], { stdio: ["ignore", "pipe", "pipe"] })
    : spawn("bun", ["run", "--cwd", "apps/desktop", "tauri", "dev"], {
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
  children.push(desktop);
  prefixStream(desktop.stdout, "DESKTOP", c.magenta);
  prefixStream(desktop.stderr, "DESKTOP", c.magenta);

  desktop.on("exit", (code) => {
    if (!shuttingDown) {
      console.log(`${c.yellow}[DESKTOP] ปิดหน้าต่างแอปแล้ว กำลังหยุด Server...${c.reset}`);
      shutdown(code ?? 0);
    }
  });
}

main();
