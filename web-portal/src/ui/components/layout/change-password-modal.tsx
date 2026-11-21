import { useState, type FormEvent } from "react";
import { changePasswordSchema } from "@thepos/contracts";
import { Field } from "@/components/common/fields";
import { Modal } from "@/components/common/modal";
import { Button } from "@/components/ui/button";
import { notifyError } from "@/lib/alerts";
import { business, errorMessage } from "@/lib/native";

export function ChangePasswordModal({ close, saved }: { close: () => void; saved: () => void }) {
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
