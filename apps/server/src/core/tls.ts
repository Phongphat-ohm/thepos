import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";

const VIRTUAL_IFACE_PATTERN =
  /(vethernet|wsl|hyper-v|docker|vmware|virtualbox|vbox|loopback|tailscale|zerotier|hamachi|tun|tap|utun|br-)/i;

export function isValidIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isPrivateIpv4(ip: string): boolean {
  if (!isValidIpv4(ip)) return false;
  const [a, b] = ip.split(".").map(Number) as [number, number, number, number];
  if (a === 192 && b === 168) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function detectAllInterfaceIpv4s(): string[] {
  const ifaces = networkInterfaces();
  const seen = new Set<string>();
  const ips: string[] = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs || VIRTUAL_IFACE_PATTERN.test(name)) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      if (isValidIpv4(addr.address) && !seen.has(addr.address)) {
        seen.add(addr.address);
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

export type LanIpCandidate = {
  address: string;
  interfaceName: string;
  isVirtual: boolean;
};

export function detectLanIpCandidates(): LanIpCandidate[] {
  const ifaces = networkInterfaces();
  const candidates: LanIpCandidate[] = [];

  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      if (!isPrivateIpv4(addr.address)) continue;
      candidates.push({
        address: addr.address,
        interfaceName: name,
        isVirtual: VIRTUAL_IFACE_PATTERN.test(name),
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.isVirtual !== b.isVirtual) return a.isVirtual ? 1 : -1;
    const score = (ip: string) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : 2);
    const diff = score(a.address) - score(b.address);
    if (diff !== 0) return diff;
    return a.interfaceName.localeCompare(b.interfaceName);
  });

  return candidates;
}

export function detectLanIps(): string[] {
  const seen = new Set<string>();
  const ips: string[] = [];
  for (const c of detectLanIpCandidates()) {
    if (!seen.has(c.address)) {
      seen.add(c.address);
      ips.push(c.address);
    }
  }
  return ips;
}

// --- Pure-TS ASN.1 DER encoder for X.509 v3 self-signed ECDSA P-256 cert ---

function derLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTag(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

const derSeq = (...items: Buffer[]) => derTag(0x30, Buffer.concat(items));
const derSet = (...items: Buffer[]) => derTag(0x31, Buffer.concat(items));
const derExplicit = (index: number, content: Buffer) => derTag(0xa0 | index, content);

function derInt(bytes: Buffer | number): Buffer {
  let buf = typeof bytes === "number" ? Buffer.from([bytes]) : bytes;
  if (buf.length === 0) buf = Buffer.from([0]);
  if (buf[0]! & 0x80) buf = Buffer.concat([Buffer.from([0]), buf]);
  return derTag(0x02, buf);
}

function derBitString(bytes: Buffer): Buffer {
  return derTag(0x03, Buffer.concat([Buffer.from([0]), bytes]));
}

function derOid(oid: string): Buffer {
  const parts = oid.split(".").map(Number);
  const out: number[] = [parts[0]! * 40 + parts[1]!];
  for (let i = 2; i < parts.length; i++) {
    let val = parts[i]!;
    if (val === 0) {
      out.push(0);
      continue;
    }
    const enc: number[] = [];
    while (val > 0) {
      enc.unshift((val & 0x7f) | (enc.length ? 0x80 : 0));
      val >>= 7;
    }
    out.push(...enc);
  }
  return derTag(0x06, Buffer.from(out));
}

function derUtcTime(date: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, "0");
  const str =
    pad(date.getUTCFullYear() % 100) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z";
  return derTag(0x17, Buffer.from(str, "ascii"));
}

function ipv4ToBytes(ip: string): Buffer {
  return Buffer.from(ip.split(".").map((p) => Number(p) & 0xff));
}

function toPem(label: string, der: Buffer): string {
  const b64 = der.toString("base64");
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export function generateSelfSignedCert(ips: readonly string[]): { certPem: string; keyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spkiDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  const serialBytes = randomBytes(16);
  serialBytes[0] = serialBytes[0]! & 0x7f;

  // ecdsa-with-SHA256: 1.2.840.10045.4.3.2
  const sigAlg = derSeq(derOid("1.2.840.10045.4.3.2"));

  // CN=ThePOS Local HTTPS
  const commonName = derSeq(derOid("2.5.4.3"), derTag(0x0c, Buffer.from("ThePOS Local HTTPS", "utf8")));
  const name = derSeq(derSet(commonName));

  const now = new Date();
  const notBefore = new Date(now.getTime() - 60_000);
  const notAfter = new Date(now.getTime() + 800 * 24 * 60 * 60_000);
  const validity = derSeq(derUtcTime(notBefore), derUtcTime(notAfter));

  // Extensions
  const basicConstraints = derSeq(
    derOid("2.5.29.19"),
    derTag(0x01, Buffer.from([0xff])), // critical = true
    derTag(0x04, derSeq()), // CA:FALSE
  );
  const keyUsage = derSeq(
    derOid("2.5.29.15"),
    derTag(0x01, Buffer.from([0xff])),
    derTag(0x04, derTag(0x03, Buffer.from([0x05, 0xa0]))), // digitalSignature + keyEncipherment
  );
  const extKeyUsage = derSeq(
    derOid("2.5.29.37"),
    derTag(0x04, derSeq(derOid("1.3.6.1.5.5.7.3.1"))), // id-kp-serverAuth
  );

  const uniqueIps = [...new Set(["127.0.0.1", ...ips.filter(isValidIpv4)])];
  const sanEntries = [
    derTag(0x82, Buffer.from("localhost", "ascii")),
    ...uniqueIps.map((ip) => derTag(0x87, ipv4ToBytes(ip))),
  ];
  const san = derSeq(derOid("2.5.29.17"), derTag(0x04, derSeq(...sanEntries)));

  const extensions = derExplicit(3, derSeq(basicConstraints, keyUsage, extKeyUsage, san));

  const tbs = derSeq(
    derExplicit(0, derInt(2)), // v3
    derInt(serialBytes),
    sigAlg,
    name,
    validity,
    name,
    spkiDer,
    extensions,
  );

  const signature = cryptoSign("sha256", tbs, privateKey);
  const certDer = derSeq(tbs, sigAlg, derBitString(signature));

  return {
    certPem: toPem("CERTIFICATE", certDer),
    keyPem,
  };
}

export function ensureSelfSignedCert(
  ips: readonly string[],
  tlsDir = resolve(process.cwd(), ".tls"),
): { cert: string; key: string; certPath: string; keyPath: string; regenerated: boolean } {
  const certPath = resolve(tlsDir, "server.crt");
  const keyPath = resolve(tlsDir, "server.key");
  const metaPath = resolve(tlsDir, "server.meta.json");

  const sortedIps = [...new Set(["127.0.0.1", ...ips.filter(isValidIpv4)])].sort();
  const fingerprint = createHash("sha256").update(sortedIps.join(",")).digest("hex");

  if (existsSync(certPath) && existsSync(keyPath) && existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { fingerprint?: string; expiresAt?: number };
      if (
        meta.fingerprint === fingerprint &&
        typeof meta.expiresAt === "number" &&
        meta.expiresAt - Date.now() > 30 * 24 * 60 * 60_000
      ) {
        return {
          cert: readFileSync(certPath, "utf8"),
          key: readFileSync(keyPath, "utf8"),
          certPath,
          keyPath,
          regenerated: false,
        };
      }
    } catch {
      // Regenerate on corrupt metadata
    }
  }

  const { certPem, keyPem } = generateSelfSignedCert(sortedIps);
  mkdirSync(dirname(certPath), { recursive: true });
  writeFileSync(certPath, certPem, { encoding: "utf8" });
  writeFileSync(keyPath, keyPem, { encoding: "utf8", mode: 0o600 });
  writeFileSync(
    metaPath,
    JSON.stringify({
      fingerprint,
      ips: sortedIps,
      expiresAt: Date.now() + 800 * 24 * 60 * 60_000,
    }),
    "utf8",
  );

  return {
    cert: certPem,
    key: keyPem,
    certPath,
    keyPath,
    regenerated: true,
  };
}
