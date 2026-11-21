import { X509Certificate } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSelfSignedCert, generateSelfSignedCert, isValidIpv4 } from "../src/core/tls";

describe("TLS IPv4 SAN support", () => {
  it("validates IPv4 addresses strictly", () => {
    expect(isValidIpv4("192.168.1.10")).toBe(true);
    expect(isValidIpv4("203.0.113.10")).toBe(true);
    expect(isValidIpv4("127.0.0.1")).toBe(true);
    expect(isValidIpv4("256.0.0.1")).toBe(false);
    expect(isValidIpv4("not-an-ip")).toBe(false);
    expect(isValidIpv4("192.168.1")).toBe(false);
  });

  it("includes both private and public IPv4s in SAN and ignores invalid entries", () => {
    const { certPem } = generateSelfSignedCert(["192.168.1.10", "203.0.113.10", "invalid-ip", "192.168.1.10"]);
    const cert = new X509Certificate(certPem);
    const san = cert.subjectAltName ?? "";

    expect(san).toContain("DNS:localhost");
    expect(san).toContain("IP Address:127.0.0.1");
    expect(san).toContain("IP Address:192.168.1.10");
    expect(san).toContain("IP Address:203.0.113.10");
  });

  it("regenerates persisted cert when TLS extra IPs change", () => {
    const dir = mkdtempSync(join(tmpdir(), "thepos-tls-"));
    try {
      const first = ensureSelfSignedCert(["192.168.1.10"], dir);
      expect(first.regenerated).toBe(true);

      const second = ensureSelfSignedCert(["192.168.1.10"], dir);
      expect(second.regenerated).toBe(false);

      const third = ensureSelfSignedCert(["192.168.1.10", "203.0.113.10"], dir);
      expect(third.regenerated).toBe(true);
      expect(new X509Certificate(third.cert).subjectAltName).toContain("IP Address:203.0.113.10");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
