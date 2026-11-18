import { useEffect, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";
import { notifyError, notifySuccess } from "@/lib/alerts";
import { errorMessage, native } from "@/lib/native";

export function WebAccessModal({ url, close }: { url: string; close: () => void }) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [qrError, setQrError] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let active = true;
    setQrError(false);
    void QRCode.toDataURL(url, {
      width: 240,
      margin: 2,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((dataUrl) => {
        if (active) {
          setQrDataUrl(dataUrl);
          setQrError(false);
        }
      })
      .catch(() => {
        if (active) {
          setQrDataUrl("");
          setQrError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [url]);

  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(url);
  const isPlainLanHttp = url.startsWith("http://") && !isLocalhost;

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      notifySuccess("คัดลอกลิงก์หน้าเว็บแล้ว");
    } catch {
      void notifyError("คัดลอกลิงก์ไม่สำเร็จ");
    }
  }

  async function openInBrowser() {
    if (opening) return;
    setOpening(true);
    try {
      await native.openWeb();
    } catch (reason) {
      void notifyError("เปิดหน้าเว็บไม่สำเร็จ", errorMessage(reason));
    } finally {
      setOpening(false);
    }
  }

  return (
    <Modal title="เข้าใช้งานระบบผ่านเว็บเบราว์เซอร์" size="sm" close={close}>
      <div className="form-stack">
        <p className="stock-help">
          สแกน QR Code ด้านล่างด้วยมือถือหรือแท็บเล็ต หรือกดเปิดหน้าเว็บในเบราว์เซอร์เพื่อใช้งานระบบหลังบ้านและรายงาน
        </p>

        <div className="web-qr-frame">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt={`QR Code สำหรับ ${url}`} width={220} height={220} />
          ) : qrError ? (
            <p className="form-error web-qr-error" role="alert">สร้าง QR Code ไม่สำเร็จ กรุณาใช้ปุ่มคัดลอกลิงก์ด้านล่างแทน</p>
          ) : (
            <div className="web-qr-placeholder" aria-label="กำลังสร้าง QR Code" />
          )}
          <code className="web-qr-url">{url}</code>
        </div>

        {isLocalhost && (
          <p className="notice" role="status">
            กำลังเชื่อมต่อผ่าน Localhost บนเครื่องนี้ หากต้องการเปิดจากอุปกรณ์อื่นในร้าน แนะนำให้เชื่อมต่อเซิร์ฟเวอร์ผ่าน HTTPS (เช่น Reverse Proxy / Caddy)
          </p>
        )}
        {isPlainLanHttp && (
          <p className="notice" role="status">
            ลิงก์นี้ใช้ HTTP ธรรมดา เบราว์เซอร์บนอุปกรณ์อื่นจะรองรับเฉพาะที่อยู่ HTTPS เพื่อความปลอดภัยของโทเคน
          </p>
        )}

        <div className="form-actions">
          <Button type="button" variant="outline" onClick={() => void copyUrl()}>
            <Copy size={16} /> คัดลอกลิงก์
          </Button>
          <Button type="button" className="primary-action" loading={opening && "กำลังเปิดเบราว์เซอร์"} onClick={() => void openInBrowser()}>
            <ExternalLink size={16} /> เปิดหน้าเว็บ
          </Button>
        </div>
      </div>
    </Modal>
  );
}
