import { useEffect, useRef, useState, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import { storeSettingsInput, type StoreSettings, type StoreSettingsInput } from "@thepos/contracts";
import { Field } from "@/components/common/fields";
import { Loading } from "@/components/common/loading";
import { Modal } from "@/components/common/modal";
import { Button } from "@/components/ui/button";
import { notifyError, notifySuccess } from "@/lib/alerts";
import { business, errorMessage } from "@/lib/native";

export function StoreSettingsSection({ onRename }: { onRename: (name: string) => void }) {
  const [store, setStore] = useState<StoreSettings>();
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setStore(await business<StoreSettings>("store_settings"));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save(input: StoreSettingsInput) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      const updated = await business<StoreSettings>("update_store_settings", { input });
      setStore(updated);
      onRename(updated.name);
      setEditing(false);
      notifySuccess("บันทึกการตั้งค่าร้านแล้ว");
    } catch (reason) {
      void notifyError("บันทึกการตั้งค่าไม่สำเร็จ", errorMessage(reason));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="stock-content">
      <div className="stock-section-title">
        <h2>ข้อมูลร้านและใบเสร็จ</h2>
        <Button disabled={!store || loading} onClick={() => setEditing(true)}>
          <Pencil /> แก้ไขข้อมูลร้าน
        </Button>
      </div>
      {loading && <Loading label="กำลังโหลดการตั้งค่าร้าน" variant="skeleton" />}
      {error && (
        <div className="register-inline">
          <p role="alert" className="form-error">{error}</p>
          <Button variant="outline" onClick={() => void load()}>ลองโหลดอีกครั้ง</Button>
        </div>
      )}
      {store && (
        <dl className="member-facts">
          <div><dt>ชื่อร้าน</dt><dd>{store.name}</dd></div>
          <div><dt>ที่อยู่</dt><dd>{store.address ?? "—"}</dd></div>
          <div><dt>เลขประจำตัวผู้เสียภาษี</dt><dd>{store.taxId ?? "—"}</dd></div>
          <div><dt>ภาษีมูลค่าเพิ่ม</dt><dd>{store.vatActive ? "เปิดใช้งาน" : "ปิดใช้งาน"}{store.vatRate && ` · อัตราที่บันทึก ${store.vatRate}%`}</dd></div>
          <div><dt>ข้อความหัวใบเสร็จ</dt><dd>{store.receiptHeader ?? "—"}</dd></div>
          <div><dt>ข้อความท้ายใบเสร็จ</dt><dd>{store.receiptFooter ?? "—"}</dd></div>
        </dl>
      )}
      {store?.receiptLogo && (
        <div className="register-inline">
          <span className="label">โลโก้ใบเสร็จ</span>
          <img className="receipt-logo" src={store.receiptLogo} alt="โลโก้ร้าน" />
        </div>
      )}
      {editing && store && <StoreEditor store={store} saving={saving} save={save} close={() => setEditing(false)} />}
    </div>
  );
}

function StoreEditor({
  store,
  saving,
  save,
  close,
}: {
  store: StoreSettings;
  saving: boolean;
  save: (input: StoreSettingsInput) => Promise<void>;
  close: () => void;
}) {
  const [logo, setLogo] = useState(store.receiptLogo);
  const [upload, setUpload] = useState(false);
  const [error, setError] = useState("");

  async function chooseLogo(file: File) {
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 3 * 1024 * 1024) {
      setError("เลือกโลโก้ JPG หรือ PNG ขนาดไม่เกิน 3 MB");
      return;
    }
    setUpload(true);
    setError("");
    try {
      const image = await createImageBitmap(file);
      try {
        const scale = Math.min(1, 160 / image.width, 80 / image.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pngData = canvas.toDataURL("image/png");
        setLogo(pngData.length <= 48_000 ? pngData : canvas.toDataURL("image/jpeg", 0.85));
      } finally {
        image.close();
      }
    } catch {
      setError("เปิดไฟล์โลโก้ไม่ได้ กรุณาเลือกไฟล์ใหม่");
    } finally {
      setUpload(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || upload) return;
    const form = new FormData(event.currentTarget);
    const input = Object.fromEntries(form);
    const parsed = storeSettingsInput.safeParse({
      ...input,
      taxId: String(input.taxId ?? "").trim() || null,
      vatRate: String(input.vatRate ?? "").trim() || null,
      receiptLogo: logo,
    });
    if (!parsed.success) {
      setError("ตรวจสอบชื่อร้าน เลขประจำตัวผู้เสียภาษี 13 หลัก และอัตรา VAT 0–100% ก่อนบันทึก");
      return;
    }
    setError("");
    void save(parsed.data);
  }

  return (
    <Modal title="แก้ไขข้อมูลร้านและใบเสร็จ" size="lg" close={close} busy={saving ? "กำลังบันทึกการตั้งค่า" : upload && "กำลังเตรียมโลโก้"}>
      <form className="form-stack" onSubmit={submit}>
        <Field label="ชื่อร้าน" name="name" maxLength={120} defaultValue={store.name} autoFocus required />
        <Field label="ที่อยู่ร้าน" name="address" maxLength={400} defaultValue={store.address ?? ""} />
        <div className="field-row">
          <Field label="เลขประจำตัวผู้เสียภาษี" name="taxId" inputMode="numeric" maxLength={13} defaultValue={store.taxId ?? ""} />
          <Field
            label="อัตรา VAT (%)"
            name="vatRate"
            inputMode="decimal"
            maxLength={6}
            defaultValue={store.vatRate ?? ""}
            hint="เก็บค่าไว้สำหรับเปิดใช้ในอนาคต ขณะนี้ระบบยังไม่คิด VAT"
          />
        </div>
        <label className="field">
          <span className="label">หัวใบเสร็จ</span>
          <textarea className="input" name="receiptHeader" rows={2} maxLength={300} defaultValue={store.receiptHeader ?? ""} />
        </label>
        <label className="field">
          <span className="label">ท้ายใบเสร็จ</span>
          <textarea className="input" name="receiptFooter" rows={2} maxLength={300} defaultValue={store.receiptFooter ?? ""} />
        </label>
        <Field
          label="โลโก้ใบเสร็จ"
          type="file"
          accept="image/png,image/jpeg"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void chooseLogo(file);
            event.target.value = "";
          }}
        />
        {logo && (
          <div className="register-inline">
            <img className="receipt-logo" src={logo} alt="โลโก้ร้าน" />
            <Button type="button" variant="ghost" onClick={() => setLogo(null)}>นำโลโก้ออก</Button>
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <Button type="button" variant="ghost" onClick={close}>ยกเลิก</Button>
          <Button type="submit">บันทึกข้อมูลร้าน</Button>
        </div>
      </form>
    </Modal>
  );
}
