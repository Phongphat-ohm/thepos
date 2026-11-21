import {
  Barcode,
  ChevronRight,
  History,
  LockKeyhole,
  Monitor,
  PackageCheck,
  ServerOff,
  ShoppingCart,
  UserRound,
  Users,
} from "lucide-react";
import type { Profile } from "@thepos/contracts";
import type { AppRoute } from "@/components/layout/navigation";
import { StoreDashboard } from "./store-dashboard";

const roleNames = {
  ADMIN: "ผู้ดูแลระบบ",
  MANAGER: "ผู้จัดการ",
  CASHIER: "แคชเชียร์",
  STOCK_STAFF: "พนักงานคลัง",
};

const shortcuts = [
  { route: "pos", permission: "sales:checkout", icon: ShoppingCart, title: "ขายหน้าร้าน (POS)", text: "สแกนสินค้า คิดเงิน และออกใบเสร็จ" },
  { route: "history", permission: "sales:read", icon: History, title: "ประวัติการขาย", text: "ดูใบเสร็จและรับคืนสินค้า" },
  { route: "members", permission: "member:read", icon: Users, title: "จัดการสมาชิก", text: "ทะเบียนสมาชิก ยอดซื้อ และบัญชีหุ้น" },
  { route: "catalog:products", permission: "catalog:read", icon: Barcode, title: "รายการสินค้า", text: "สินค้า ราคา และบาร์โค้ด" },
  { route: "inventory:receive", permission: "inventory:receive", icon: PackageCheck, title: "รับสินค้าเข้าคลัง", text: "บันทึกรับล็อตสินค้าจากผู้จัดจำหน่าย" },
] as const;

export function HomePage({
  profile,
  desktop,
  offline,
  onNavigate,
}: {
  profile: Profile;
  desktop: boolean;
  serverUrl?: string | null;
  offline: boolean;
  onNavigate: (route: AppRoute) => void;
}) {
  const can = (permission: NonNullable<Profile["capabilities"]>[number]) =>
    profile.capabilities?.includes(permission) ?? false;
  const visibleShortcuts = shortcuts.filter(
    ({ route: target, permission }) => (target !== "pos" || desktop) && can(permission),
  );

  return (
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
      </div>

      {visibleShortcuts.length > 0 && (
        <div className="surface dashboard-actions">
          <div className="surface-heading">
            <h2>ทางลัดเข้าสู่ระบบงาน</h2>
          </div>
          <div className="dashboard-shortcut-grid">
            {visibleShortcuts.map(({ route: target, icon: Icon, title, text }) => (
              <button
                key={target}
                type="button"
                className={`shortcut-tile${target === "pos" ? " is-primary" : ""}`}
                onClick={() => onNavigate(target)}
              >
                <span className="shortcut-icon"><Icon size={20} aria-hidden="true" /></span>
                <span className="shortcut-copy"><strong>{title}</strong><span>{text}</span></span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
