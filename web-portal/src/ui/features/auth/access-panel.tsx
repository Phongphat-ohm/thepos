import { Barcode, LockKeyhole, Monitor, ReceiptText, Server } from "lucide-react";
import { BrandLogo } from "@/components/common/brand-logo";
import { isDesktopApp } from "@/lib/native";

export type AccessScreenMode = "loading" | "offline" | "connect" | "register" | "login" | "locked";

export function AccessPanel({ screen, registered }: { screen: AccessScreenMode; registered: boolean }) {
  const setup = screen === "connect" || screen === "register";
  const steps = ["เชื่อมต่อเซิร์ฟเวอร์", "ลงทะเบียนเครื่อง", "เข้าสู่ระบบ"];
  return (
    <aside className="access-panel" aria-label="ระบบหน้าร้านสหกรณ์">
      <div className="wordmark">
        <span className="brand-icon"><BrandLogo size={32} /></span> ระบบหน้าร้านสหกรณ์
      </div>
      {screen === "locked" ? (
        <div className="access-visual access-visual-lock" aria-hidden="true">
          <div className="access-terminal">
            <Monitor size={42} strokeWidth={1.5} />
            <span className="access-lock"><LockKeyhole size={23} strokeWidth={1.75} /></span>
          </div>
        </div>
      ) : (
        <div className="access-visual" aria-hidden="true">
          <div className="access-terminal">
            <Monitor size={36} strokeWidth={1.5} />
            <span className="access-receipt"><ReceiptText size={26} strokeWidth={1.5} /></span>
          </div>
          <span className="access-node"><Barcode size={20} /></span>
          <span className="access-node"><Server size={20} /></span>
        </div>
      )}
      {setup ? (
        <ol className="access-steps" aria-label="ขั้นตอนตั้งค่าเครื่อง">
          {steps.map((label, index) => (
            <li key={label} aria-current={index === (screen === "connect" ? 0 : 1) ? "step" : undefined}>
              <span aria-hidden="true">{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      ) : registered && isDesktopApp() ? (
        <span className="access-status"><Monitor size={16} aria-hidden="true" /> เครื่องลงทะเบียนแล้ว</span>
      ) : null}
    </aside>
  );
}
