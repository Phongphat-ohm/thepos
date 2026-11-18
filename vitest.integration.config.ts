import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

if (existsSync(".env") && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(".env");
}

export default defineConfig({
  test: {
    include: ["apps/server/test/**/*.integration.test.ts"],
    hookTimeout: 90_000,
    testTimeout: 30_000,
  },
});
