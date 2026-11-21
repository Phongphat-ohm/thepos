import { createRoot } from "react-dom/client";
import "@fontsource/kanit/400.css";
import "@fontsource/kanit/500.css";
import "@fontsource/kanit/600.css";
import "@fontsource/kanit/700.css";
import { App } from "./ui/app";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(<App />);
