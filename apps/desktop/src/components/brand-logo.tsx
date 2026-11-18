import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Store } from "lucide-react";
import { isDesktopApp } from "@/lib/native";

/**
 * Displays the external brand logo from the project root (`/brand-logo` in web
 * or via Tauri `brand_logo` command on desktop), refreshing on window focus
 * and falling back to the Store icon if no external logo file is available.
 */
export function BrandLogo({ size = 24 }: { size?: number }) {
  const desktop = isDesktopApp();
  const [src, setSrc] = useState<string | null>(() => (desktop ? null : "/brand-logo"));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    const load = () => {
      if (desktop) {
        void invoke<string | null>("brand_logo")
          .then((dataUrl) => {
            if (!active) return;
            setSrc(dataUrl);
            setFailed(!dataUrl);
          })
          .catch(() => {
            if (active) setFailed(true);
          });
      } else {
        setFailed(false);
        setSrc(`/brand-logo?t=${Date.now()}`);
      }
    };

    load();
    window.addEventListener("focus", load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
    };
  }, [desktop]);

  if (!src || failed) {
    return <Store size={size} aria-hidden="true" />;
  }

  return (
    <img
      className="brand-logo-img"
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      onError={() => setFailed(true)}
    />
  );
}
