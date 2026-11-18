export const idleLockMs = 15 * 60_000;

export function watchIdle(
  onLock: () => void,
  windowTarget: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  documentTarget: Pick<Document, "addEventListener" | "removeEventListener"> = document,
) {
  let lastActivity = Date.now();
  let locked = false;

  function check() {
    if (!locked && Date.now() - lastActivity >= idleLockMs) {
      locked = true;
      onLock();
    }
  }

  function activity() {
    const now = Date.now();
    if (!locked && now - lastActivity < 1000) return;
    check();
    if (!locked) lastActivity = Date.now();
  }

  const events = ["keydown", "pointerdown", "pointermove", "wheel"] as const;
  for (const event of events) windowTarget.addEventListener(event, activity, { passive: true });
  windowTarget.addEventListener("focus", check);
  documentTarget.addEventListener("visibilitychange", check);
  const timer = setInterval(check, 1000);

  return () => {
    clearInterval(timer);
    for (const event of events) windowTarget.removeEventListener(event, activity);
    windowTarget.removeEventListener("focus", check);
    documentTarget.removeEventListener("visibilitychange", check);
  };
}
