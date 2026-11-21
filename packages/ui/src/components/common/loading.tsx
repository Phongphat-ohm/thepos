import { LoaderCircle } from "lucide-react";

export function Loading({ label = "กำลังโหลดข้อมูล", variant = "panel" }: {
  label?: string;
  variant?: "panel" | "inline" | "skeleton";
}) {
  return <div className={`ui-loading ui-loading-${variant}`} role="status" aria-live="polite">
    <div className="ui-loading-caption"><LoaderCircle className="ui-spinner" size={18} aria-hidden="true" /> <span>{label}</span></div>
    {variant === "skeleton" ? <div className="ui-skeleton" aria-hidden="true">
      {[0, 1, 2].map((row) => <div className="ui-skeleton-row" key={row}><span /><span /><span /></div>)}
    </div> : variant === "panel" && <div className="ui-loading-track" aria-hidden="true"><span /></div>}
  </div>;
}
