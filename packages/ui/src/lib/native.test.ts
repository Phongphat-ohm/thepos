import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { webRoutes } from "./native";

const pascalToSnake = (name: string) =>
  name.replace(/([A-Z])/g, (match, letter, index) => (index === 0 ? letter.toLowerCase() : `_${letter.toLowerCase()}`));

describe("desktop native parity", () => {
  it("keeps webRoutes in sync with Tauri BusinessRoute variants", () => {
    const apiRs = readFileSync(resolve(__dirname, "../../../../apps/desktop/src-tauri/src/api/routes.rs"), "utf8");
    const match = apiRs.match(/pub enum BusinessRoute\s*\{([\s\S]*?)\}/);
    expect(match).toBeTruthy();

    const rustRoutes = match![1]
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, "").trim().replace(/,$/, ""))
      .filter(Boolean)
      .map(pascalToSnake)
      .sort();

    expect(Object.keys(webRoutes).sort()).toEqual(rustRoutes);
  });

  it("allows every generated Tauri command in permissions/pos.toml", () => {
    const mainRs = readFileSync(resolve(__dirname, "../../../../apps/desktop/src-tauri/src/main.rs"), "utf8");
    const handlerMatch = mainRs.match(/tauri::generate_handler!\[([\s\S]*?)\]/);
    expect(handlerMatch).toBeTruthy();

    const commands = handlerMatch![1]
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const posToml = readFileSync(resolve(__dirname, "../../../../apps/desktop/src-tauri/permissions/pos.toml"), "utf8");
    const allowed = new Set(
      Array.from(posToml.matchAll(/commands\.allow\s*=\s*\[([\s\S]*?)\]/g))
        .flatMap((group) => Array.from(group[1].matchAll(/"([^"]+)"/g), (item) => item[1])),
    );

    for (const command of commands) {
      expect(allowed.has(command)).toBe(true);
    }
  });
});
