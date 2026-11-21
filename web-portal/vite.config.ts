import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/ui", import.meta.url)),
      "@thepos/contracts": fileURLToPath(new URL("./src/contracts/index.ts", import.meta.url)),
      "@thepos/shared": fileURLToPath(new URL("./src/shared/index.ts", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    allowedHosts:['portalthepos.ppkxb.space']
  },
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          ui: ["lucide-react", "sweetalert2"],
          validation: ["zod"],
          exceljs: ["exceljs"],
        },
      },
    },
  },
  clearScreen: false,
});
