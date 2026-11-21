import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loading } from "./loading";

type ModalSize = "sm" | "md" | "lg";

/**
 * Accessible modal dialog with automatic focus management on open
 * and focus restoration on close.
 */
export function Modal({
  title,
  close,
  size = "md",
  busy,
  variant = "standard",
  children,
}: {
  title: string;
  close: () => void;
  size?: ModalSize;
  busy?: boolean | string;
  variant?: "standard" | "register";
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pointerDownOnBackdrop = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!dialog.open) dialog.showModal();

    const frame = window.requestAnimationFrame(() => {
      const explicitTarget = dialog.querySelector<HTMLElement>("[data-autofocus], [autofocus]");
      const activeInside = dialog.contains(document.activeElement);
      const target = explicitTarget ?? (activeInside
        ? (document.activeElement as HTMLElement)
        : dialog.querySelector<HTMLElement>(
          "input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled])",
        ));
      if (target) {
        if (document.activeElement !== target) target.focus();
        if (target instanceof HTMLInputElement && target.type !== "date" && target.type !== "checkbox" && target.type !== "radio") {
          target.select();
        }
      } else {
        dialog.focus();
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      className={variant === "register" ? "register-dialog" : `thepos-modal thepos-modal-${size}`}
      aria-label={title}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        if (!busy) close();
      }}
      onPointerDown={(event) => {
        pointerDownOnBackdrop.current = event.target === dialogRef.current;
      }}
      onClick={(event) => {
        if (busy || event.detail === 0 || !pointerDownOnBackdrop.current || event.target !== dialogRef.current) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      }}
    >
      <div className={variant === "register" ? "register-dialog-heading" : "thepos-modal-header"}>
        <h2>{title}</h2>
        <Button type="button" variant="ghost" aria-label="ปิดหน้าต่าง" disabled={!!busy} onClick={close}>
          <X />
        </Button>
      </div>
      {busy && <Loading label={typeof busy === "string" ? busy : "กำลังดำเนินการ"} />}
      <div className="thepos-modal-body" inert={!!busy} aria-busy={!!busy}>{children}</div>
    </dialog>
  );
}
