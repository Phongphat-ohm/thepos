import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Barcode,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  History,
  LockKeyhole,
  LogOut,
  Monitor,
  PackageCheck,
  QrCode,
  RefreshCw,
  ReceiptText,
  Server,
  ServerOff,
  ShoppingCart,
  UserRound,
  Users,
} from "lucide-react";
import { loginSchema, type Profile } from "@thepos/contracts";
import { AppShell, canOpenSettings, canOpenStock, type AppRoute } from "./components/app-shell";
import { BrandLogo } from "./components/brand-logo";
import { Password, Pin, Username, readFields } from "./components/fields";
import { Button } from "./components/ui/button";
import { Loading } from "./components/loading";
import { WebAccessModal } from "./components/web-access-modal";
import { ConnectForm, RegisterForm } from "./features/wizard";
import { hasReports } from "./features/reports/options";
import { StoreDashboard } from "./features/reports/dashboard";
import type { SettingsView } from "./features/settings/workspace";
import type { StockView } from "./features/stock/workspace";
import { confirmAction, dismissAlerts, notifyError, notifySuccess } from "./lib/alerts";
import { errorCode, errorMessage, isDesktopApp, native, type Connection } from "./lib/native";
import { watchIdle } from "./lib/idle-lock";

const MembersWorkspace = lazy(() => import("./features/members/workspace").then((m) => ({ default: m.MembersWorkspace })));
const DividendWorkspace = lazy(() => import("./features/dividends/workspace").then((m) => ({ default: m.DividendWorkspace })));
const ShiftsWorkspace = lazy(() => import("./features/shifts/workspace").then((m) => ({ default: m.ShiftsWorkspace })));
const ReportsWorkspace = lazy(() => import("./features/reports/workspace").then((m) => ({ default: m.ReportsWorkspace })));
const SalesHistoryPage = lazy(() => import("./features/pos/history-page").then((m) => ({ default: m.SalesHistoryPage })));
const StockWorkspace = lazy(() => import("./features/stock/workspace").then((m) => ({ default: m.StockWorkspace })));
const Register = lazy(() => import("./features/pos/workspace").then((m) => ({ default: m.Register })));
const SettingsWorkspace = lazy(() => import("./features/settings/workspace").then((m) => ({ default: m.SettingsWorkspace })));

type Screen = "loading" | "offline" | "connect" | "register" | "login" | "home" | "locked";
const roleNames = { ADMIN: "ผู้ดูแลระบบ", MANAGER: "ผู้จัดการ", CASHIER: "แคชเชียร์", STOCK_STAFF: "พนักงานคลัง" };
const initial: Connection = { url: null, setup: null, lockedUser: null };

const titles: Record<Screen, string> = {
  loading: "กำลังเปิดระบบ",
  offline: "เชื่อมต่อระบบไม่ได้",
  connect: "เชื่อมต่อเซิร์ฟเวอร์",
  register: "ตั้งค่าร้านค้าครั้งแรก",
  login: "เข้าสู่ระบบ",
  home: "ภาพรวมระบบ",
  locked: "หน้าจอถูกล็อก",
};

const shortcuts = [
  { route: "pos", permission: "sales:checkout", icon: ShoppingCart, title: "ขายหน้าร้าน (POS)", text: "สแกนสินค้า คิดเงิน และออกใบเสร็จ" },
  { route: "history", permission: "sales:read", icon: History, title: "ประวัติการขาย", text: "ดูใบเสร็จและรับคืนสินค้า" },
  { route: "members", permission: "member:read", icon: Users, title: "จัดการสมาชิก", text: "ทะเบียนสมาชิก ยอดซื้อ และบัญชีหุ้น" },
  { route: "stock:products", permission: "catalog:read", icon: Barcode, title: "รายการสินค้า", text: "สินค้า ราคา และบาร์โค้ด" },
  { route: "stock:receive", permission: "inventory:receive", icon: PackageCheck, title: "รับสินค้าเข้าคลัง", text: "บันทึกรับล็อตสินค้าจากผู้จัดจำหน่าย" },
  { route: "stock:counts", permission: "inventory:read", icon: ClipboardList, title: "ใบตรวจนับสต็อก", text: "ตรวจสอบและอนุมัติผลตรวจนับ" },
] as const;

function AccessPanel({ screen, registered }: { screen: Screen; registered: boolean }) {
  const setup = screen === "connect" || screen === "register";
  const steps = ["เชื่อมต่อเซิร์ฟเวอร์", "ลงทะเบียนเครื่อง", "เข้าสู่ระบบ"];
  return <aside className="access-panel" aria-label="ระบบหน้าร้านสหกรณ์">
    <div className="wordmark"><span className="brand-icon"><BrandLogo size={32} /></span> ระบบหน้าร้านสหกรณ์</div>
    {screen === "locked" ? <div className="access-visual access-visual-lock" aria-hidden="true">
      <div className="access-terminal">
        <Monitor size={42} strokeWidth={1.5} />
        <span className="access-lock"><LockKeyhole size={23} strokeWidth={1.75} /></span>
      </div>
    </div> : <div className="access-visual" aria-hidden="true">
      <div className="access-terminal">
        <Monitor size={36} strokeWidth={1.5} />
        <span className="access-receipt"><ReceiptText size={26} strokeWidth={1.5} /></span>
      </div>
      <span className="access-node"><Barcode size={20} /></span>
      <span className="access-node"><Server size={20} /></span>
    </div>}
    {setup ? <ol className="access-steps" aria-label="ขั้นตอนตั้งค่าเครื่อง">
      {steps.map((label, index) => <li key={label} aria-current={index === (screen === "connect" ? 0 : 1) ? "step" : undefined}>
        <span aria-hidden="true">{index + 1}</span>{label}
      </li>)}
    </ol> : registered && isDesktopApp() ? <span className="access-status"><Monitor size={16} aria-hidden="true" /> เครื่องลงทะเบียนแล้ว</span> : null}
  </aside>;
}

function stockViewFromRoute(route: AppRoute): StockView | null {
  if (!route.startsWith("stock:")) return null;
  return route.slice("stock:".length) as StockView;
}

function settingsViewFromRoute(route: AppRoute): SettingsView | null {
  if (!route.startsWith("settings:")) return null;
  return route.slice("settings:".length) as SettingsView;
}

export function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [route, setRoute] = useState<AppRoute>("home");
  const [connection, setConnection] = useState(initial);
  const [profile, setProfile] = useState<Profile>();
  const [lockedUser, setLockedUser] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [webModal, setWebModal] = useState(false);
  const [message, setMessage] = useState("");
  const [offline, setOffline] = useState(false);
  const pending = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const useConnection = useCallback((value: Connection) => {
    setConnection(value);
    setLockedUser(value.lockedUser ?? undefined);
    setScreen(value.lockedUser ? "locked" : value.setup?.registered ? "login" : value.setup ? "register" : "connect");
  }, []);

  const run = useCallback(async (action: () => Promise<void>, onError?: (error: unknown) => void, failureTitle?: string) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      const text = errorMessage(error);
      if (failureTitle) void notifyError(failureTitle, text); else setMessage(text);
      onError?.(error);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, []);

  const startup = useCallback(() => run(async () => {
    setScreen("loading");
    useConnection(await native.startup());
  }, () => setScreen("offline")), [run, useConnection]);

  useEffect(() => { void startup(); }, [startup]);

  useEffect(() => {
    if (screen === "offline" || screen === "loading") titleRef.current?.focus();
  }, [screen]);

  const home = (value: Profile) => {
    setOffline(false);
    setRoute("home");
    setProfile(value);
    setScreen("home");
  };

  const lock = useCallback(() => {
    dismissAlerts();
    setLockedUser(profile?.user.name);
    setProfile(undefined);
    setScreen("locked");
    void native.lock().catch(() => undefined);
  }, [profile?.user.name]);

  useEffect(() => {
    if (screen !== "home") return;
    return watchIdle(lock);
  }, [screen, lock]);

  const performLogout = useCallback(() => {
    dismissAlerts();
    if (screen === "home") {
      setLockedUser(profile?.user.name);
      setProfile(undefined);
      setScreen("locked");
    }
    setBusy(true);
    void native.logout()
      .then(() => {
        setLockedUser(undefined);
        setScreen("login");
      })
      .catch((error) => {
        void notifyError("ออกจากระบบไม่สำเร็จ", errorMessage(error));
      })
      .finally(() => {
        pending.current = false;
        setBusy(false);
      });
  }, [profile?.user.name, screen]);

  useEffect(() => {
    if (screen !== "home") return;
    let active = true;
    const probe = async () => {
      try {
        const value = await native.profile();
        if (active) {
          setOffline(false);
          setProfile((current) =>
            current && JSON.stringify(current) === JSON.stringify(value) ? current : value,
          );
        }
      } catch (error) {
        if (!active) return;
        const code = errorCode(error);
        if (code === "SESSION_LOCKED") {
          lock();
        } else if (code === "SESSION_REQUIRED" || code === "FORBIDDEN") {
          performLogout();
        } else if (code === "DEVICE_REQUIRED" || code === "INVALID_SERVER_KEY") {
          void startup();
        } else setOffline(true);
      }
    };
    const timer = window.setInterval(() => void probe(), 30_000);
    window.addEventListener("online", probe);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("online", probe);
    };
  }, [screen, lock, performLogout, startup]);

  const requestLogout = useCallback(async () => {
    if (screen === "home") {
      const ok = await confirmAction({
        title: "ออกจากระบบ?",
        text: "คุณต้องการออกจากระบบในเครื่องนี้ใช่หรือไม่",
        confirmText: "ออกจากระบบ",
        cancelText: "ยกเลิก",
        danger: true,
      });
      if (!ok) return;
    }
    performLogout();
  }, [performLogout, screen]);

  const initialized = !!connection.setup?.initialized;
  const title = screen === "register" && initialized ? "ลงทะเบียนเครื่อง POS" : titles[screen];
  const stockView = stockViewFromRoute(route);
  const settingsView = settingsViewFromRoute(route);
  const desktop = isDesktopApp() && !profile?.device.isWebDevice;
  const can = (permission: NonNullable<Profile["capabilities"]>[number]) =>
    profile?.capabilities?.includes(permission) ?? false;
  const visibleShortcuts = shortcuts.filter(
    ({ route: target, permission }) => (target !== "pos" || desktop) && can(permission),
  );

  if (screen === "home" && profile) {
    return (
      <AppShell
        profile={profile}
        route={route}
        serverUrl={connection.url}
        offline={offline}
        busy={busy}
        onNavigate={setRoute}
        onLock={lock}
        onLogout={() => void requestLogout()}
        onPasswordChanged={performLogout}
      >
        <Suspense fallback={<Loading label="กำลังโหลดหน้าจอการทำงาน" variant="skeleton" />}>
          {route === "pos" && desktop && can("sales:checkout") ? (
            <Register profile={profile} exit={() => setRoute("home")} onOpenHistory={() => setRoute("history")}
              onOpenShifts={can("shift:operate") || can("shift:review") ? () => setRoute("shifts") : undefined} />
          ) : route === "history" && can("sales:read") ? (
            <SalesHistoryPage profile={profile} />
          ) : route === "members" && can("member:read") ? (
            <MembersWorkspace profile={profile} />
          ) : route === "dividends" && can("dividend:read") ? (
            <DividendWorkspace profile={profile} />
          ) : route === "shifts" && (can("shift:operate") || can("shift:review")) ? (
            <ShiftsWorkspace profile={profile} />
          ) : route === "reports" && hasReports(profile) ? (
            <ReportsWorkspace profile={profile} />
          ) : settingsView && canOpenSettings(route, profile) ? (
            <SettingsWorkspace key={settingsView} view={settingsView} userId={profile.user.id} deviceId={profile.device.id} onRename={(name) => {
              setProfile((current) => current && { ...current, store: { ...current.store, name } });
            }} />
          ) : stockView && canOpenStock(route, profile) ? (
            <StockWorkspace key={stockView} profile={profile} view={stockView} />
          ) : (
            <section className="dashboard-grid" aria-label="ข้อมูลผู้ใช้งานและเมนูด่วน">
              {offline && (
                <div className="notice" role="status">
                  <ServerOff /> ติดต่อเซิร์ฟเวอร์ไม่ได้ ระบบจะตรวจการเชื่อมต่ออีกครั้งอัตโนมัติ
                </div>
              )}

              <StoreDashboard />
              <div className="surface dashboard-profile">
                <div className="surface-heading">
                  <h2>ข้อมูลเซสชันปัจจุบัน</h2>
                </div>
                <dl className="profile">
                  <div><dt><UserRound /> ผู้ใช้งาน</dt><dd>{profile.user.name}</dd></div>
                  {desktop && <div><dt><Monitor /> เครื่อง POS</dt><dd>{profile.device.name}</dd></div>}
                  <div><dt><LockKeyhole /> บทบาท</dt><dd>{profile.user.roles.map((role) => roleNames[role]).join(", ")}</dd></div>
                </dl>
                {desktop && connection.url && (
                  <div className="form-actions">
                    <Button type="button" variant="outline" onClick={() => setWebModal(true)}>
                      <QrCode size={16} /> QR Code เข้าเว็บ
                    </Button>
                    <Button type="button" onClick={() => void native.openWeb().catch((reason) => notifyError("เปิดหน้าเว็บไม่สำเร็จ", errorMessage(reason)))}>
                      <ExternalLink size={16} /> เปิดหน้าเว็บ
                    </Button>
                  </div>
                )}
                {webModal && connection.url && <WebAccessModal url={connection.url} close={() => setWebModal(false)} />}
              </div>

              {visibleShortcuts.length > 0 && <div className="surface dashboard-actions">
                <div className="surface-heading">
                  <h2>ทางลัดเข้าสู่ระบบงาน</h2>
                </div>
                <div className="dashboard-shortcut-grid">
                  {visibleShortcuts.map(({ route: target, icon: Icon, title, text }) => (
                    <button key={target} type="button" className={`shortcut-tile${target === "pos" ? " is-primary" : ""}`} onClick={() => setRoute(target)}>
                      <span className="shortcut-icon"><Icon size={20} aria-hidden="true" /></span>
                      <span className="shortcut-copy"><strong>{title}</strong><span>{text}</span></span>
                      <ChevronRight size={17} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>}
            </section>
          )}
        </Suspense>
      </AppShell>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#access-content">ข้ามไปแบบฟอร์ม</a>
      <main id="access-content" tabIndex={-1}>
        <section className={screen === "register" ? "workspace workspace-wide wrap" : "workspace wrap"} aria-labelledby="title">
          <AccessPanel screen={screen} registered={!!connection.setup?.registered} />
          <div className="access-form" aria-busy={busy} key={screen} data-enter>
            <div className="surface-heading">
              <h1 id="title" ref={titleRef} tabIndex={-1}>{title}</h1>
              {screen === "connect" && <p>ระบุที่อยู่ API ของร้านเพื่อเริ่มใช้งานเครื่องนี้</p>}
              {screen === "register" && <p>{initialized ? "ใช้บัญชีผู้ดูแลระบบเพื่ออนุมัติเครื่องนี้" : "กรอกข้อมูลร้านค้า บัญชีผู้ดูแล และชื่อเครื่องขายเครื่องแรก"}</p>}
              {screen === "login" && <p>ใช้ชื่อผู้ใช้และรหัสผ่านของคุณ</p>}
              {screen === "locked" && <p>{lockedUser ? `กรอกรหัส PIN ของ ${lockedUser} เพื่อกลับมาใช้งาน` : "กรอกรหัส PIN เพื่อกลับมาใช้งาน"}</p>}
            </div>
            {message && <div className="notice" role="alert"><AlertCircle />{message}</div>}
            {screen === "loading" && <Loading label="กำลังเชื่อมต่อระบบหน้าร้าน" />}
            {screen === "offline" && (
              <div className="form-actions">
                <Button variant="ghost" onClick={() => { setMessage(""); setScreen("connect"); }}>เปลี่ยนที่อยู่เซิร์ฟเวอร์</Button>
                <Button onClick={() => void startup()} disabled={busy}><RefreshCw /> ลองอีกครั้ง</Button>
              </div>
            )}
            {screen === "connect" && <ConnectForm url={connection.url ?? ""} hasExisting={!!connection.setup}
              busy={busy} onBack={() => { setMessage(""); useConnection(connection); }}
              onInvalidInput={setMessage}
              onConnect={(url, serverKey) => void run(async () => useConnection(await native.connect(url, serverKey)), undefined, "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ")} />}
            {screen === "register" && (
              <RegisterForm initialized={initialized} registered={!!connection.setup?.registered} busy={busy}
                onInvalidInput={(msg) => setMessage(msg ?? errorMessage("INVALID_INPUT"))}
                onBack={() => {
                  setMessage("");
                  setScreen(connection.setup?.registered ? "login" : "connect");
                }}
                onSwitchServer={() => { setMessage(""); setScreen("connect"); }}
                onBootstrap={(input) => void run(async () => {
                  await native.bootstrap(input);
                  useConnection(await native.startup());
                  notifySuccess("ตั้งค่าร้านและเครื่องแล้ว");
                }, undefined, "ตั้งค่าร้านไม่สำเร็จ")}
                onEnroll={(input) => void run(async () => {
                  await native.enroll(input);
                  useConnection(await native.startup());
                  notifySuccess("ลงทะเบียนเครื่องแล้ว");
                }, undefined, "ลงทะเบียนเครื่องไม่สำเร็จ")}
              />
            )}
            {screen === "login" && (
              <form className="form-stack" noValidate onSubmit={(event) => {
                const input = readFields(event, setMessage);
                if (!input) return;
                const result = loginSchema.safeParse(input);
                if (!result.success) {
                  setMessage(errorMessage("INVALID_INPUT"));
                  return;
                }
                void run(async () => home(await native.login(result.data)), (error) => {
                  if (errorCode(error) === "SESSION_LOCKED") setScreen("locked");
                }, "เข้าสู่ระบบไม่สำเร็จ");
              }}>
                <Username autoFocus /><Password />
                <div className="form-actions">
                  <div className="register-inline">
                    <Button type="button" variant="ghost" disabled={busy} onClick={() => { setMessage(""); setScreen("connect"); }}>เปลี่ยนเซิร์ฟเวอร์</Button>
                    {desktop && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setMessage(""); setScreen("register"); }}>เปลี่ยนเครื่อง POS</Button>}
                  </div>
                  <Button className="primary-action" loading={busy && "กำลังเข้าสู่ระบบ"}>เข้าสู่ระบบ <ArrowRight /></Button>
                </div>
              </form>
            )}
            {screen === "locked" && (
              <form className="form-stack" noValidate onSubmit={(event) => {
                event.preventDefault();
                if (pending.current) return;
                const form = event.currentTarget;
                const input = readFields(event, setMessage);
                if (!input) return;
                const pin = String(input.pin);
                form.reset();
                void run(async () => {
                  try {
                    home(await native.unlock(pin));
                  } catch (error) {
                    await notifyError("ปลดล็อกไม่สำเร็จ", errorMessage(error));
                    if (errorCode(error) === "SESSION_REQUIRED") {
                      await native.logout();
                      setScreen("login");
                    }
                  }
                });
              }}>
                <Pin autoFocus autoSubmit disabled={busy} hint="ปลดล็อกอัตโนมัติเมื่อกรอก PIN ครบ 6 หลัก" />
                <div className="form-actions">
                  <Button type="button" variant="ghost" onClick={performLogout} disabled={busy}><LogOut /> ออกจากระบบ</Button>
                  <Button className="primary-action" loading={busy && "กำลังปลดล็อก"}><LockKeyhole /> ปลดล็อก</Button>
                </div>
              </form>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
