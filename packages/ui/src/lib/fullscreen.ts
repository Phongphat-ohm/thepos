import { useCallback, useEffect, useState } from "react";
import { readStored } from "./format";
import { invokeDesktop, isDesktopApp } from "./native";

const AUTO_FULLSCREEN_KEY = "thepos/auto-fullscreen";
const FULLSCREEN_EVENT = "thepos:fullscreen-changed";

export function getAutoFullscreen(): boolean {
  return readStored(AUTO_FULLSCREEN_KEY, false);
}

export function setAutoFullscreen(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_FULLSCREEN_KEY, JSON.stringify(enabled));
  } catch {
    // Ignore storage errors in restricted environments.
  }
}

export async function getFullscreenState(): Promise<boolean> {
  if (isDesktopApp()) {
    try {
      return await invokeDesktop<boolean>("is_fullscreen");
    } catch {
      return false;
    }
  }
  return typeof document !== "undefined" && Boolean(document.fullscreenElement);
}

export async function setFullscreenState(fullscreen: boolean): Promise<boolean> {
  let next = fullscreen;
  if (isDesktopApp()) {
    next = await invokeDesktop<boolean>("set_fullscreen", { fullscreen });
  } else if (typeof document !== "undefined") {
    if (fullscreen && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else if (!fullscreen && document.fullscreenElement) {
      await document.exitFullscreen();
    }
    next = Boolean(document.fullscreenElement);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<boolean>(FULLSCREEN_EVENT, { detail: next }));
  }
  return next;
}

export async function toggleFullscreen(): Promise<boolean> {
  const current = await getFullscreenState();
  return setFullscreenState(!current);
}

export function useFullscreen() {
  const [fullscreen, setFullscreen] = useState(false);

  const sync = useCallback(async () => {
    setFullscreen(await getFullscreenState());
  }, []);

  useEffect(() => {
    void sync();

    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail;
      if (typeof detail === "boolean") setFullscreen(detail);
    };
    const onNativeChange = () => {
      void sync();
    };

    window.addEventListener(FULLSCREEN_EVENT, onCustom);
    document.addEventListener("fullscreenchange", onNativeChange);
    window.addEventListener("resize", onNativeChange);
    return () => {
      window.removeEventListener(FULLSCREEN_EVENT, onCustom);
      document.removeEventListener("fullscreenchange", onNativeChange);
      window.removeEventListener("resize", onNativeChange);
    };
  }, [sync]);

  const toggle = useCallback(async () => {
    try {
      const next = await toggleFullscreen();
      setFullscreen(next);
    } catch {
      // Ignore browser fullscreen rejection when not triggered by user gesture.
    }
  }, []);

  return { fullscreen, toggle };
}
