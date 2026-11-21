import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import type { Profile } from "@thepos/contracts";
import { Loading } from "@/components/common/loading";
import { AppShell, canOpenRoute, type AppRoute } from "@/components/layout/app-shell";
import type { CatalogView, InventoryView, StockCountRouteView } from "@/components/layout/navigation";
import { AccessScreen } from "@/features/auth/access-screen";
import type { AccessScreenMode } from "@/features/auth/access-panel";
import type { AdminCredentials } from "@/features/auth/admin-gate-modal";
import { hasReports } from "@/features/reports/options";
import type { SettingsView } from "@/features/settings/workspace";
import { confirmAction, dismissAlerts, notifyError, notifySuccess } from "@/lib/alerts";
import { watchIdle } from "@/lib/idle-lock";
import { errorCode, errorMessage, isDesktopApp, native, type Connection } from "@/lib/native";

const HomePage = lazy(() => import("@/features/dashboard/home-page").then((m) => ({ default: m.HomePage })));

const MembersWorkspace = lazy(() => import("@/features/members/workspace").then((m) => ({ default: m.MembersWorkspace })));
const DividendWorkspace = lazy(() => import("@/features/dividends/workspace").then((m) => ({ default: m.DividendWorkspace })));
const ShiftsWorkspace = lazy(() => import("@/features/shifts/workspace").then((m) => ({ default: m.ShiftsWorkspace })));
const ReportsWorkspace = lazy(() => import("@/features/reports/workspace").then((m) => ({ default: m.ReportsWorkspace })));
const SalesHistoryPage = lazy(() => import("@/features/pos/history-page").then((m) => ({ default: m.SalesHistoryPage })));
const Register = lazy(() => import("@/features/pos/workspace").then((m) => ({ default: m.Register })));
const CatalogWorkspace = lazy(() => import("@/features/catalog/workspace").then((m) => ({ default: m.CatalogWorkspace })));
const InventoryWorkspace = lazy(() => import("@/features/inventory/workspace").then((m) => ({ default: m.InventoryWorkspace })));
const StockCountsWorkspace = lazy(() => import("@/features/stock-counts/workspace").then((m) => ({ default: m.StockCountsWorkspace })));
const SettingsWorkspace = lazy(() => import("@/features/settings/workspace").then((m) => ({ default: m.SettingsWorkspace })));

type Screen = AccessScreenMode | "home";
const initial: Connection = { url: null, setup: null, lockedUser: null };

function viewFromPrefix<T extends string>(route: AppRoute, prefix: string): T | null {
  return route.startsWith(prefix) ? (route.slice(prefix.length) as T) : null;
}

export function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [route, setRoute] = useState<AppRoute>("home");
  const [connection, setConnection] = useState(initial);
  const [profile, setProfile] = useState<Profile>();
  const [lockedUser, setLockedUser] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [offline, setOffline] = useState(false);
  const [pendingAdmin, setPendingAdmin] = useState<AdminCredentials | null>(null);
  const pending = useRef(false);

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
      if (failureTitle) void notifyError(failureTitle, text);
      else setMessage(text);
      onError?.(error);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, []);

  const startup = useCallback(
    () =>
      run(
        async () => {
          setScreen("loading");
          useConnection(await native.startup());
        },
        () => setScreen("offline"),
      ),
    [run, useConnection],
  );

  useEffect(() => {
    void startup();
  }, [startup]);

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
    void native
      .logout()
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
          setProfile((current) => (current && JSON.stringify(current) === JSON.stringify(value) ? current : value));
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
    const timer = window.setInterval(() => {
      if (!document.hidden) void probe();
    }, 30_000);
    const onVisibility = () => {
      if (!document.hidden) void probe();
    };
    window.addEventListener("online", probe);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("online", probe);
      document.removeEventListener("visibilitychange", onVisibility);
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

  const switchTerminal = useCallback(async (target: "connect" | "register", credentials: AdminCredentials | null) => {
    dismissAlerts();
    setBusy(true);
    try {
      await native.logout();
      setProfile(undefined);
      setLockedUser(undefined);
      setPendingAdmin(credentials);
      setMessage("");
      setScreen(target);
    } catch (error) {
      void notifyError("สลับการตั้งค่าเครื่องไม่สำเร็จ", errorMessage(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, []);

  const resetConnection = useCallback(async () => {
    dismissAlerts();
    setBusy(true);
    try {
      const clean = await native.resetConnection();
      setProfile(undefined);
      setLockedUser(undefined);
      setPendingAdmin(null);
      setOffline(false);
      setMessage("");
      setConnection(clean);
      setScreen("connect");
      notifySuccess("ล้างการตั้งค่าทั้งหมดแล้ว", "สามารถกรอกที่อยู่เซิร์ฟเวอร์และตั้งค่าใหม่ได้ทันที");
    } catch (error) {
      void notifyError("ล้างการตั้งค่าไม่สำเร็จ", errorMessage(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, []);

  const catalogView = viewFromPrefix<CatalogView>(route, "catalog:");
  const inventoryView = viewFromPrefix<InventoryView>(route, "inventory:");
  const stockCountView = viewFromPrefix<StockCountRouteView>(route, "stock-counts:");
  const settingsView = viewFromPrefix<SettingsView>(route, "settings:");
  const desktop = isDesktopApp() && !profile?.device.isWebDevice;
  const can = (permission: NonNullable<Profile["capabilities"]>[number]) =>
    profile?.capabilities?.includes(permission) ?? false;

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
            <Register
              profile={profile}
              exit={() => setRoute("home")}
              onOpenHistory={() => setRoute("history")}
              onOpenShifts={can("shift:operate") || can("shift:review") ? () => setRoute("shifts") : undefined}
            />
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
          ) : catalogView && canOpenRoute(route, profile) ? (
            <CatalogWorkspace key={catalogView} profile={profile} view={catalogView} />
          ) : inventoryView && canOpenRoute(route, profile) ? (
            <InventoryWorkspace key={inventoryView} profile={profile} view={inventoryView} />
          ) : stockCountView && canOpenRoute(route, profile) ? (
            <StockCountsWorkspace
              key={stockCountView}
              profile={profile}
              view={stockCountView}
              serverUrl={connection.url ?? ""}
            />
          ) : settingsView && canOpenRoute(route, profile) ? (
            <SettingsWorkspace
              key={settingsView}
              view={settingsView}
              userId={profile.user.id}
              deviceId={profile.device.id}
              serverUrl={connection.url}
              onSwitchTerminal={desktop ? switchTerminal : undefined}
              onRename={(name) => {
                setProfile((current) => current && { ...current, store: { ...current.store, name } });
              }}
            />
          ) : (
            <HomePage
              profile={profile}
              desktop={desktop}
              serverUrl={connection.url}
              offline={offline}
              onNavigate={setRoute}
            />
          )}
        </Suspense>
      </AppShell>
    );
  }

  return (
    <AccessScreen
      screen={screen === "home" ? "loading" : screen}
      connection={connection}
      lockedUser={lockedUser}
      busy={busy}
      desktop={desktop}
      message={message}
      pending={pending}
      initialVerifiedAdmin={pendingAdmin}
      onConsumeInitialAdmin={() => setPendingAdmin(null)}
      setMessage={setMessage}
      setScreen={setScreen}
      useConnection={useConnection}
      run={run}
      startup={startup}
      onAuthenticated={home}
      onLogout={performLogout}
      onResetConnection={!desktop ? resetConnection : undefined}
    />
  );
}
