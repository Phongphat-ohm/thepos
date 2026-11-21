import { useCallback, useRef, useState } from "react";
import type { Profile } from "@thepos/contracts";
import { Loading } from "@/components/common/loading";
import type { Run } from "@/components/data-table/table";
import type { InventoryView } from "@/components/layout/navigation";
import { notifyError, notifySuccess } from "@/lib/alerts";
import { errorMessage } from "@/lib/native";
import { Receive } from "./receive";
import { StockLots } from "./stock-lots";
import { StockMovements } from "./stock-movements";

export function InventoryWorkspace({ profile, view }: { profile: Profile; view: InventoryView }) {
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
    <section className="stock-workspace" aria-label="คลังสินค้า" aria-busy={busy}>
      {busy && view === "receive" && <Loading label="กำลังดำเนินการในระบบคลัง" />}
      <div className="stock-content">
        {view === "receive" && can("inventory:receive") && (
          <Receive run={run} report={report} warn={warn} busy={busy} />
        )}
        {view === "lots" && <StockLots count={false} busy={busy} run={run} report={report} warn={warn} />}
        {view === "movements" && <StockMovements busy={busy} run={run} />}
      </div>
    </section>
  );
}
