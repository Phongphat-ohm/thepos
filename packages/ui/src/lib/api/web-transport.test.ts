import { describe, expect, it } from "vitest";
import { normalizeWebUrl } from "./web-transport";

describe("normalizeWebUrl", () => {
  it("normalizes IP and domain inputs with or without scheme and trailing slashes", () => {
    expect(normalizeWebUrl("192.168.1.10:3443", "https:")).toBe("https://192.168.1.10:3443");
    expect(normalizeWebUrl("203.0.113.10:3443/", "https:")).toBe("https://203.0.113.10:3443");
    expect(normalizeWebUrl("https://203.0.113.10:3443///")).toBe("https://203.0.113.10:3443");
    expect(normalizeWebUrl("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
    expect(normalizeWebUrl("pos.example.com", "https:")).toBe("https://pos.example.com");
  });

  it("rejects empty, non-http schemes, credentials, queries, hashes, and paths", () => {
    expect(() => normalizeWebUrl("")).toThrow("INVALID_SERVER_URL");
    expect(() => normalizeWebUrl("   ")).toThrow("INVALID_SERVER_URL");
    expect(() => normalizeWebUrl("ftp://192.168.1.10")).toThrow("INVALID_SERVER_URL");
    expect(() => normalizeWebUrl("https://user:pass@192.168.1.10")).toThrow("INVALID_SERVER_URL");
    expect(() => normalizeWebUrl("https://192.168.1.10:3443/api/v1")).toThrow("INVALID_SERVER_URL");
    expect(() => normalizeWebUrl("https://192.168.1.10:3443?a=1")).toThrow("INVALID_SERVER_URL");
    expect(() => normalizeWebUrl("https://192.168.1.10:3443#hash")).toThrow("INVALID_SERVER_URL");
  });
});
