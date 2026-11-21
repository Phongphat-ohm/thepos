import { describe, expect, it } from "vitest";
import { isTrustedProxyIp, resolveClientIp } from "../src/core/security";
import { createServerSecurity, timingSafeEqualText } from "../src/core/server-security";

describe("server security manager", () => {
  it("verifies console code and connect key in constant time and rotates tokens", () => {
    let clock = 1_000_000;
    const { security, consoleCode } = createServerSecurity({
      signingSecret: "a-very-long-signing-secret-for-testing-32-chars",
      consoleCode: "ABCD-EFGH-JKLM",
      connectKey: "POS-1234-5678",
      now: () => clock,
    });

    expect(consoleCode).toBe("ABCD-EFGH-JKLM");
    expect(security.verifyConsoleCode("abcd-efgh-jklm")).toBe(true);
    expect(security.verifyConsoleCode("WRONG-CODE")).toBe(false);

    expect(security.verifyConnectKey("WRONG-KEY")).toBeNull();
    const token1 = security.verifyConnectKey("POS-1234-5678");
    expect(token1).toBeTruthy();
    expect(security.verifyServerToken(token1!)).toBe(true);

    const rotated = security.rotateConnectKey();
    expect(rotated.keyVersion).toBe(2);
    expect(rotated.connectKey).toMatch(/^POS-/);
    expect(security.verifyServerToken(token1!)).toBe(false);

    const token2 = security.verifyConnectKey(rotated.connectKey);
    expect(token2).toBeTruthy();
    expect(security.verifyServerToken(token2!)).toBe(true);

    const adminCookie = security.createAdminSessionToken();
    expect(security.verifyAdminSessionToken(adminCookie)).toBe(true);
    expect(security.verifyAdminSessionToken("tampered.token")).toBe(false);

    const adminCookie2 = security.createAdminSessionToken();
    expect(security.verifyAdminSessionToken(adminCookie2)).toBe(true);
    security.revokeAdminSessionToken(adminCookie2);
    expect(security.verifyAdminSessionToken(adminCookie2)).toBe(false);

    clock += 9 * 60 * 60 * 1000;
    expect(security.verifyAdminSessionToken(adminCookie)).toBe(false);
  });

  it("compares strings safely regardless of length", () => {
    expect(timingSafeEqualText("secret-1", "secret-1")).toBe(true);
    expect(timingSafeEqualText("secret-1", "short")).toBe(false);
  });

  it("matches trusted proxy IPs using exact, IPv4-mapped IPv6, and CIDR ranges", () => {
    const trusted = ["172.16.0.0/12", "10.0.0.0/8", "127.0.0.1", "::1"];
    expect(isTrustedProxyIp("172.18.0.5", trusted)).toBe(true);
    expect(isTrustedProxyIp("::ffff:10.0.1.20", trusted)).toBe(true);
    expect(isTrustedProxyIp("::1", trusted)).toBe(true);
    expect(isTrustedProxyIp("203.0.113.9", trusted)).toBe(false);
    expect(isTrustedProxyIp("192.168.1.5", ["*"])).toBe(true);
  });

  it("resolves client IP safely from right-to-left untrusted hops", () => {
    const trusted = ["172.16.0.0/12", "127.0.0.1"];
    const withXff = (value: string) => new Request("http://localhost/health", { headers: { "x-forwarded-for": value } });

    expect(resolveClientIp(withXff("1.2.3.4"), undefined, trusted)).toBeUndefined();
    expect(resolveClientIp(withXff("1.2.3.4"), "198.51.100.4", trusted)).toBe("198.51.100.4");
    expect(resolveClientIp(new Request("http://localhost/health"), "172.18.0.5", trusted)).toBe("172.18.0.5");
    expect(resolveClientIp(withXff("10.0.0.1, 203.0.113.45, 172.18.0.2"), "127.0.0.1", trusted)).toBe("203.0.113.45");
    expect(resolveClientIp(withXff("172.18.0.2, 127.0.0.1"), "127.0.0.1", trusted)).toBe("127.0.0.1");
  });
});
