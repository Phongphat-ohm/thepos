import { useState } from "react";
import { Printer } from "lucide-react";
import type { Profile } from "@thepos/contracts";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { notifySuccess } from "@/lib/alerts";
import { PrinterDialog } from "./dialogs";
import { SalesHistory } from "./history";
import { readStored } from "./model";
import { defaultPrintSettings } from "./printing";

export function SalesHistoryPage({ profile }: { profile: Profile }) {
  const canReturn = profile.capabilities?.includes("sales:return") ?? false;
  const storage = `thepos/register/${profile.store.id}/${profile.device.id}/${profile.user.id}`;
  const printerKey = `thepos/printer/${profile.device.id}`;
  const [settings, setSettings] = useState(() => readStored(printerKey, defaultPrintSettings));
  const [printerOpen, setPrinterOpen] = useState(false);

  return (
    <section className="stock-workspace" aria-label="ประวัติการขาย">
      <div className="stock-content">
        <div className="stock-section-title">
          <h2>ประวัติการขายและรับคืนสินค้า</h2>
          <Button type="button" variant="outline" onClick={() => setPrinterOpen(true)}>
            <Printer size={15} /> ตั้งค่าเครื่องพิมพ์
          </Button>
        </div>

        <SalesHistory
          canReturn={canReturn}
          drawer={profile.capabilities?.includes("shift:operate")}
          storage={storage}
          settings={settings}
          configure={() => setPrinterOpen(true)}
        />
      </div>

      {printerOpen && (
        <Modal title="ตั้งค่าเครื่องพิมพ์ใบเสร็จ" size="md" close={() => setPrinterOpen(false)}>
          <PrinterDialog
            value={settings}
            save={(value) => {
              localStorage.setItem(printerKey, JSON.stringify(value));
              setSettings(value);
              setPrinterOpen(false);
              notifySuccess("บันทึกการตั้งค่าเครื่องพิมพ์แล้ว");
            }}
          />
        </Modal>
      )}
    </section>
  );
}
