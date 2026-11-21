import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function rootBrandLogoPlugin(): Plugin {
  const rootDir = fileURLToPath(new URL("../..", import.meta.url));
  const candidates = [
    ["logo.png", "image/png"],
    ["logo.svg", "image/svg+xml"],
    ["logo.webp", "image/webp"],
    ["logo.jpg", "image/jpeg"],
    ["logo.jpeg", "image/jpeg"],
  ] as const;

  return {
    name: "root-brand-logo",
    configureServer(server) {
      server.middlewares.use("/brand-logo", (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        for (const [file, contentType] of candidates) {
          const full = resolve(rootDir, file);
          if (existsSync(full) && statSync(full).isFile()) {
            const stat = statSync(full);
            const etag = `"${Math.trunc(stat.mtimeMs)}-${stat.size}"`;
            res.setHeader("Content-Type", contentType);
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("ETag", etag);
            if (req.headers["if-none-match"] === etag) {
              res.statusCode = 304;
              res.end();
              return;
            }
            res.end(req.method === "HEAD" ? undefined : readFileSync(full));
            return;
          }
        }
        res.statusCode = 404;
        res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), rootBrandLogoPlugin()],
  resolve: { alias: { "@": fileURLToPath(new URL("../../packages/ui/src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/brand-logo": "http://127.0.0.1:3000",
    },
  },
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          ui: ["lucide-react", "sweetalert2"],
          validation: ["zod", "@thepos/contracts"],
          exceljs: ["exceljs"],
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "lucide-react",
      "zod",
      "sweetalert2",
      "clsx",
      "class-variance-authority",
      "@radix-ui/react-label",
    ],
  },
  clearScreen: false,
});
