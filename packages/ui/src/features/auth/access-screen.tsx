import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { AlertCircle, ArrowRight, LockKeyhole, LogOut, RefreshCw } from "lucide-react";
import { loginSchema, type Profile } from "@thepos/contracts";
import { Password, Pin, Username, readFields } from "@/components/common/fields";
import { Loading } from "@/components/common/loading";
import { Button } from "@/components/ui/button";
import { notifyError, notifyInfo, notifySuccess } from "@/lib/alerts";
import { errorCode, errorMessage, native, type Connection } from "@/lib/native";
import { AccessPanel, type AccessScreenMode } from "./access-panel";
import { AdminGateModal, type AdminCredentials } from "./admin-gate-modal";
import { ConnectForm, RegisterForm } from "./wizard";

const titles: Record<AccessScreenMode, string> = {
  loading: "กำลังเปิดระบบ",
  offline: "เชื่อมต่อระบบไม่ได้",
  connect: "เชื่อมต่อเซิร์ฟเวอร์",
  register: "ตั้งค่าร้านค้าครั้งแรก",
  login: "เข้าสู่ระบบ",
  locked: "หน้าจอถูกล็อก",
};

export function AccessScreen({
  screen,
  connection,
  lockedUser,
  busy,
  desktop,
  message,
  pending,
  initialVerifiedAdmin,
  onConsumeInitialAdmin,
  setMessage,
  setScreen,
  useConnection,
  run,
  startup,
  onAuthenticated,
  onLogout,
}: {
  screen: AccessScreenMode;
  connection: Connection;
  lockedUser?: string;
  busy: boolean;
  desktop: boolean;
  message: string;
  pending: MutableRefObject<boolean>;
  initialVerifiedAdmin?: AdminCredentials | null;
  onConsumeInitialAdmin?: () => void;
  setMessage: (msg: string) => void;
  setScreen: (screen: AccessScreenMode) => void;
  useConnection: (value: Connection) => void;
  run: (action: () => Promise<void>, onError?: (error: unknown) => void, failureTitle?: string) => Promise<void>;
  startup: () => Promise<void>;
  onAuthenticated: (profile: Profile) => void;
  onLogout: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [adminGate, setAdminGate] = useState<"connect" | "register" | null>(null);
  const [verifiedAdmin, setVerifiedAdmin] = useState<AdminCredentials | null>(initialVerifiedAdmin ?? null);
  const [lastConnectAttempt, setLastConnectAttempt] = useState<{ url: string; errorCode: string } | null>(null);

  useEffect(() => {
    if (initialVerifiedAdmin) {
      setVerifiedAdmin(initialVerifiedAdmin);
      onConsumeInitialAdmin?.();
    }
  }, [initialVerifiedAdmin, onConsumeInitialAdmin]);

  useEffect(() => {
    if (screen === "offline" || screen === "loading") titleRef.current?.focus();
    if (screen === "login" || screen === "locked" || screen === "offline") {
      setVerifiedAdmin(null);
    }
  }, [screen]);

  const initialized = !!connection.setup?.initialized;
  const title = screen === "register" && initialized ? "ลงทะเบียนเครื่อง POS" : titles[screen];

  function requestSwitchServer() {
    setMessage("");
    if (initialized && !verifiedAdmin) {
      setAdminGate("connect");
      return;
    }
    setScreen("connect");
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
              {screen === "register" && (
                <p>{initialized ? "ใช้บัญชีผู้ดูแลระบบเพื่ออนุมัติหรือเปลี่ยนเครื่อง POS นี้" : "กรอกข้อมูลร้านค้า บัญชีผู้ดูแล และชื่อเครื่องขายเครื่องแรก"}</p>
              )}
              {screen === "login" && <p>ใช้ชื่อผู้ใช้และรหัสผ่านของคุณ</p>}
              {screen === "locked" && (
                <p>{lockedUser ? `กรอกรหัส PIN ของ ${lockedUser} เพื่อกลับมาใช้งาน` : "กรอกรหัส PIN เพื่อกลับมาใช้งาน"}</p>
              )}
            </div>
            {message && <div className="notice" role="alert"><AlertCircle />{message}</div>}
            {screen === "loading" && <Loading label="กำลังเชื่อมต่อระบบหน้าร้าน" />}
            {screen === "offline" && (
              <div className="form-actions">
                <Button variant="ghost" onClick={() => { setMessage(""); setScreen("connect"); }}>เปลี่ยนที่อยู่เซิร์ฟเวอร์</Button>
                <Button onClick={() => void startup()} disabled={busy}><RefreshCw /> ลองอีกครั้ง</Button>
              </div>
            )}
            {screen === "connect" && (
              <ConnectForm
                url={connection.url ?? (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("server") ?? "" : "")}
                hasExisting={!!connection.setup}
                busy={busy}
                lastAttemptUrl={lastConnectAttempt?.url}
                lastErrorCode={lastConnectAttempt?.errorCode}
                onBack={() => { setMessage(""); setLastConnectAttempt(null); setVerifiedAdmin(null); useConnection(connection); }}
                onInvalidInput={setMessage}
                onConnect={(url, serverKey) =>
                  void run(
                    async () => {
                      setLastConnectAttempt(null);
                      const next = await native.connect(url, serverKey);
                      setVerifiedAdmin(null);
                      useConnection(next);
                    },
                    (error) => setLastConnectAttempt({ url, errorCode: errorCode(error) ?? "NETWORK_ERROR" }),
                    "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ",
                  )
                }
              />
            )}
            {screen === "register" && (
              <RegisterForm
                initialized={initialized}
                registered={!!connection.setup?.registered}
                verifiedAdmin={verifiedAdmin}
                busy={busy}
                onInvalidInput={(msg) => setMessage(msg ?? errorMessage("INVALID_INPUT"))}
                onBack={() => {
                  setMessage("");
                  if (connection.setup?.registered) {
                    setVerifiedAdmin(null);
                    setScreen("login");
                  } else {
                    requestSwitchServer();
                  }
                }}
                onSwitchServer={requestSwitchServer}
                onBootstrap={(input) =>
                  void run(
                    async () => {
                      await native.bootstrap(input);
                      setVerifiedAdmin(null);
                      useConnection(await native.startup());
                      notifySuccess("ตั้งค่าร้านและเครื่องแล้ว");
                    },
                    undefined,
                    "ตั้งค่าร้านไม่สำเร็จ",
                  )
                }
                onEnroll={(input) =>
                  void run(
                    async () => {
                      await native.enroll(input);
                      setVerifiedAdmin(null);
                      useConnection(await native.startup());
                      notifySuccess("ลงทะเบียนเครื่องแล้ว");
                    },
                    undefined,
                    "ลงทะเบียนเครื่องไม่สำเร็จ",
                  )
                }
              />
            )}
            {screen === "login" && (
              <form
                className="form-stack"
                noValidate
                onSubmit={(event) => {
                  const input = readFields(event, setMessage);
                  if (!input) return;
                  const result = loginSchema.safeParse(input);
                  if (!result.success) {
                    setMessage(errorMessage("INVALID_INPUT"));
                    return;
                  }
                  void run(
                    async () => onAuthenticated(await native.login(result.data)),
                    (error) => {
                      if (errorCode(error) === "SESSION_LOCKED") setScreen("locked");
                    },
                    "เข้าสู่ระบบไม่สำเร็จ",
                  );
                }}
              >
                <Username autoFocus />
                <Password />
                <div className="form-actions">
                  {!desktop && (
                    <div className="register-inline">
                      <Button type="button" variant="ghost" disabled={busy} onClick={requestSwitchServer}>เปลี่ยนเซิร์ฟเวอร์</Button>
                    </div>
                  )}
                  <Button className="primary-action" loading={busy && "กำลังเข้าสู่ระบบ"}>เข้าสู่ระบบ <ArrowRight /></Button>
                </div>
              </form>
            )}
            {screen === "locked" && (
              <form
                className="form-stack"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  if (pending.current) return;
                  const form = event.currentTarget;
                  const input = readFields(event, setMessage);
                  if (!input) return;
                  const pin = String(input.pin);
                  form.reset();
                  void run(async () => {
                    try {
                      onAuthenticated(await native.unlock(pin));
                    } catch (error) {
                      await notifyError("ปลดล็อกไม่สำเร็จ", errorMessage(error));
                      if (errorCode(error) === "SESSION_REQUIRED") {
                        await native.logout();
                        setScreen("login");
                      }
                    }
                  });
                }}
              >
                <Pin autoFocus autoSubmit disabled={busy} hint="ปลดล็อกอัตโนมัติเมื่อกรอก PIN ครบ 6 หลัก" />
                <div className="form-actions">
                  <Button type="button" variant="ghost" onClick={onLogout} disabled={busy}><LogOut /> ออกจากระบบ</Button>
                  <Button className="primary-action" loading={busy && "กำลังปลดล็อก"}><LockKeyhole /> ปลดล็อก</Button>
                </div>
              </form>
            )}
          </div>
        </section>
      </main>
      {adminGate && (
        <AdminGateModal
          target={adminGate}
          close={() => setAdminGate(null)}
          onVerified={(credentials) => {
            const target = adminGate;
            setAdminGate(null);
            setVerifiedAdmin(credentials);
            setScreen(target);
          }}
          onServerUnreachable={() => {
            setAdminGate(null);
            setVerifiedAdmin(null);
            notifyInfo("เชื่อมต่อเซิร์ฟเวอร์เดิมไม่สำเร็จ", "ระบบเปิดหน้าตั้งค่าที่อยู่เซิร์ฟเวอร์ให้แล้ว");
            setScreen("connect");
          }}
        />
      )}
    </div>
  );
}
