import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "@fontsource/kanit/400.css";
import "@fontsource/kanit/500.css";
import "@fontsource/kanit/600.css";
import "@fontsource/kanit/700.css";
import { App } from "@thepos/ui/app";
import { registerDesktopTransport } from "@thepos/ui/native";
import "@thepos/ui/styles.css";

if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  registerDesktopTransport(invoke);
}

createRoot(document.getElementById("root")!).render(<App />);
