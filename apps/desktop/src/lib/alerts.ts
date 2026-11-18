import Swal, { type SweetAlertOptions } from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";

function alertTarget() {
  // A native dialog sits above the document. Its alerts must be mounted in the same top layer.
  return document.activeElement?.closest<HTMLElement>("dialog:modal") ??
    [...document.querySelectorAll<HTMLDialogElement>("dialog:modal")].at(-1) ?? document.body;
}

let alertQueue: Promise<unknown> = Promise.resolve();
let alertGeneration = 0;

function blocking(options: SweetAlertOptions) {
  const generation = alertGeneration;
  const result = alertQueue.then(async () => {
    if (generation !== alertGeneration) return undefined;
    const opener = document.activeElement as HTMLElement | null;
    const layer = alertTarget() === document.body ? undefined : document.createElement("dialog");
    if (layer) {
      layer.className = "thepos-alert-layer";
      layer.setAttribute("aria-label", "การแจ้งเตือน");
      layer.addEventListener("cancel", (event) => event.preventDefault());
      document.body.append(layer);
      layer.showModal();
    }
    try {
      return await baseSwal.fire({
        ...options,
        target: layer ?? document.body,
        returnFocus: !layer,
        didDestroy: () => {
          layer?.remove();
          if (layer && opener?.isConnected) opener.focus({ preventScroll: true });
        },
      });
    } finally {
      layer?.remove();
    }
  });
  alertQueue = result.catch(() => undefined);
  return result;
}

const baseSwal = Swal.mixin({
  buttonsStyling: false,
  heightAuto: false,
  scrollbarPadding: false,
  keydownListenerCapture: true,
  customClass: {
    container: "thepos-swal-container",
    popup: "thepos-swal-popup",
    title: "thepos-swal-title",
    htmlContainer: "thepos-swal-text",
    confirmButton: "button button-primary thepos-swal-confirm",
    cancelButton: "button button-outline thepos-swal-cancel",
    denyButton: "button button-outline",
  },
});

const toastSwal = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 2800,
  timerProgressBar: true,
  customClass: {
    container: "thepos-swal-container",
    popup: "thepos-swal-toast",
    title: "thepos-swal-toast-title",
    htmlContainer: "thepos-swal-toast-text",
  },
  didOpen: (toast) => {
    toast.onmouseenter = Swal.stopTimer;
    toast.onmouseleave = Swal.resumeTimer;
  },
});

/** Show a non-blocking success toast notification. */
export function notifySuccess(title: string, text?: string): void {
  toast("success", title, text);
}

/** Show a non-blocking informational toast notification. */
export function notifyInfo(title: string, text?: string): void {
  toast("info", title, text);
}

function toast(icon: "success" | "info", title: string, text?: string) {
  // Let React finish closing a submitted form before choosing where the toast belongs.
  const generation = alertGeneration;
  requestAnimationFrame(() => { void alertQueue.then(() => {
    if (generation === alertGeneration) return toastSwal.fire({ icon, titleText: title, text, target: alertTarget() });
  }); });
}

export function dismissAlerts() {
  alertGeneration++;
  Swal.close();
}

/** Show a centered error modal with custom theme. */
export function notifyError(title: string, text?: string): Promise<unknown> {
  return blocking({
    icon: "error",
    titleText: title,
    text,
    confirmButtonText: "ตกลง",
  });
}

/** Show a confirmation modal and resolve true if confirmed. */
export async function confirmAction({
  title,
  text,
  confirmText = "ยืนยัน",
  cancelText = "ยกเลิก",
  danger = false,
}: {
  title: string;
  text?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}): Promise<boolean> {
  const result = await blocking({
    icon: danger ? "warning" : "question",
    titleText: title,
    text,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    reverseButtons: true,
    focusCancel: danger,
    customClass: {
      container: "thepos-swal-container",
      popup: "thepos-swal-popup",
      title: "thepos-swal-title",
      htmlContainer: "thepos-swal-text",
      confirmButton: danger
        ? "button thepos-swal-danger"
        : "button button-primary thepos-swal-confirm",
      cancelButton: "button button-outline thepos-swal-cancel",
    },
  });
  return result?.isConfirmed ?? false;
}
