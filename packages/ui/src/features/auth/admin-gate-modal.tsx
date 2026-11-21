import { useState, type FormEvent } from "react";
import { ShieldAlert } from "lucide-react";
import { loginSchema } from "@thepos/contracts";
import { Password, Username, readFields } from "@/components/common/fields";
import { Modal } from "@/components/common/modal";
import { Button } from "@/components/ui/button";
import { errorCode, errorMessage, native } from "@/lib/native";

export type AdminCredentials = { username: string; password: string };

export function AdminGateModal({
  target,
  close,
  onVerified,
  onServerUnreachable,
}: {
  target: "connect" | "register";
  close: () => void;
  onVerified: (credentials: AdminCredentials) => void;
  onServerUnreachable?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const title = target === "connect" ? "ยืนยันสิทธิ์ผู้ดูแลระบบ · เปลี่ยนเซิร์ฟเวอร์" : "ยืนยันสิทธิ์ผู้ดูแลระบบ · เปลี่ยนเครื่อง POS";

  async function submit(event: FormEvent<HTMLFormElement>) {
    const raw = readFields(event, setError);
    if (!raw) return;
    const parsed = loginSchema.safeParse(raw);
    if (!parsed.success) {
      setError(errorMessage("INVALID_INPUT"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await native.verifyAdmin(parsed.data);
      onVerified(parsed.data);
    } catch (reason) {
      const code = errorCode(reason);
      if (code === "FORBIDDEN") {
        setError("เฉพาะบัญชีผู้ดูแลระบบ (Admin) เท่านั้นที่มีสิทธิ์แก้ไขเซิร์ฟเวอร์หรือเครื่อง POS");
      } else if (
        target === "connect" &&
        (code === "NETWORK_ERROR" || code === "UNAVAILABLE" || code === "INVALID_SERVER_KEY" || !code)
      ) {
        onServerUnreachable?.();
      } else {
        setError(errorMessage(reason));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} size="sm" close={close} busy={busy && "กำลังตรวจสอบสิทธิ์ผู้ดูแลระบบ"}>
      <form className="form-stack" noValidate onSubmit={(event) => void submit(event)}>
        <p className="stock-help">
          <ShieldAlert size={15} style={{ display: "inline", verticalAlign: "-2px", marginRight: "0.35rem" }} />
          กรอกชื่อผู้ใช้และรหัสผ่านของผู้ดูแลระบบ (Admin) เพื่อยืนยันก่อน
          {target === "connect" ? "เปลี่ยนที่อยู่เซิร์ฟเวอร์" : "เปลี่ยนหรือลงทะเบียนเครื่อง POS"}
        </p>
        <Username autoFocus />
        <Password />
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>ยกเลิก</Button>
          <Button type="submit" disabled={busy}>ยืนยันผู้ดูแลระบบ</Button>
        </div>
      </form>
    </Modal>
  );
}
