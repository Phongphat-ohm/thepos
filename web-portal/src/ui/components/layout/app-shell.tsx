import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  KeyRound,
  LockKeyhole,
  LogOut,
  Menu,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  ServerOff,
  UserRound,
  X,
} from "lucide-react";
import type { Profile } from "@thepos/contracts";
import { BrandLogo } from "@/components/common/brand-logo";
import { Button } from "@/components/ui/button";
import { hasReports } from "@/features/reports/options";
import { notifySuccess } from "@/lib/alerts";
import { isDesktopApp } from "@/lib/native";
import { ChangePasswordModal } from "./change-password-modal";
import {
  NAV_GROUPS,
  NAV_ITEMS,
  SESSION_GROUP,
  routeDescriptions,
  type AppRoute,
  type Permission,
  type SidebarGroup,
} from "./navigation";

export { canOpenRoute, type AppRoute } from "./navigation";

function SidebarSection({
  group,
  open,
  active,
  onToggle,
  children,
}: {
  group: SidebarGroup;
  open: boolean;
  active?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const Icon = group.icon;
  const id = `shell-menu-${group.key}`;
  return (
    <div className="shell-nav-group">
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
    </div>
  );
}

export function AppShell({
  profile,
  route,
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
    setExpandedGroups((groups) => (groups[current.group] === undefined ? { ...groups, [current.group]: true } : groups));
  }, [current.group]);

  function toggleGroup(key: SidebarGroup["key"]) {
    if (railOnly) {
      setCollapsed(false);
      setExpandedGroups((groups) => ({ ...groups, [key]: true }));
      return;
    }
    setExpandedGroups((groups) => ({ ...groups, [key]: !groups[key] }));
  }

  const can = (permission?: Permission) => !permission || (profile.capabilities?.includes(permission) ?? false);

  const desktop = isDesktopApp() && !profile.device.isWebDevice;
  const items = NAV_ITEMS.filter(
    (item) =>
      can(item.permission) &&
      (item.route !== "pos" || desktop) &&
      (item.route !== "reports" || hasReports(profile)) &&
      (item.route !== "shifts" || can("shift:operate") || can("shift:review")),
  );

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
    const resized = () => {
      if (!compact.matches) setMobileOpen(false);
    };
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
      {mobileOpen && <div className="shell-backdrop" aria-hidden="true" onClick={closeMenu} />}

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
          <button type="button" className="shell-mobile-close" ref={menuClose} aria-label="ปิดเมนู" onClick={closeMenu}>
            <X size={18} />
          </button>
        </div>

        <nav className="shell-nav" aria-label="พื้นที่ทำงาน">
          {NAV_GROUPS.map((group) => {
            const links = items.filter((item) => item.group === group.key);
            if (!links.length) return null;
            return (
              <SidebarSection
                key={group.key}
                group={group}
                open={!railOnly && !!expandedGroups[group.key]}
                active={current.group === group.key}
                onToggle={() => toggleGroup(group.key)}
              >
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
              </SidebarSection>
            );
          })}
        </nav>

        <div className="shell-sidebar-footer">
          <SidebarSection
            group={SESSION_GROUP}
            open={!railOnly && !!expandedGroups.session}
            onToggle={() => toggleGroup(SESSION_GROUP.key)}
          >
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
              {route === "pos" && (
                <>
                  <ChevronRight size={14} aria-hidden="true" />
                  <span>{current.label}</span>
                </>
              )}
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
