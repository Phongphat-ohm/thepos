import { useCallback, useRef, useState } from "react";
import type { Profile } from "@thepos/contracts";
import type { Run } from "@/components/data-table/table";
import { StockLots } from "@/features/inventory/stock-lots";

export type StockCountView = "count-entry" | "mobile-count" | "counts";
import { MobileCountSessions } from "@/features/mobile-count/sessions-workspace";
import { notifyError, notifySuccess } from "@/lib/alerts";
import { errorMessage } from "@/lib/native";
import { StockCounts } from "./count-sheets";

export function StockCountsWorkspace({
  profile,
  view,
  serverUrl,
}: {
  profile: Profile;
  view: StockCountView;
  serverUrl: string;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);

  const run: Run = useCallback(async (action) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await action();
    } catch (reason) {
      void notifyError("ดำเนินการไม่สำเร็จ", errorMessage(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, []);

  const report = (message: string) => notifySuccess(message);
  const warn = (message: string) => void notifyError("ตรวจสอบข้อมูล", message);
  const can = (permission: NonNullable<Profile["capabilities"]>[number]) =>
    profile.capabilities?.includes(permission) ?? false;

  return (
    <section className="stock-workspace" aria-label="การตรวจนับสต็อก" aria-busy={busy}>
      <div className="stock-content">
        {view === "count-entry" && can("inventory:count") && (
          <StockLots count busy={busy} run={run} report={report} warn={warn} />
        )}
        {view === "mobile-count" && can("inventory:count") && (
          <MobileCountSessions serverUrl={serverUrl} busy={busy} run={run} report={report} warn={warn} />
        )}
        {view === "counts" && can("inventory:read") && (
          <StockCounts approve={can("inventory:approve")} busy={busy} run={run} report={report} />
        )}
      </div>
    </section>
  );
}
