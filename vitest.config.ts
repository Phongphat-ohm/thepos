import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./packages/ui/src", import.meta.url)),
          },
        },
        test: {
          name: "workspace",
          include: [
            "packages/**/*.test.ts",
            "apps/server/test/**/*.unit.test.ts",
            "apps/desktop/src/**/*.test.ts",
          ],
        },
      },
      {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./web-portal/src/ui", import.meta.url)),
            "@thepos/contracts": fileURLToPath(new URL("./web-portal/src/contracts/index.ts", import.meta.url)),
            "@thepos/shared": fileURLToPath(new URL("./web-portal/src/shared/index.ts", import.meta.url)),
          },
        },
        test: {
          name: "web-portal",
          include: [
            "web-portal/test/**/*.test.ts",
            "web-portal/test/**/*.test.tsx",
            "web-portal/src/**/*.test.ts",
            "web-portal/src/**/*.test.tsx",
          ],
        },
      },
    ],
  },
});
