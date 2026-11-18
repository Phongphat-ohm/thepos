import { AlertCircle, ArrowLeft, ArrowRight, Monitor, Plus, RefreshCw, Server } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { bootstrapSchema, enrollSchema, type EnrollableDevice } from "@thepos/contracts";
import { Field, Password, Pin, Username, readFields } from "@/components/fields";
import { Button } from "@/components/ui/button";
import { errorMessage, isDesktopApp, native } from "@/lib/native";
import { Select } from "./stock/shared";

export function ConnectForm({
  url, busy, hasExisting, onConnect, onBack, onInvalidInput,
}: {
  url: string; busy: boolean; hasExisting: boolean;
  onConnect: (url: string, serverKey: string) => void; onBack: () => void; onInvalidInput: (message: string) => void;
}) {
  const placeholder = isDesktopApp()
    ? "https://pos.example.com หรือ http://192.168.1.10:3000"
    : "https://pos.example.com หรือ http://127.0.0.1:3000";
  return (
    <form className="form-stack" noValidate onSubmit={(event) => {
      const input = readFields(event, onInvalidInput);
      if (input) onConnect(String(input.url), String(input.serverKey));
    }}>
      <Field label="ที่อยู่เซิร์ฟเวอร์" type="url" name="url" required autoFocus={!url} spellCheck={false}
        defaultValue={url} placeholder={placeholder} autoComplete="url" />
      <Field label="รหัสเชื่อมต่อเซิร์ฟเวอร์" name="serverKey" type="password" required autoFocus={!!url}
        autoComplete="off" placeholder="ดูรหัสเชื่อมต่อได้จากหน้าเว็บผู้ดูแลเซิร์ฟเวอร์ (/server-admin)" />
      <div className="form-actions">
        {hasExisting && <Button type="button" variant="ghost" onClick={onBack} disabled={busy}><ArrowLeft /> กลับ</Button>}
        <Button className="primary-action" loading={busy && "กำลังตรวจการเชื่อมต่อ"}><Server />ตรวจการเชื่อมต่อ</Button>
      </div>
    </form>
  );
}

export function RegisterForm({
  initialized, registered, busy, onBootstrap, onEnroll, onBack, onSwitchServer, onInvalidInput,
}: {
  initialized: boolean;
  registered?: boolean;
  busy: boolean;
  onBootstrap: (input: ReturnType<typeof bootstrapSchema.parse>) => void;
  onEnroll: (input: ReturnType<typeof enrollSchema.parse>) => void;
  onBack: () => void;
  onSwitchServer?: () => void;
  onInvalidInput: (message?: string) => void;
}) {
  const [devices, setDevices] = useState<EnrollableDevice[]>([]);
  const [devicesError, setDevicesError] = useState("");
  const [mode, setMode] = useState<"bind" | "create">("create");
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [loadingDevices, setLoadingDevices] = useState(false);

  const loadDevices = useCallback(async (switchMode = false) => {
    if (!initialized) return;
    setLoadingDevices(true);
    setDevicesError("");
    try {
      const items = await native.setupDevices();
      setDevices(items);
      const firstAvailable = items.find((item) => item.hasPin && !item.inUse);
      setSelectedDeviceId((current) => {
        const stillAvailable = items.find((item) => item.id === current && item.hasPin && !item.inUse);
        return stillAvailable?.id ?? firstAvailable?.id ?? "";
      });
      if (switchMode && items.some((item) => item.hasPin)) setMode("bind");
    } catch (reason) {
      setDevicesError(errorMessage(reason));
    } finally {
      setLoadingDevices(false);
    }
  }, [initialized]);

  useEffect(() => {
    void loadDevices(true);
  }, [loadDevices]);

  const bindableDevices = devices.filter((item) => item.hasPin);
  const availableDevices = bindableDevices.filter((item) => !item.inUse);

  function submit(event: FormEvent<HTMLFormElement>) {
    const input = readFields(event, onInvalidInput);
    if (!input) return;
    try {
      if (initialized) {
        if (mode === "bind" && bindableDevices.length > 0) {
          if (!selectedDeviceId || !availableDevices.some(({ id }) => id === selectedDeviceId)) {
            onInvalidInput("เครื่อง POS ที่เลือกกำลังมีผู้ใช้งานอยู่ กรุณาเลือกเครื่องที่ว่าง");
            return;
          }
          onEnroll(enrollSchema.parse({ deviceId: selectedDeviceId, pin: input.pin }));
        } else {
          onEnroll(enrollSchema.parse({
            username: input.username,
            password: input.password,
            deviceName: input.deviceName,
            ...(input.devicePin ? { devicePin: input.devicePin } : {}),
          }));
        }
      } else {
        onBootstrap(bootstrapSchema.parse({
          ...input,
          storeAddress: input.storeAddress || undefined,
          taxId: input.taxId || undefined,
          devicePin: input.devicePin || undefined,
        }));
      }
    } catch {
      onInvalidInput();
    }
  }

  return (
    <form className="form-stack" noValidate onSubmit={submit}>
      {devicesError && <p className="notice" role="alert"><AlertCircle size={16} /> โหลดรายชื่อเครื่อง POS ไม่สำเร็จ · {devicesError}</p>}
      {initialized && bindableDevices.length > 0 && (
        <div className="register-inline" role="tablist" aria-label="วิธีเชื่อมต่อเครื่อง POS">
          <Button
            type="button"
            variant={mode === "bind" ? "default" : "outline"}
            disabled={busy}
            onClick={() => { onInvalidInput(""); setMode("bind"); }}
          >
            <Monitor size={16} /> เลือกเครื่อง POS เดิม
          </Button>
          <Button
            type="button"
            variant={mode === "create" ? "default" : "outline"}
            disabled={busy}
            onClick={() => { onInvalidInput(""); setMode("create"); }}
          >
            <Plus size={16} /> ลงทะเบียนเครื่องใหม่
          </Button>
          {mode === "bind" && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy || loadingDevices}
              onClick={() => void loadDevices(false)}
            >
              <RefreshCw size={15} /> รีเฟรชสถานะเครื่อง
            </Button>
          )}
        </div>
      )}

      {!initialized && (
        <fieldset className="form-group">
          <legend>ข้อมูลร้านค้า</legend>
          <Field label="ชื่อร้านค้า" name="storeName" required maxLength={120} autoFocus />
          <div className="field-row">
            <Field label="ที่อยู่ร้านค้า (ถ้ามี)" name="storeAddress" maxLength={400} />
            <Field label="เลขประจำตัวผู้เสียภาษี (ถ้ามี)" name="taxId" inputMode="numeric"
              pattern="[0-9]{13}" maxLength={13} />
          </div>
        </fieldset>
      )}

      {initialized && mode === "bind" && bindableDevices.length > 0 ? (
        <fieldset className="form-group">
          <legend>เชื่อมต่อเครื่อง POS ที่มีอยู่แล้ว</legend>
          <Select
            label="เลือกเครื่อง POS"
            name="deviceId"
            value={selectedDeviceId}
            onChange={(event) => setSelectedDeviceId(event.target.value)}
            disabled={busy || availableDevices.length === 0}
          >
            {availableDevices.length === 0 && <option value="">ไม่มีเครื่อง POS ว่างให้เลือก</option>}
            {bindableDevices.map((device) => (
              <option key={device.id} value={device.id} disabled={device.inUse}>
                {device.inUse
                  ? `${device.name} (กำลังใช้งานโดย ${device.activeUser ?? "ผู้อื่น"} · ห้ามเลือกซ้ำ)`
                  : `${device.name} (ว่าง · พร้อมใช้งาน)`}
              </option>
            ))}
          </Select>
          {availableDevices.length === 0 ? (
            <p className="notice" role="status">
              เครื่อง POS ที่มีรหัสทั้งหมดกำลังถูกใช้งานอยู่ ไม่สามารถเลือกเครื่องซ้ำได้ กรุณาออกจากระบบที่เครื่องเดิม ให้ผู้ดูแลตัดเซสชัน หรือกด &ldquo;ลงทะเบียนเครื่องใหม่&rdquo;
            </p>
          ) : (
            <Pin autoFocus disabled={busy} label="รหัสเครื่อง 6 หลัก" hint="กรอกรหัสประจำเครื่อง POS 6 หลักเพื่อเข้าใช้งานเครื่องเดิม" />
          )}
        </fieldset>
      ) : (
        <>
          <fieldset className="form-group">
            <legend>{initialized ? "บัญชีผู้ดูแลระบบ" : "บัญชีผู้ดูแลระบบคนแรก"}</legend>
            {!initialized && <Field label="ชื่อที่แสดง" name="displayName" required maxLength={120} />}
            <div className="field-row"><Username autoFocus={initialized} /><Password isNew={!initialized} /></div>
            {!initialized && <Pin hint="ใช้ตัวเลข 6 หลักสำหรับปลดล็อกหน้าจอผู้ดูแล" />}
          </fieldset>
          <fieldset className="form-group">
            <legend>เครื่อง POS</legend>
            <Field label="ชื่อเครื่อง" name="deviceName" required maxLength={120} placeholder="เช่น จุดขาย 1" />
            <Pin name="devicePin" required={false} label="รหัสเครื่อง 6 หลัก (ถ้ามี)" hint="ตั้งรหัส 6 หลักประจำเครื่องนี้สำหรับเลือกเข้าใช้งานในครั้งถัดไป" />
            {!initialized && (
              <Field label="รหัสตั้งค่าระบบ" type="password" name="secret" required minLength={32} maxLength={256}
                autoComplete="off" hint="ใช้รหัสที่ได้รับจากผู้ดูแลเซิร์ฟเวอร์" />
            )}
          </fieldset>
        </>
      )}

      <div className="form-actions">
        <div className="register-inline">
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
            <ArrowLeft /> {registered ? "กลับไปเข้าสู่ระบบ" : "เปลี่ยนเซิร์ฟเวอร์"}
          </Button>
          {registered && onSwitchServer && (
            <Button type="button" variant="ghost" onClick={onSwitchServer} disabled={busy}>
              เปลี่ยนเซิร์ฟเวอร์
            </Button>
          )}
        </div>
        <Button
          className="primary-action"
          disabled={initialized && mode === "bind" && bindableDevices.length > 0 && availableDevices.length === 0}
          loading={busy && "กำลังบันทึกการตั้งค่า"}
        >
          {initialized ? <Monitor /> : <ArrowRight />}
          {initialized ? (mode === "bind" && bindableDevices.length > 0 ? "เชื่อมต่อเครื่อง POS" : "ลงทะเบียนเครื่องใหม่") : "ตั้งค่าร้านและเครื่อง"}
        </Button>
      </div>
    </form>
  );
}
