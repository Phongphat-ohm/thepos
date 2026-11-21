import type { AdminCredentials } from "@/features/auth/admin-gate-modal";
import { AuditLogsSection } from "./audit-logs";
import { DevicesSettingsSection } from "./devices-settings";
import { HardwareSettingsSection } from "./hardware-settings";
import { StaffSettingsSection } from "./staff-settings";
import { StoreSettingsSection } from "./store-settings";

export type SettingsView = "store" | "hardware" | "staff" | "devices" | "audit";

export function SettingsWorkspace({
  view,
  userId,
  deviceId,
  serverUrl,
  onSwitchTerminal,
  onRename,
}: {
  view: SettingsView;
  userId?: string;
  deviceId: string;
  serverUrl?: string | null;
  onSwitchTerminal?: (target: "connect" | "register", credentials: AdminCredentials | null) => Promise<void>;
  onRename: (name: string) => void;
}) {
  return (
    <section className="stock-workspace" aria-label="การตั้งค่า">
      {view === "store" && <StoreSettingsSection onRename={onRename} />}
      {view === "hardware" && <HardwareSettingsSection deviceId={deviceId} />}
      {view === "staff" && <StaffSettingsSection userId={userId} />}
      {view === "devices" && (
        <DevicesSettingsSection
          deviceId={deviceId}
          serverUrl={serverUrl}
          onSwitchTerminal={onSwitchTerminal}
        />
      )}
      {view === "audit" && <AuditLogsSection />}
    </section>
  );
}
