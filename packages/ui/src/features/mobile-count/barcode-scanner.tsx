import { useEffect, useId, useRef, useState } from "react";
import { Camera, CameraOff } from "lucide-react";

function playBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 1046;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
    window.setTimeout(() => void ctx.close().catch(() => {}), 200);
  } catch {
    // Ignore audio errors on restricted mobile browsers
  }
}

export function BarcodeScanner({
  active,
  disabled,
  onScan,
  onClose,
}: {
  active: boolean;
  disabled?: boolean;
  onScan: (code: string) => void;
  onClose: () => void;
}) {
  const containerId = useId().replace(/:/g, "");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const cameraSupported =
    typeof window !== "undefined" &&
    window.isSecureContext &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    if (!active || disabled) return;
    if (!cameraSupported) {
      setError(
        "เบราว์เซอร์บล็อกการใช้กล้องเนื่องจากเชื่อมต่อผ่าน HTTP ธรรมดา กรุณาเข้าผ่าน HTTPS ในวง LAN หรือใช้ช่องพิมพ์ค้นหา/เครื่องสแกน Bluetooth ด้านล่างแทน",
      );
      return;
    }

    let cancelled = false;
    let scannerInstance: { stop: () => Promise<void>; clear: () => void } | null = null;
    setError(null);
    setStarting(true);

    void import("html5-qrcode")
      .then(async ({ Html5Qrcode, Html5QrcodeSupportedFormats }) => {
        if (cancelled) return;
        const scanner = new Html5Qrcode(containerId, {
          verbose: false,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.QR_CODE,
          ],
        });
        scannerInstance = scanner;
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 260, height: 140 },
            aspectRatio: 1.5,
          },
          (decodedText) => {
            const code = decodedText.trim();
            if (!code) return;
            const now = Date.now();
            if (lastScanRef.current.code === code && now - lastScanRef.current.at < 1500) {
              return;
            }
            lastScanRef.current = { code, at: now };
            playBeep();
            if (navigator.vibrate) navigator.vibrate(70);
            onScanRef.current(code);
          },
          () => {
            // Ignore per-frame decode misses
          },
        );
        if (!cancelled) setStarting(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setStarting(false);
          const msg = err instanceof Error ? err.message : String(err);
          setError(
            msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("notallowed")
              ? "ไม่ได้รับอนุญาตให้เปิดกล้อง กรุณากดอนุญาตการใช้กล้องในเบราว์เซอร์แล้วลองใหม่"
              : "เปิดกล้องไม่สำเร็จ กรุณาตรวจสอบว่าไม่มีแอปอื่นใช้งานกล้องอยู่ หรือใช้ช่องค้นหาด้านล่างแทน",
          );
        }
      });

    return () => {
      cancelled = true;
      if (scannerInstance) {
        void scannerInstance
          .stop()
          .catch(() => {})
          .finally(() => {
            try {
              scannerInstance?.clear();
            } catch {
              // ignore
            }
          });
      }
    };
  }, [active, disabled, cameraSupported, containerId]);

  if (!active) return null;

  return (
    <div className="mc-scanner-card">
      <div className="mc-scanner-head">
        <span><Camera size={16} /> กล้องสแกนบาร์โค้ด</span>
        <button type="button" className="mc-btn mc-btn-ghost mc-btn-sm" onClick={onClose}>
          <CameraOff size={15} /> ปิดกล้อง
        </button>
      </div>
      {error ? (
        <div className="mc-alert mc-alert-warn" role="alert">{error}</div>
      ) : (
        <>
          {starting && <p className="mc-muted" style={{ textAlign: "center", margin: "0.5rem 0" }}>กำลังเปิดกล้องหลัง...</p>}
          <div id={containerId} className="mc-scanner-viewport" />
          <p className="mc-muted" style={{ textAlign: "center", fontSize: "0.82rem", margin: "0.4rem 0 0" }}>
            หันกล้องให้บาร์โค้ดอยู่ในกรอบสี่เหลี่ยม
          </p>
        </>
      )}
    </div>
  );
}
