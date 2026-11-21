import { describe, expect, it } from "vitest";
import {
  countSessionCreateInput,
  countSessionFinalizeInput,
  mobileJoinInput,
  stockCountInput,
} from "@thepos/contracts";
import { isPrivateLanIp } from "../src/core/security";
import { formatJoinCode } from "../src/modules/mobile-stock-counts/service";
import { generateSelfSignedCert } from "../src/core/tls";

describe("isPrivateLanIp", () => {
  it("allows loopback and RFC1918 private IPv4 ranges", () => {
    expect(isPrivateLanIp("127.0.0.1")).toBe(true);
    expect(isPrivateLanIp("::1")).toBe(true);
    expect(isPrivateLanIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateLanIp("10.0.0.5")).toBe(true);
    expect(isPrivateLanIp("172.16.0.1")).toBe(true);
    expect(isPrivateLanIp("172.31.255.254")).toBe(true);
    expect(isPrivateLanIp("192.168.1.42")).toBe(true);
    expect(isPrivateLanIp("::ffff:192.168.0.100")).toBe(true);
    expect(isPrivateLanIp("169.254.10.2")).toBe(true);
    expect(isPrivateLanIp("fe80::1")).toBe(true);
    expect(isPrivateLanIp("fd12:3456:789a::1")).toBe(true);
  });

  it("rejects public IPs and empty values", () => {
    expect(isPrivateLanIp(undefined)).toBe(false);
    expect(isPrivateLanIp("")).toBe(false);
    expect(isPrivateLanIp("8.8.8.8")).toBe(false);
    expect(isPrivateLanIp("1.1.1.1")).toBe(false);
    expect(isPrivateLanIp("172.32.0.1")).toBe(false);
    expect(isPrivateLanIp("172.15.255.255")).toBe(false);
    expect(isPrivateLanIp("203.0.113.10")).toBe(false);
    expect(isPrivateLanIp("2001:4860:4860::8888")).toBe(false);
  });
});

describe("mobile stock count contracts", () => {
  it("normalizes mobile join code and strips dashes/spaces", () => {
    const parsed = mobileJoinInput.parse({ code: "ab3k - 9p2m", displayName: "  บี - ชั้น 1  " });
    expect(parsed.code).toBe("AB3K9P2M");
    expect(parsed.displayName).toBe("บี - ชั้น 1");
    expect(formatJoinCode(parsed.code)).toBe("AB3K-9P2M");
  });

  it("defaults showExpectedQty to false (Blind Count)", () => {
    const parsed = countSessionCreateInput.parse({
      title: "นับสต๊อกประจำเดือน",
      reason: "ตรวจนับประจำเดือน พ.ย.",
    });
    expect(parsed.showExpectedQty).toBe(false);
  });

  it("supports up to 1000 lines in stockCountInput and countSessionFinalizeInput", () => {
    const lines = Array.from({ length: 120 }, () => ({
      lotId: crypto.randomUUID(),
      expected: "10.000",
      counted: "9.000",
    }));
    expect(stockCountInput.safeParse({ reason: "Full store count", lines }).success).toBe(true);
    expect(countSessionFinalizeInput.safeParse({ reason: "Full store count", lines }).success).toBe(true);
  });

  it("generates a valid PEM self-signed X.509 certificate and ECDSA key", () => {
    const { certPem, keyPem } = generateSelfSignedCert(["192.168.1.50"]);
    expect(certPem).toContain("-----BEGIN CERTIFICATE-----");
    expect(certPem).toContain("-----END CERTIFICATE-----");
    expect(keyPem).toContain("-----BEGIN PRIVATE KEY-----");
  });
});
