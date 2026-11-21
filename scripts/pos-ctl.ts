#!/usr/bin/env bun
import { execFileSync, execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, unlinkSync, writeFileSync, closeSync } from "node:fs";
import * as net from "node:net";
import * as readline from "node:readline";
import { detectLanIps } from "../apps/server/src/core/tls";

// ==========================================
// 🎨 Terminal Styling & Utilities
// ==========================================
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

const LOGS_DIR = "logs";
const SERVER_PID_FILE = `${LOGS_DIR}/server.pid`;
const DESKTOP_PID_FILE = `${LOGS_DIR}/desktop.pid`;
const WEB_PID_FILE = `${LOGS_DIR}/web.pid`;
const SERVER_LOG_FILE = `${LOGS_DIR}/server.log`;
const DESKTOP_LOG_FILE = `${LOGS_DIR}/desktop.log`;
const WEB_LOG_FILE = `${LOGS_DIR}/web.log`;

if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });

function log(msg = "") { console.log(msg); }
function success(msg: string) { console.log(`  ${c.green}✔ ${msg}${c.reset}`); }
function error(msg: string) { console.log(`  ${c.red}✖ ${msg}${c.reset}`); }
function warn(msg: string) { console.log(`  ${c.yellow}⚠ ${msg}${c.reset}`); }
function info(msg: string) { console.log(`  ${c.cyan}ℹ ${msg}${c.reset}`); }

// ==========================================
// 🔍 System Inspection & Process Helpers
// ==========================================
function isPidRunning(pid: number): boolean {
  if (!pid || isNaN(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getPidOnPort(port: number): number | null {
  try {
    const cmd = `netstat -ano | findstr :${port} | findstr LISTENING`;
    const output = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const lines = output.trim().split("\n");
    const portPattern = new RegExp(`:${port}$`);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5 || !portPattern.test(parts[1])) continue;
      const pid = parseInt(parts[parts.length - 1], 10);
      if (pid && !isNaN(pid)) return pid;
    }
  } catch {}
  return null;
}

function readStoredPid(file: string): number | null {
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf8").trim();
    const pid = parseInt(raw, 10);
    if (isPidRunning(pid)) return pid;
    try { unlinkSync(file); } catch {}
    return null;
  } catch {
    return null;
  }
}

function killProcessTree(pid: number) {
  if (!pid) return;
  try {
    execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
  } catch {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
}

async function isPortOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host, timeout: 800 });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function checkApiHealth(): Promise<{ ready: boolean; status: number | null }> {
  try {
    const res = await fetch("http://127.0.0.1:3000/api/v1/health", { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const data = await res.json() as { ready?: boolean };
      return { ready: !!data.ready, status: res.status };
    }
    return { ready: false, status: res.status };
  } catch {
    return { ready: false, status: null };
  }
}

function getBootstrapSecret(): string | null {
  if (!existsSync(".env")) return null;
  const content = readFileSync(".env", "utf8");
  const match = content.match(/^BOOTSTRAP_SECRET=(.+)$/m);
  return match?.[1]?.trim() || null;
}

async function printSetupHintIfNeeded() {
  try {
    const res = await fetch("http://127.0.0.1:3000/api/v1/setup/status", { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return;
    const data = await res.json() as { initialized?: boolean };
    if (data.initialized === false) {
      const secret = getBootstrapSecret();
      log(`\n  ${c.yellow}${c.bold}🔑 ระบบยังไม่ได้ตั้งค่าร้านค้าครั้งแรก (Setup Wizard)${c.reset}`);
      log(`     ${c.cyan}ที่อยู่เซิร์ฟเวอร์:${c.reset}  http://127.0.0.1:3000`);
      if (secret) {
        log(`     ${c.cyan}รหัสตั้งค่าระบบ:${c.reset}    ${c.green}ตั้งค่าไว้ในไฟล์ .env แล้ว (ตัวแปร BOOTSTRAP_SECRET)${c.reset}`);
      } else {
        log(`     ${c.red}ไม่พบ BOOTSTRAP_SECRET ในไฟล์ .env${c.reset}`);
      }
      log("");
    }
  } catch {}
}

function getDockerPostgresStatus(): "RUNNING" | "STOPPED" | "NOT_FOUND" {
  try {
    const output = execSync('docker ps --filter "name=thepos-dev-postgres-1" --format "{{.Status}}"', { encoding: "utf8" }).trim();
    if (output) return "RUNNING";
    const all = execSync('docker ps -a --filter "name=thepos-dev-postgres-1" --format "{{.Status}}"', { encoding: "utf8" }).trim();
    return all ? "STOPPED" : "NOT_FOUND";
  } catch {
    return "NOT_FOUND";
  }
}

// ==========================================
// 🚀 Service Actions (Start / Stop / Restart)
// ==========================================
async function startDb(): Promise<boolean> {
  info("กำลังเริ่มต้นฐานข้อมูล PostgreSQL (Docker)...");
  try {
    execSync("docker compose -f infra/docker/docker-compose.dev.yml up -d --wait", { stdio: "inherit" });
    success("ฐานข้อมูล PostgreSQL พร้อมใช้งาน (Port 54329)");
    return true;
  } catch {
    error("ไม่สามารถเริ่มฐานข้อมูลได้: กรุณาตรวจสอบว่า Docker Desktop เปิดอยู่หรือไม่");
    return false;
  }
}

function stopDb(): boolean {
  info("กำลังหยุดฐานข้อมูล PostgreSQL...");
  try {
    execSync("docker compose -f infra/docker/docker-compose.dev.yml stop", { stdio: "inherit" });
    success("หยุดฐานข้อมูลเรียบร้อยแล้ว");
    return true;
  } catch {
    error("เกิดข้อผิดพลาดในการหยุดฐานข้อมูล");
    return false;
  }
}

async function startServer(): Promise<boolean> {
  const existingPid = getPidOnPort(3000) ?? readStoredPid(SERVER_PID_FILE);
  if (existingPid && await isPortOpen(3000)) {
    warn(`API Server กำลังทำงานอยู่แล้วที่พอร์ต 3000 (PID: ${existingPid})`);
    return true;
  }

  // Ensure DB is running first
  const dbStatus = getDockerPostgresStatus();
  if (dbStatus !== "RUNNING") {
    const dbOk = await startDb();
    if (!dbOk) return false;
  }

  info("กำลังเริ่มต้น Backend API Server (Bun + Hono)...");
  const logStream = openSync(SERVER_LOG_FILE, "a");
  const child = spawn("cmd.exe", ["/c", "bun", "run", "--cwd", "apps/server", "dev"], {
    detached: true,
    stdio: ["ignore", logStream, logStream],
    windowsHide: true,
  });
  closeSync(logStream);
  child.unref();

  if (child.pid) {
    writeFileSync(SERVER_PID_FILE, String(child.pid));
    let healthy = false;
    for (let i = 0; i < 20; i++) {
      await Bun.sleep(500);
      const health = await checkApiHealth();
      if (health.ready) {
        healthy = true;
        break;
      }
    }
    const realPid = getPidOnPort(3000) ?? child.pid;
    writeFileSync(SERVER_PID_FILE, String(realPid));
    const lanIp = detectLanIps()[0] ?? "127.0.0.1";
    const httpsReady = await isPortOpen(3443);
    if (healthy) {
      success(`API Server พร้อมทำงานแล้วที่ http://${lanIp}:3000${httpsReady ? ` และ https://${lanIp}:3443` : ""} (PID: ${realPid})`);
    } else {
      warn(`Server เริ่มต้นแล้ว (PID: ${realPid}) กำลังรอเชื่อมต่อ สามารถดู Log ได้ด้วย: thepos logs server`);
    }
    return true;
  } else {
    error("ไม่สามารถเริ่ม API Server ได้");
    return false;
  }
}

function stopServer(): boolean {
  const portPid = getPidOnPort(3000);
  const storedPid = readStoredPid(SERVER_PID_FILE);
  const targetPid = portPid ?? storedPid;

  if (!targetPid && !portPid) {
    warn("API Server ไม่ได้ทำงานอยู่");
    try { unlinkSync(SERVER_PID_FILE); } catch {}
    return true;
  }

  info(`กำลังหยุด API Server (PID: ${targetPid})...`);
  if (targetPid) killProcessTree(targetPid);
  try { unlinkSync(SERVER_PID_FILE); } catch {}
  success("หยุด API Server เรียบร้อยแล้ว");
  return true;
}

async function startDesktop(): Promise<boolean> {
  const existingPid = readStoredPid(DESKTOP_PID_FILE);
  if (existingPid) {
    warn(`Desktop POS กำลังทำงานอยู่แล้ว (PID: ${existingPid})`);
    return true;
  }

  const portOpen = await isPortOpen(3000);
  if (!portOpen) {
    info("ตรวจพบว่า API Server ยังไม่ทำงาน กำลังเริ่มเซิร์ฟเวอร์ให้อัตโนมัติ...");
    const sOk = await startServer();
    if (!sOk) return false;
  }

  info("กำลังเริ่มต้นแอปพลิเคชันเดสก์ท็อปหน้าร้าน (Tauri 2)...");
  const logStream = openSync(DESKTOP_LOG_FILE, "a");
  const child = spawn("cmd.exe", ["/c", "bun", "run", "--cwd", "apps/desktop", "tauri", "dev"], {
    detached: true,
    stdio: ["ignore", logStream, logStream],
    windowsHide: true,
  });
  closeSync(logStream);
  child.unref();

  if (child.pid) {
    writeFileSync(DESKTOP_PID_FILE, String(child.pid));
    success(`แอปพลิเคชัน Desktop POS กำลังเปิดใช้งาน (PID: ${child.pid})`);
    info("หากเป็นการเปิดครั้งแรก ระบบจะทำการคอมไพล์ UI และหน้าต่างแอปพลิเคชันจะปรากฏขึ้น");
    return true;
  } else {
    error("ไม่สามารถเริ่ม Desktop POS ได้");
    return false;
  }
}

function stopDesktop(): boolean {
  const pid = readStoredPid(DESKTOP_PID_FILE);
  if (!pid) {
    warn("Desktop POS ไม่ได้ทำงานอยู่");
    try { unlinkSync(DESKTOP_PID_FILE); } catch {}
    return true;
  }
  info(`กำลังหยุด Desktop POS (PID: ${pid})...`);
  killProcessTree(pid);
  try { unlinkSync(DESKTOP_PID_FILE); } catch {}
  success("หยุด Desktop POS เรียบร้อยแล้ว");
  return true;
}

async function startWeb(): Promise<boolean> {
  const existingPid = getPidOnPort(4173) ?? readStoredPid(WEB_PID_FILE);
  if (existingPid && await isPortOpen(4173)) {
    warn(`บริการหน้าเว็บ (Web Portal) กำลังทำงานอยู่แล้วที่พอร์ต 4173 (PID: ${existingPid})`);
    return true;
  }

  info("กำลังเริ่มต้นบริการหน้าเว็บกลาง (Web Portal - web-portal)...");
  const logStream = openSync(WEB_LOG_FILE, "a");
  const child = spawn("cmd.exe", ["/c", "bun", "run", "--cwd", "web-portal", "dev"], {
    detached: true,
    stdio: ["ignore", logStream, logStream],
    windowsHide: true,
  });
  closeSync(logStream);
  child.unref();

  if (child.pid) {
    writeFileSync(WEB_PID_FILE, String(child.pid));
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await Bun.sleep(400);
      if (await isPortOpen(4173)) {
        ready = true;
        break;
      }
    }
    const realPid = getPidOnPort(4173) ?? child.pid;
    writeFileSync(WEB_PID_FILE, String(realPid));
    const lanIp = detectLanIps()[0] ?? "127.0.0.1";
    if (ready) {
      success(`บริการหน้าเว็บ (Web Portal) พร้อมใช้งานที่ http://${lanIp}:4173 (PID: ${realPid})`);
    } else {
      warn(`Web Portal เริ่มต้นแล้ว (PID: ${realPid}) กำลังรอเปิดพอร์ต 4173`);
    }
    return true;
  }
  error("ไม่สามารถเริ่ม Web Portal ได้");
  return false;
}

function stopWeb(): boolean {
  const portPid = getPidOnPort(4173);
  const storedPid = readStoredPid(WEB_PID_FILE);
  const targetPid = portPid ?? storedPid;

  if (!targetPid) {
    warn("บริการหน้าเว็บ (Web Portal) ไม่ได้ทำงานอยู่");
    try { unlinkSync(WEB_PID_FILE); } catch {}
    return true;
  }

  info(`กำลังหยุดบริการหน้าเว็บ (PID: ${targetPid})...`);
  killProcessTree(targetPid);
  try { unlinkSync(WEB_PID_FILE); } catch {}
  success("หยุดบริการหน้าเว็บเรียบร้อยแล้ว");
  return true;
}

async function startAll() {
  log(`\n${c.bold}${c.cyan}======================================================${c.reset}`);
  log(`${c.bold}${c.cyan}   🚀 กำลังเริ่มต้นระบบทั้งหมด (Start All Services)     ${c.reset}`);
  log(`${c.bold}${c.cyan}======================================================${c.reset}\n`);
  const dbOk = await startDb();
  if (!dbOk) return;
  const sOk = await startServer();
  if (!sOk) return;
  await startDesktop();
  await printSetupHintIfNeeded();
  log(`\n${c.green}${c.bold}✔ ระบบทั้งหมดถูกสั่งเริ่มทำงานเรียบร้อยแล้ว (DB + Server + Desktop)${c.reset}\n`);
}

async function stopAll() {
  log(`\n${c.bold}${c.yellow}======================================================${c.reset}`);
  log(`${c.bold}${c.yellow}   🛑 กำลังหยุดการทำงานระบบทั้งหมด (Stop All Services) ${c.reset}`);
  log(`${c.bold}${c.yellow}======================================================${c.reset}\n`);
  stopDesktop();
  if (getPidOnPort(4173) ?? readStoredPid(WEB_PID_FILE)) {
    stopWeb();
  }
  stopServer();
  stopDb();
  log(`\n${c.green}${c.bold}✔ บริการทั้งหมดถูกหยุดเรียบร้อยแล้ว${c.reset}\n`);
}

async function restartComponent(target: string) {
  log(`\n${c.bold}${c.magenta}🔄 กำลังรีสตาร์ท: ${target.toUpperCase()}${c.reset}`);
  switch (target.toLowerCase()) {
    case "db":
      stopDb();
      await Bun.sleep(1000);
      await startDb();
      break;
    case "server":
      stopServer();
      await Bun.sleep(1000);
      await startServer();
      break;
    case "web":
      stopWeb();
      await Bun.sleep(1000);
      await startWeb();
      break;
    case "desktop":
      stopDesktop();
      await Bun.sleep(1000);
      await startDesktop();
      break;
    case "all":
    default:
      await stopAll();
      await Bun.sleep(1500);
      await startAll();
      break;
  }
}

// ==========================================
// 📊 System Status Dashboard
// ==========================================
async function showStatus() {
  log(`\n${c.bold}${c.cyan}======================================================${c.reset}`);
  log(`${c.bold}${c.cyan}         📊 สถานะระบบปัจจุบัน (SYSTEM STATUS)         ${c.reset}`);
  log(`${c.bold}${c.cyan}======================================================${c.reset}\n`);

  // DB
  const dbStatus = getDockerPostgresStatus();
  const dbPort = await isPortOpen(54329);
  let dbDisplay = `${c.red}● หยุดทำงาน (Stopped)${c.reset}`;
  if (dbStatus === "RUNNING" && dbPort) {
    dbDisplay = `${c.green}● กำลังทำงาน (Healthy - Port 54329)${c.reset}`;
  } else if (dbStatus === "RUNNING") {
    dbDisplay = `${c.yellow}● คอนเทนเนอร์รันอยู่แต่พอร์ต 54329 ยังไม่เปิด${c.reset}`;
  }

  // Server
  const serverPort = await isPortOpen(3000);
  const serverPid = getPidOnPort(3000) ?? readStoredPid(SERVER_PID_FILE);
  const health = await checkApiHealth();
  let serverDisplay = `${c.red}● หยุดทำงาน (Stopped)${c.reset}`;
  if (health.ready) {
    serverDisplay = `${c.green}● กำลังทำงาน (Online & Ready - Port 3000${serverPid ? ` - PID: ${serverPid}` : ""})${c.reset}`;
  } else if (serverPort) {
    serverDisplay = `${c.yellow}● พอร์ต 3000 เปิดอยู่ (API Health ไม่พร้อม)${c.reset}`;
  }

  // Desktop
  const desktopPid = readStoredPid(DESKTOP_PID_FILE);
  let desktopDisplay = `${c.gray}○ หยุดทำงาน (Not running)${c.reset}`;
  if (desktopPid) {
    desktopDisplay = `${c.green}● กำลังทำงาน (PID: ${desktopPid})${c.reset}`;
  }

  // Standalone Web Portal (web-portal)
  const webPort = await isPortOpen(4173);
  const webPid = getPidOnPort(4173) ?? readStoredPid(WEB_PID_FILE);
  let webDisplay = `${c.gray}○ หยุดทำงาน (Not running)${c.reset}`;
  if (webPort) {
    webDisplay = `${c.green}● กำลังทำงาน (Port 4173${webPid ? ` - PID: ${webPid}` : ""})${c.reset}`;
  }

  const lanIp = detectLanIps()[0] ?? "127.0.0.1";
  const httpsPort = await isPortOpen(3443);

  console.log(`  1. ฐานข้อมูล PostgreSQL:     ${dbDisplay}`);
  console.log(`  2. Backend API Server:     ${serverDisplay}`);
  console.log(`  3. บริการหน้าเว็บ (Web):      ${webDisplay}`);
  console.log(`  4. แอปพลิเคชันเดสก์ท็อป POS:   ${desktopDisplay}`);
  if (health.ready) {
    console.log(`  5. ลิงก์ LAN (HTTP):         ${c.cyan}http://${lanIp}:3000${c.reset}`);
    if (httpsPort) {
      console.log(`  6. ลิงก์ LAN (HTTPS มือถือ): ${c.cyan}https://${lanIp}:3443/stock-count${c.reset}`);
    }
    if (webPort) {
      console.log(`  7. เว็บกลาง (Standalone):   ${c.cyan}http://${lanIp}:4173${c.reset}`);
    }
    await printSetupHintIfNeeded();
  }
  console.log(`\n${c.gray}------------------------------------------------------${c.reset}\n`);
}

// ==========================================
// 🩺 Doctor & Readiness Check
// ==========================================
async function runDoctor() {
  log(`\n${c.bold}${c.cyan}======================================================${c.reset}`);
  log(`${c.bold}${c.cyan}    🩺 ตรวจสอบความพร้อมของระบบ (SYSTEM READINESS)     ${c.reset}`);
  log(`${c.bold}${c.cyan}======================================================${c.reset}\n`);

  let allGood = true;

  // 1. Docker
  process.stdout.write("  [1/9] ตรวจสอบ Docker Daemon:                   ");
  try {
    execSync("docker info", { stdio: "ignore" });
    console.log(`${c.green}[ผ่าน / READY]${c.reset}`);
  } catch {
    console.log(`${c.red}[ไม่ผ่าน / FAILED] - Docker ไม่ได้เปิดอยู่${c.reset}`);
    allGood = false;
  }

  // 2. PostgreSQL Container
  process.stdout.write("  [2/9] ตรวจสอบ PostgreSQL Container:            ");
  const dbStatus = getDockerPostgresStatus();
  if (dbStatus === "RUNNING") {
    console.log(`${c.green}[ผ่าน / RUNNING]${c.reset}`);
  } else {
    console.log(`${c.yellow}[เตือน / STOPPED] - รันได้ด้วย 'thepos start db'${c.reset}`);
  }

  // 3. PostgreSQL Port 54329
  process.stdout.write("  [3/9] ตรวจสอบการเชื่อมต่อ Port 54329:          ");
  const dbPort = await isPortOpen(54329);
  if (dbPort) {
    console.log(`${c.green}[ผ่าน / OPEN]${c.reset}`);
  } else {
    console.log(`${c.gray}[ยังไม่เปิด / CLOSED]${c.reset}`);
  }

  // 4. .env File
  process.stdout.write("  [4/9] ตรวจสอบไฟล์การตั้งค่า (.env):            ");
  if (existsSync(".env")) {
    const envContent = readFileSync(".env", "utf8");
    if (envContent.includes("DATABASE_URL") && envContent.includes("JWT_SECRET")) {
      console.log(`${c.green}[ผ่าน / COMPLETE]${c.reset}`);
    } else {
      console.log(`${c.yellow}[เตือน / INCOMPLETE] - ขาด Key สำคัญใน .env${c.reset}`);
      allGood = false;
    }
  } else {
    console.log(`${c.red}[ไม่ผ่าน / MISSING] - ไม่พบไฟล์ .env${c.reset}`);
    allGood = false;
  }

  // 5. Bun Runtime
  process.stdout.write("  [5/9] ตรวจสอบ Bun Runtime (>= 1.3):            ");
  try {
    const v = execSync("bun --version", { encoding: "utf8" }).trim();
    console.log(`${c.green}[ผ่าน / v${v}]${c.reset}`);
  } catch {
    console.log(`${c.red}[ไม่ผ่าน / FAILED] - ไม่พบ Bun${c.reset}`);
    allGood = false;
  }

  // 6. Node.js & Rustc
  process.stdout.write("  [6/9] ตรวจสอบ Rust Compiler & Node.js:         ");
  try {
    const r = execSync("rustc --version", { encoding: "utf8" }).split(" ")[1];
    const n = execSync("node --version", { encoding: "utf8" }).trim();
    console.log(`${c.green}[ผ่าน / Rust ${r}, Node ${n}]${c.reset}`);
  } catch {
    console.log(`${c.yellow}[เตือน / PARTIAL]${c.reset}`);
  }

  // 7. Database Migrations Status
  process.stdout.write("  [7/9] ตรวจสอบ Schema & Migrations:             ");
  if (dbPort) {
    try {
      execSync("bun run --cwd apps/server exec prisma migrate status", { stdio: "ignore" });
      console.log(`${c.green}[ผ่าน / UP TO DATE]${c.reset}`);
    } catch {
      console.log(`${c.yellow}[ต้อง migrate / PENDING]${c.reset}`);
    }
  } else {
    console.log(`${c.gray}[ข้าม / ขาดการเชื่อมต่อฐานข้อมูล]${c.reset}`);
  }

  // 8. Backend API Health
  process.stdout.write("  [8/9] ตรวจสอบความพร้อม API (/api/v1/health):   ");
  const health = await checkApiHealth();
  if (health.ready) {
    console.log(`${c.green}[ผ่าน / READY]${c.reset}`);
  } else {
    console.log(`${c.gray}[ออฟไลน์ / OFFLINE] - รันได้ด้วย 'thepos start server'${c.reset}`);
  }

  // 9. Type Safety & Contracts
  process.stdout.write("  [9/9] ตรวจสอบ TypeScript Type Safety:          ");
  try {
    execSync("bun run typecheck", { stdio: "ignore" });
    console.log(`${c.green}[ผ่าน / 0 ERRORS]${c.reset}`);
  } catch {
    console.log(`${c.red}[ไม่ผ่าน / TYPE ERRORS]${c.reset}`);
    allGood = false;
  }

  log(`\n${c.gray}------------------------------------------------------${c.reset}`);
  if (allGood) {
    success("สภาพแวดล้อมระบบพร้อมทำงานสมบูรณ์ 100%! สั่งเริ่มระบบได้ด้วย: thepos start all");
  } else {
    warn("พบรายการที่ต้องแก้ไข กรุณาดูคำแนะนำด้านบนก่อนเริ่มทำงาน");
  }
  log("");
}

// ==========================================
// 📜 Log Viewer
// ==========================================
function viewLogs(target: string) {
  const chosen = target.toLowerCase();
  log(`\n${c.bold}${c.cyan}======================================================${c.reset}`);
  log(`${c.bold}${c.cyan}   📜 กำลังเปิดดู LOG: ${chosen.toUpperCase()} (กด Ctrl+C เพื่อออก) ${c.reset}`);
  log(`${c.bold}${c.cyan}======================================================${c.reset}\n`);

  if (chosen === "db") {
    try {
      execSync("docker compose -f infra/docker/docker-compose.dev.yml logs -f --tail 50", { stdio: "inherit" });
    } catch {}
    return;
  }

  const logFile = chosen === "desktop" ? DESKTOP_LOG_FILE : chosen === "web" ? WEB_LOG_FILE : SERVER_LOG_FILE;
  if (!existsSync(logFile)) {
    warn(`ยังไม่พบไฟล์ Log: ${logFile} (เริ่มบริการก่อนเพื่อเริ่มบันทึก Log)`);
    return;
  }

  // Read existing content
  const content = readFileSync(logFile, "utf8");
  if (content.trim()) {
    const lines = content.split("\n");
    console.log(lines.slice(-40).join("\n"));
  } else {
    info(`กำลังรอข้อความ log ใหม่ใน ${logFile}...`);
  }

  // Watch for new content incrementally
  let lastSize = statSync(logFile).size;
  const watcher = setInterval(() => {
    try {
      const currentSize = statSync(logFile).size;
      if (currentSize < lastSize) {
        lastSize = 0;
      }
      if (currentSize > lastSize) {
        const delta = currentSize - lastSize;
        const fd = openSync(logFile, "r");
        try {
          const buffer = Buffer.allocUnsafe(delta);
          const bytesRead = readSync(fd, buffer, 0, delta, lastSize);
          if (bytesRead > 0) {
            process.stdout.write(buffer.subarray(0, bytesRead).toString("utf8"));
            lastSize += bytesRead;
          }
        } finally {
          closeSync(fd);
        }
      }
    } catch {}
  }, 400);

  process.on("SIGINT", () => {
    clearInterval(watcher);
    process.exit(0);
  });
}

// ==========================================
// 🧪 Automated Test Suite Runner
// ==========================================
function runTests(suite: string): boolean {
  log(`\n${c.bold}${c.cyan}======================================================${c.reset}`);
  log(`${c.bold}${c.cyan}   🧪 รันชุดทดสอบอัตโนมัติ: ${suite.toUpperCase()}      ${c.reset}`);
  log(`${c.bold}${c.cyan}======================================================${c.reset}\n`);

  let failed = 0;
  const run = (name: string, cmd: string) => {
    info(`กำลังรัน ${name}...`);
    try {
      execSync(cmd, { stdio: "inherit" });
      success(`${name} ผ่านเรียบร้อย ✔`);
    } catch {
      failed++;
      error(`${name} ล้มเหลว ✖`);
    }
    log("");
  };

  switch (suite.toLowerCase()) {
    case "unit":
      run("Unit Tests (Vitest)", "bun run test");
      break;
    case "integration":
      run("Integration Tests (PostgreSQL 16)", "bun run test:integration");
      break;
    case "typecheck":
      run("Typecheck Across Monorepo", "bun run typecheck");
      break;
    case "rust":
      run("Rust Tauri Tests", "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml");
      break;
    case "all":
    default:
      run("Typecheck", "bun run typecheck");
      run("Unit Tests", "bun run test");
      run("Integration Tests", "bun run test:integration");
      run("Rust Native Tests", "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml");
      break;
  }
  return failed === 0;
}

// ==========================================
// ♻️ Factory Reset System
// ==========================================
async function resetSystem(force = false) {
  log(`\n${c.bold}${c.red}======================================================${c.reset}`);
  log(`${c.bold}${c.red}   ⚠️  รีเซ็ตระบบและล้างข้อมูลทั้งหมด (FACTORY RESET)   ${c.reset}`);
  log(`${c.bold}${c.red}======================================================${c.reset}\n`);
  warn("การดำเนินการนี้จะลบข้อมูลทั้งหมดในฐานข้อมูล, รหัสผ่าน, การตั้งค่าเครื่อง POS และบิลที่ค้างอยู่");

  if (!force) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question(`\n  พิมพ์ ${c.bold}RESET${c.reset} เพื่อยืนยันการล้างข้อมูลทั้งหมด (หรือกด Enter เพื่อยกเลิก): `, resolve);
    });
    rl.close();
    if (answer.trim() !== "RESET") {
      info("ยกเลิกการรีเซ็ตระบบ");
      return;
    }
  }

  log("");
  // 1. Stop Desktop & Server
  info("1/6 กำลังหยุดการทำงานของ Desktop POS และ API Server...");
  stopDesktop();
  try { execSync("taskkill /F /IM thepos-desktop.exe", { stdio: "ignore" }); } catch {}
  stopServer();

  // 2. Wipe AppData & LocalAppData
  info("2/6 กำลังล้างไฟล์ตั้งค่าและแคชของแอปพลิเคชันหน้าร้าน...");
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  if (appData) {
    const dir = `${appData}\\coop.thepos.desktop`;
    if (existsSync(dir)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }
  if (localAppData) {
    const dir = `${localAppData}\\coop.thepos.desktop`;
    if (existsSync(dir)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }
  success("ล้างไฟล์ตั้งค่าเครื่อง POS เรียบร้อย");

  // 3. Wipe Windows Credential Manager entries
  info("3/6 กำลังล้างโทเคนและข้อมูลการยืนยันตัวตนใน Windows Credential Vault...");
  try {
    const output = execSync("cmdkey /list", { encoding: "utf8" });
    const lines = output.split("\n");
    let count = 0;
    for (const line of lines) {
      const match = line.match(/Target:\s*(?:LegacyGeneric:target=)?([^\r\n]+thepos-desktop)/i);
      if (match && match[1]) {
        const target = match[1].trim();
        try {
          execFileSync("cmdkey", [`/delete:${target}`], { stdio: "ignore" });
          count++;
        } catch {}
      }
    }
    success(`ล้างข้อมูล Credential Vault จำนวน ${count} รายการ`);
  } catch {
    warn("ไม่สามารถตรวจสอบ Credential Vault ได้");
  }

  // 4. Wipe Logs
  info("4/6 กำลังล้างไฟล์ Log เก่า...");
  for (const file of [SERVER_LOG_FILE, DESKTOP_LOG_FILE, WEB_LOG_FILE, SERVER_PID_FILE, DESKTOP_PID_FILE, WEB_PID_FILE]) {
    if (existsSync(file)) {
      try { unlinkSync(file); } catch {}
    }
  }
  success("ล้างไฟล์ Log เรียบร้อย");

  // 5. Reset Database Volume & Re-migrate + Seed
  info("5/6 กำลังล้างฐานข้อมูล PostgreSQL และสร้างใหม่ตั้งแต่ต้น...");
  try {
    execSync("docker compose -f infra/docker/docker-compose.dev.yml down -v", { stdio: "inherit" });
    execSync("docker compose -f infra/docker/docker-compose.dev.yml up -d --wait", { stdio: "inherit" });
    execSync("bun run db:migrate", { stdio: "inherit" });
    execSync("bun run db:seed", { stdio: "inherit" });
    success("รีเซ็ตฐานข้อมูลและ Seed สิทธิ์เริ่มต้นเรียบร้อย");
  } catch {
    error("เกิดข้อผิดพลาดในการรีเซ็ตฐานข้อมูล (โปรดตรวจสอบ Docker)");
    return;
  }

  // 6. Start all services fresh
  info("6/6 กำลังเริ่มต้นระบบทั้งหมดใหม่...");
  await startAll();
  success("รีเซ็ตระบบทั้งหมดเสร็จสมบูรณ์ พร้อมเริ่มต้นใช้งานใหม่ตั้งแต่หน้าแรก!");
}

// ==========================================
// 📱 Interactive CLI Menu
// ==========================================
async function showInteractiveMenu() {
  await showStatus();

  log(`${c.bold}เมนูคำสั่งระบบ:${c.reset}`);
  log(`  ${c.cyan}[1]${c.reset} ตรวจสอบความพร้อมทั้งระบบ (Health Check & Doctor)`);
  log(`  ${c.cyan}[2]${c.reset} แสดงสถานะบริการทั้งหมด (Status Dashboard)`);
  log(`  ${c.green}[3]${c.reset} เริ่มต้นระบบทั้งหมด (Start All: DB + Server + Desktop)`);
  log(`  ${c.green}[4]${c.reset} เริ่มต้นเฉพาะส่วน (Start: db / server / web / desktop)`);
  log(`  ${c.magenta}[5]${c.reset} รีสตาร์ทเฉพาะส่วน (Restart: all / db / server / web / desktop)`);
  log(`  ${c.yellow}[6]${c.reset} หยุดการทำงาน (Stop: all / db / server / web / desktop)`);
  log(`  ${c.blue}[7]${c.reset} ดู Log แบบเรียลไทม์ (Live Logs)`);
  log(`  ${c.white}[8]${c.reset} รันชุดทดสอบทั้งหมด (Run All Tests)`);
  log(`  ${c.red}[9]${c.reset} รีเซ็ตระบบและล้างข้อมูลทั้งหมด (Factory Reset & Restart Fresh)`);
  log(`  ${c.gray}[0]${c.reset} ออกจากโปรแกรม (Exit)`);
  log("");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(`${c.bold}เลือกเมนู [0-9]: ${c.reset}`, async (answer) => {
    rl.close();
    switch (answer.trim()) {
      case "1":
        await runDoctor();
        break;
      case "2":
        await showStatus();
        break;
      case "3":
        await startAll();
        break;
      case "4": {
        const sub = readline.createInterface({ input: process.stdin, output: process.stdout });
        sub.question("เลือกบริการที่ต้องการเริ่ม (db / server / web / desktop): ", async (item) => {
          sub.close();
          const target = item.trim().toLowerCase();
          if (target === "db") await startDb();
          else if (target === "server") await startServer();
          else if (target === "web") await startWeb();
          else if (target === "desktop") await startDesktop();
          else warn("ไม่พบคำสั่งที่เลือก");
        });
        return;
      }
      case "5": {
        const sub = readline.createInterface({ input: process.stdin, output: process.stdout });
        sub.question("เลือกบริการที่ต้องการรีสตาร์ท (all / db / server / web / desktop): ", async (item) => {
          sub.close();
          await restartComponent(item.trim());
        });
        return;
      }
      case "6": {
        const sub = readline.createInterface({ input: process.stdin, output: process.stdout });
        sub.question("เลือกบริการที่ต้องการหยุด (all / db / server / web / desktop): ", async (item) => {
          sub.close();
          const target = item.trim().toLowerCase();
          if (target === "all") await stopAll();
          else if (target === "db") stopDb();
          else if (target === "server") stopServer();
          else if (target === "web") stopWeb();
          else if (target === "desktop") stopDesktop();
          else warn("ไม่พบคำสั่งที่เลือก");
        });
        return;
      }
      case "7": {
        const sub = readline.createInterface({ input: process.stdin, output: process.stdout });
        sub.question("เลือก Log ที่ต้องการดู (all / server / web / desktop / db): ", (item) => {
          sub.close();
          viewLogs(item.trim() || "server");
        });
        return;
      }
      case "8":
        runTests("all");
        break;
      case "9":
        await resetSystem(false);
        break;
      case "0":
        log("ลาก่อนครับ!");
        process.exit(0);
        break;
      default:
        warn("ไม่พบตัวเลือก กรุณาลองใหม่อีกครั้ง");
        break;
    }
  });
}

// ==========================================
// 🏁 Main Entrypoint
// ==========================================
const [action, target = "all"] = process.argv.slice(2);

switch (action) {
  case "check":
  case "doctor":
    await runDoctor();
    break;
  case "status":
    await showStatus();
    break;
  case "start":
    if (target === "all") await startAll();
    else if (target === "db") await startDb();
    else if (target === "server") await startServer();
    else if (target === "web") await startWeb();
    else if (target === "desktop") await startDesktop();
    else warn(`ไม่รู้จักคำสั่งเริ่ม: ${target}`);
    break;
  case "stop":
    if (target === "all") await stopAll();
    else if (target === "db") stopDb();
    else if (target === "server") stopServer();
    else if (target === "web") stopWeb();
    else if (target === "desktop") stopDesktop();
    else warn(`ไม่รู้จักคำสั่งหยุด: ${target}`);
    break;
  case "restart":
    await restartComponent(target);
    break;
  case "logs":
  case "log":
    viewLogs(target);
    break;
  case "test":
    if (!runTests(target)) process.exitCode = 1;
    break;
  case "reset":
    await resetSystem(target === "--force" || target === "-y" || target === "-f");
    break;
  case "help":
  case "--help":
  case "-h":
    log(`
${c.bold}Cooperative POS Control Tool (เครื่องมือควบคุมระบบ POS สหกรณ์)${c.reset}

${c.bold}การใช้งานคำสั่ง:${c.reset}
  thepos                       เปิดเมนูควบคุมแบบอินเตอร์แอคทีฟ (Interactive Menu)
  thepos check                 ตรวจสอบความพร้อมของระบบทั้งหมด (Doctor / Readiness)
  thepos status                แสดงสถานะของบริการทั้งหมด (Status Dashboard)
  thepos start [all|db|server|web|desktop]     เริ่มต้นบริการ
  thepos stop [all|db|server|web|desktop]      หยุดบริการ
  thepos restart [all|db|server|web|desktop]   รีสตาร์ทบริการ
  thepos logs [server|web|desktop|db]          ดู Log แบบเรียลไทม์
  thepos test [all|unit|integration|typecheck|rust]  รันชุดทดสอบ
  thepos reset [-y|--force]                ล้างข้อมูลทั้งหมด (DB/Vault/Cache) และเริ่มระบบใหม่หมด
`);
    break;
  default:
    if (action) {
      warn(`ไม่พบคำสั่ง: ${action}`);
      log("พิมพ์ 'thepos help' เพื่อดูคำสั่งทั้งหมด");
    } else {
      await showInteractiveMenu();
    }
    break;
}
