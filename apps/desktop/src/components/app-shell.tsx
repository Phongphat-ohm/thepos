import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Barcode,
  Banknote,
  Building2,
  ClipboardList,
  ClipboardPenLine,
  ChevronDown,
  ChevronRight,
  History,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  Monitor,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  ServerOff,
  Settings,
  Sheet,
  ShieldCheck,
  ShoppingCart,
  Package,
  Store,
  UserRound,
  Users,
  Warehouse,
  ArrowLeftRight,
  X,
} from "lucide-react";
import type { FormEvent } from "react";
import { changePasswordSchema, type Profile } from "@thepos/contracts";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand-logo";
import { Field } from "@/components/fields";
import { Modal } from "@/components/modal";
import { notifyError, notifySuccess } from "@/lib/alerts";
import { business, errorMessage, isDesktopApp } from "@/lib/native";
import { hasReports } from "../features/reports/options";
import type { SettingsView } from "../features/settings/workspace";
import type { StockView } from "../features/stock/workspace";

export type AppRoute =
  | "home"
  | "pos"
  | "history"
  | "members"
  | "dividends"
  | "reports"
  | "shifts"
  | `settings:${SettingsView}`
  | `stock:${StockView}`;

type Permission = NonNullable<Profile["capabilities"]>[number];

const NAV_GROUPS = [
  { key: "overview", label: "ภาพรวมและรายงาน", icon: LayoutDashboard },
  { key: "sales", label: "ขายหน้าร้าน", icon: ShoppingCart },
  { key: "members", label: "สมาชิกและปันผล", icon: Users },
  { key: "catalog", label: "สินค้าและผู้จัดจำหน่าย", icon: Package },
  { key: "stock", label: "คลังสินค้า", icon: Warehouse },
  { key: "admin", label: "การดูแลระบบ", icon: Settings },
] as const;
const SESSION_GROUP = { key: "session", label: "บัญชีผู้ใช้", icon: UserRound } as const;
type PageGroup = (typeof NAV_GROUPS)[number];
type SidebarGroup = PageGroup | typeof SESSION_GROUP;

type NavItem = {
  route: AppRoute;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: Permission;
  group: PageGroup["key"];
};

const NAV_ITEMS: NavItem[] = [
  { route: "home", label: "ภาพรวมระบบ", icon: LayoutDashboard, group: "overview" },
  { route: "reports", label: "รายงาน", icon: Sheet, group: "overview" },
  { route: "pos", label: "ขายหน้าร้าน (POS)", icon: ShoppingCart, permission: "sales:checkout", group: "sales" },
  { route: "history", label: "ประวัติการขาย", icon: History, permission: "sales:read", group: "sales" },
  { route: "shifts", label: "กะเงินสด", icon: ClipboardList, group: "sales" },
  { route: "members", label: "จัดการสมาชิก", icon: Users, permission: "member:read", group: "members" },
  { route: "dividends", label: "ปันผลและเฉลี่ยคืน", icon: Banknote, permission: "dividend:read", group: "members" },
  { route: "stock:products", label: "รายการสินค้า", icon: Barcode, permission: "catalog:read", group: "catalog" },
  { route: "stock:suppliers", label: "ผู้จัดจำหน่าย", icon: Building2, permission: "catalog:read", group: "catalog" },
  { route: "stock:import", label: "นำเข้าไฟล์สินค้า", icon: Sheet, permission: "catalog:write", group: "catalog" },
  { route: "stock:receive", label: "รับสินค้าเข้าคลัง", icon: PackageCheck, permission: "inventory:receive", group: "stock" },
  { route: "stock:lots", label: "สต็อกคงเหลือ", icon: Warehouse, permission: "inventory:read", group: "stock" },
  { route: "stock:movements", label: "ความเคลื่อนไหวสต็อก", icon: ArrowLeftRight, permission: "inventory:read", group: "stock" },
  { route: "stock:count-entry", label: "บันทึกตรวจนับ", icon: ClipboardPenLine, permission: "inventory:count", group: "stock" },
  { route: "stock:counts", label: "ใบตรวจนับสต็อก", icon: ClipboardList, permission: "inventory:read", group: "stock" },
  { route: "settings:store", label: "ข้อมูลร้านและใบเสร็จ", icon: Store, permission: "settings:manage", group: "admin" },
  { route: "settings:hardware", label: "เครื่องพิมพ์และอุปกรณ์", icon: Printer, permission: "settings:manage", group: "admin" },
  { route: "settings:staff", label: "บัญชีพนักงาน", icon: Users, permission: "settings:manage", group: "admin" },
  { route: "settings:devices", label: "เครื่อง POS ที่ลงทะเบียน", icon: Monitor, permission: "settings:manage", group: "admin" },
  { route: "settings:audit", label: "บันทึกตรวจสอบ (Audit Log)", icon: ShieldCheck, permission: "settings:manage", group: "admin" },
];

export function canOpenStock(route: AppRoute, profile: Profile) {
  if (!route.startsWith("stock:")) return false;
  const item = NAV_ITEMS.find((entry) => entry.route === route);
  return !!item?.permission && (profile.capabilities?.includes(item.permission) ?? false);
}

export function canOpenSettings(route: AppRoute, profile: Profile) {
  if (!route.startsWith("settings:")) return false;
  const item = NAV_ITEMS.find((entry) => entry.route === route);
  return !!item?.permission && (profile.capabilities?.includes(item.permission) ?? false);
}

const routeDescriptions: Record<Exclude<AppRoute, "home" | "pos">, string> = {
  history: "ค้นหาใบเสร็จและตรวจสอบรายการคืนสินค้า",
  members: "ทะเบียนสมาชิก ยอดซื้อสะสม และบัญชีหุ้น",
  dividends: "จัดการงวดบัญชี คำนวณยอด และบันทึกการจ่าย",
  reports: "เลือกช่วงข้อมูลและส่งออกเป็น Excel หรือ PDF",
  shifts: "เปิดกะ บันทึกเงินเข้าออก และกระทบยอดลิ้นชัก",
  "settings:store": "จัดการข้อมูลร้าน ภาษี และข้อความหัว-ท้ายใบเสร็จ",
  "settings:hardware": "ตั้งค่าเครื่องพิมพ์ ทดสอบลิ้นชัก และทดสอบเครื่องสแกนบาร์โค้ด",
  "settings:staff": "เพิ่ม แก้ไข บทบาท และระงับการใช้งานบัญชีพนักงาน",
  "settings:devices": "จัดการเครื่อง POS รหัสเครื่อง และตัดเซสชันที่ค้างอยู่",
  "settings:audit": "ตรวจสอบประวัติการเข้าใช้งานและการแก้ไขข้อมูลสำคัญในระบบ (เฉพาะผู้ดูแลระบบ)",
  "stock:products": "จัดการราคา หน่วยนับ และบาร์โค้ด",
  "stock:suppliers": "ค้นหาและดูข้อมูลติดต่อของผู้จัดจำหน่าย",
  "stock:receive": "บันทึกรับสินค้าตามผู้จัดจำหน่ายและล็อต",
  "stock:lots": "ตรวจยอดคงเหลือ ผู้จัดจำหน่าย และวันหมดอายุรายล็อต",
  "stock:movements": "ตรวจรายการรับเข้า ขาย คืน และปรับยอดของสินค้า",
  "stock:count-entry": "กรอกจำนวนที่นับได้ตามล็อตแล้วส่งให้ผู้จัดการ",
  "stock:counts": "ตรวจสอบและพิจารณาผลต่างจากการตรวจนับ",
  "stock:import": "ตรวจสอบรายการจากไฟล์ก่อนบันทึกเข้าระบบ",
};

function SidebarSection({ group, open, active, onToggle, children }: {
  group: SidebarGroup;
  open: boolean;
  active?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const Icon = group.icon;
  const id = `shell-menu-${group.key}`;
  return <div className="shell-nav-group">
    <button
      type="button"
      className={`shell-nav-item shell-nav-toggle${active ? " is-current-group" : ""}`}
      aria-label={group.label}
      aria-expanded={open}
      aria-controls={id}
      title={group.label}
      onClick={onToggle}
    >
      <Icon size={18} aria-hidden="true" />
      <span>{group.label}</span>
      <ChevronDown className="shell-nav-chevron" size={15} aria-hidden="true" />
    </button>
    <div id={id} className="shell-nav-submenu" hidden={!open}>{children}</div>
  </div>;
}

export function AppShell({
  profile,
  route,
  serverUrl,
  offline,
  busy,
  onNavigate,
  onLock,
  onLogout,
  onPasswordChanged,
  children,
}: {
  profile: Profile;
  route: AppRoute;
  serverUrl?: string | null;
  offline: boolean;
  busy: boolean;
  onNavigate: (route: AppRoute) => void;
  onLock: () => void;
  onLogout: () => void;
  onPasswordChanged?: () => void;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [passwordModal, setPasswordModal] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menuClose = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const current = NAV_ITEMS.find((item) => item.route === route) ?? NAV_ITEMS[0];
  const PageIcon = current.icon;
  const [expandedGroups, setExpandedGroups] = useState<Partial<Record<SidebarGroup["key"], boolean>>>({
    [current.group]: true,
  });
  const railOnly = collapsed && !mobileOpen;

  useEffect(() => {
    setExpandedGroups((groups) => groups[current.group] === undefined
      ? { ...groups, [current.group]: true }
      : groups);
  }, [current.group]);

  function toggleGroup(key: SidebarGroup["key"]) {
    if (railOnly) {
      setCollapsed(false);
      setExpandedGroups((groups) => ({ ...groups, [key]: true }));
      return;
    }
    setExpandedGroups((groups) => ({ ...groups, [key]: !groups[key] }));
  }

  const can = (permission?: Permission) =>
    !permission || (profile.capabilities?.includes(permission) ?? false);

  const desktop = isDesktopApp() && !profile.device.isWebDevice;
  const items = NAV_ITEMS.filter((item) => can(item.permission) &&
    (item.route !== "pos" || desktop) &&
    (item.route !== "reports" || hasReports(profile)) &&
    (item.route !== "shifts" || can("shift:operate") || can("shift:review")));

  function closeMenu() {
    setMobileOpen(false);
    requestAnimationFrame(() => menuTrigger.current?.focus());
  }

  useEffect(() => {
    if (!mobileOpen) return;
    menuClose.current?.focus();
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    const compact = matchMedia("(max-width: 960px)");
    const resized = () => { if (!compact.matches) setMobileOpen(false); };
    document.addEventListener("keydown", dismiss);
    compact.addEventListener("change", resized);
    return () => {
      document.removeEventListener("keydown", dismiss);
      compact.removeEventListener("change", resized);
    };
  }, [mobileOpen]);

  const navigate = (next: AppRoute) => {
    setMobileOpen(false);
    onNavigate(next);
    if (mobileOpen) requestAnimationFrame(() => heading.current?.focus());
  };

  return (
    <div className={`shell-layout${collapsed ? " shell-collapsed" : ""}`}>
      {mobileOpen && (
        <div
          className="shell-backdrop"
          aria-hidden="true"
          onClick={closeMenu}
        />
      )}

      <aside
        id="workspace-navigation"
        className={`shell-sidebar${mobileOpen ? " is-open" : ""}`}
        aria-label="เมนูหลัก"
        role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen ? true : undefined}
      >
        <div className="shell-brand">
          <div className="shell-brand-mark">
            <span className="brand-icon">
              <BrandLogo size={28} />
            </span>
            <div className="shell-brand-text">
              <strong>{profile.store.name}</strong>
              <span>ระบบหน้าร้านสหกรณ์</span>
            </div>
          </div>
          <button
            type="button"
            className="shell-collapse-btn"
            aria-label={collapsed ? "ขยายเมนูด้านข้าง" : "พับเมนูด้านข้าง"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "ขยายเมนู" : "พับเมนู"}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <button
            type="button"
            className="shell-mobile-close"
            ref={menuClose}
            aria-label="ปิดเมนู"
            onClick={closeMenu}
          >
            <X size={18} />
          </button>
        </div>

        <nav className="shell-nav" aria-label="พื้นที่ทำงาน">
          {NAV_GROUPS.map((group) => {
            const links = items.filter((item) => item.group === group.key);
            if (!links.length) return null;
            return <SidebarSection key={group.key} group={group} open={!railOnly && !!expandedGroups[group.key]}
              active={current.group === group.key} onToggle={() => toggleGroup(group.key)}>
              {links.map(({ route: target, label, icon: Icon }) => (
                <button
                  key={target}
                  type="button"
                  className={`shell-nav-item${route === target ? " is-active" : ""}`}
                  aria-current={route === target ? "page" : undefined}
                  aria-label={label}
                  title={label}
                  onClick={() => navigate(target)}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </SidebarSection>;
          })}
        </nav>

        <div className="shell-sidebar-footer">
          <SidebarSection group={SESSION_GROUP} open={!railOnly && !!expandedGroups.session}
            onToggle={() => toggleGroup(SESSION_GROUP.key)}>
            <button type="button" className="shell-nav-item" disabled={busy} onClick={() => setPasswordModal(true)}>
              <KeyRound size={18} aria-hidden="true" />
              <span>เปลี่ยนรหัสผ่าน</span>
            </button>
            <button type="button" className="shell-nav-item" disabled={busy} onClick={onLock}>
              <LockKeyhole size={18} aria-hidden="true" />
              <span>ล็อกหน้าจอ</span>
            </button>
            <button type="button" className="shell-nav-item shell-nav-danger" disabled={busy} onClick={onLogout}>
              <LogOut size={18} aria-hidden="true" />
              <span>ออกจากระบบ</span>
            </button>
          </SidebarSection>
        </div>
      </aside>
      {passwordModal && (
        <ChangePasswordModal
          close={() => setPasswordModal(false)}
          saved={() => {
            setPasswordModal(false);
            notifySuccess("เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่");
            onPasswordChanged?.();
          }}
        />
      )}

      <div className="shell-main" inert={mobileOpen}>
        <a className="skip-link" href="#workspace-content">ข้ามไปพื้นที่ทำงาน</a>
        <header className="shell-navbar">
          <div className="shell-navbar-left">
            <button
              type="button"
              className="shell-mobile-trigger"
              ref={menuTrigger}
              aria-label="เปิดเมนู"
              aria-controls="workspace-navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={20} />
            </button>
            <div className="shell-location">
              <span>{NAV_GROUPS.find(({ key }) => key === current.group)?.label}</span>
              {route === "pos" && <><ChevronRight size={14} aria-hidden="true" /><span>{current.label}</span></>}
            </div>
          </div>

          <div className="shell-navbar-right">
            {offline && (
              <span className="shell-status-pill is-offline" role="status">
                <ServerOff size={15} /> ออฟไลน์
              </span>
            )}
            {desktop && (
              <span className="shell-meta-pill" title="เครื่อง POS">
                <Monitor size={15} />
                <span>{profile.device.name}</span>
              </span>
            )}
            <span className="shell-meta-pill is-user" title="ผู้ใช้งาน">
              <UserRound size={15} />
              <span>{profile.user.name}</span>
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              aria-label="ล็อกเครื่อง"
              onClick={onLock}
              className="shell-navbar-action"
            >
              <LockKeyhole size={15} />
              <span>ล็อก</span>
            </Button>
          </div>
        </header>

        <main id="workspace-content" tabIndex={-1} className={`shell-content${route === "pos" ? " is-pos" : ""}`}>
          {route === "pos" ? (
            <h1 ref={heading} tabIndex={-1} className="sr-only">{current.label}</h1>
          ) : (
            <div className="workspace-heading" key={route} data-enter>
              <span className="workspace-symbol"><PageIcon size={24} aria-hidden="true" /></span>
              <div>
                <h1 ref={heading} tabIndex={-1}>{current.label}</h1>
                {route === "home" ? <p>{profile.store.name}</p> : <p>{routeDescriptions[route]}</p>}
              </div>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

function ChangePasswordModal({ close, saved }: { close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = changePasswordSchema.safeParse({
      currentPassword: form.get("currentPassword"),
      newPassword: form.get("newPassword"),
    });
    if (!parsed.success) {
      setError("รหัสผ่านใหม่ต้องมีอย่างน้อย 12 อักขระ และต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await business("change_password", { input: parsed.data });
      saved();
    } catch (reason) {
      void notifyError("เปลี่ยนรหัสผ่านไม่สำเร็จ", errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="เปลี่ยนรหัสผ่าน" size="sm" close={close} busy={busy && "กำลังบันทึกรหัสผ่านใหม่"}>
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <Field label="รหัสผ่านปัจจุบัน" name="currentPassword" type="password" required maxLength={128} autoComplete="current-password" autoFocus />
        <Field label="รหัสผ่านใหม่" name="newPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" hint="อย่างน้อย 12 อักขระ หลังเปลี่ยนต้องเข้าสู่ระบบใหม่" />
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>ยกเลิก</Button>
          <Button type="submit" disabled={busy}>บันทึกรหัสผ่านใหม่</Button>
        </div>
      </form>
    </Modal>
  );
}
