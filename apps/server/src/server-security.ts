import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateAccessCode(groups = 3, groupLen = 4, prefix = ""): string {
  const total = groups * groupLen;
  const bytes = randomBytes(total);
  const chars: string[] = [];
  for (let i = 0; i < total; i++) {
    chars.push(CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]!);
  }
  const parts: string[] = [];
  for (let g = 0; g < groups; g++) {
    parts.push(chars.slice(g * groupLen, (g + 1) * groupLen).join(""));
  }
  return prefix ? `${prefix}-${parts.join("-")}` : parts.join("-");
}

export function timingSafeEqualText(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function deriveKey(masterSecret: string, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(masterSecret, "utf8"), Buffer.from("thepos-server-security", "utf8"), Buffer.from(info, "utf8"), 32));
}

function encryptSecret(key: Buffer, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), ciphertext.toString("hex")].join(":");
}

function decryptSecret(key: Buffer, encoded: string): string | null {
  const [version, ivHex, tagHex, dataHex] = encoded.split(":");
  if (version !== "v1" || !ivHex || !tagHex || !dataHex) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function signPayload(secret: Buffer, payload: Record<string, unknown>): string {
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifySignedPayload(secret: Buffer, token: string): Record<string, unknown> | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!data || !sig) return null;
  const expected = createHmac("sha256", secret).update(data).digest("base64url");
  if (!timingSafeEqualText(sig, expected)) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type ServerSecurity = {
  verifyConsoleCode: (code: string) => boolean;
  verifyConnectKey: (key: string) => string | null;
  verifyServerToken: (token: string | undefined) => boolean;
  getConnectKey: () => string;
  getKeyVersion: () => number;
  rotateConnectKey: () => { connectKey: string; keyVersion: number };
  initPersistence?: (db: PrismaClient) => Promise<void>;
  rotateConnectKeyPersisted?: (db: PrismaClient) => Promise<{ connectKey: string; keyVersion: number }>;
  createAdminSessionToken: () => string;
  verifyAdminSessionToken: (token: string | undefined) => boolean;
};

export function createServerSecurity(options: {
  signingSecret: string;
  consoleCode?: string;
  connectKey?: string;
  now?: () => number;
}): { security: ServerSecurity; consoleCode: string } {
  const now = options.now ?? Date.now;
  const consoleCode = options.consoleCode?.trim() || generateAccessCode(3, 4);
  const serverTokenKey = deriveKey(options.signingSecret, "server-tokens");
  const adminSessionKey = deriveKey(options.signingSecret, "admin-sessions");
  const storageKey = deriveKey(options.signingSecret, "connect-key-storage");
  let currentConnectKey = options.connectKey?.trim() || generateAccessCode(3, 4, "POS");
  let keyVersion = 1;

  const hashConnectKey = (key: string) => createHash("sha256").update(key).digest("hex");

  const security: ServerSecurity = {
    verifyConsoleCode(code: string) {
      return timingSafeEqualText(code.trim().toUpperCase(), consoleCode.toUpperCase());
    },
    verifyConnectKey(key: string) {
      if (!timingSafeEqualText(key.trim(), currentConnectKey)) return null;
      const issuedAt = now();
      return signPayload(serverTokenKey, {
        kind: "server",
        v: keyVersion,
        iat: issuedAt,
        exp: issuedAt + 90 * 24 * 60 * 60 * 1000,
      });
    },
    verifyServerToken(token: string | undefined) {
      if (!token) return false;
      const payload = verifySignedPayload(serverTokenKey, token);
      if (!payload) return false;
      if (payload.kind !== "server" || payload.v !== keyVersion) return false;
      if (typeof payload.exp !== "number" || now() > payload.exp) return false;
      return true;
    },
    getConnectKey() {
      return currentConnectKey;
    },
    getKeyVersion() {
      return keyVersion;
    },
    rotateConnectKey() {
      currentConnectKey = generateAccessCode(3, 4, "POS");
      keyVersion += 1;
      return { connectKey: currentConnectKey, keyVersion };
    },
    async initPersistence(db: PrismaClient) {
      try {
        const stored = await db.serverSecurityState.findUnique({ where: { singleton: true } });
        if (stored) {
          const decrypted = decryptSecret(storageKey, stored.connectKeyEncrypted);
          if (decrypted) {
            currentConnectKey = decrypted;
            keyVersion = stored.keyVersion;
            return;
          }
          // JWT_SECRET changed so previously encrypted connectKey cannot be decrypted; rotate version forward.
          keyVersion = stored.keyVersion + 1;
          currentConnectKey = options.connectKey?.trim() || generateAccessCode(3, 4, "POS");
          await db.serverSecurityState.update({
            where: { id: stored.id },
            data: {
              connectKeyEncrypted: encryptSecret(storageKey, currentConnectKey),
              connectKeyHash: hashConnectKey(currentConnectKey),
              keyVersion,
            },
          });
          return;
        }
        await db.serverSecurityState.create({
          data: {
            singleton: true,
            connectKeyEncrypted: encryptSecret(storageKey, currentConnectKey),
            connectKeyHash: hashConnectKey(currentConnectKey),
            keyVersion,
          },
        });
      } catch {
        // Table may not exist yet before migrations run; /server-admin stays operational with DB warning.
      }
    },
    async rotateConnectKeyPersisted(db: PrismaClient) {
      const nextKey = generateAccessCode(3, 4, "POS");
      const nextVersion = keyVersion + 1;
      const existing = await db.serverSecurityState.findUnique({ where: { singleton: true }, select: { id: true, keyVersion: true } });
      if (existing) {
        const resolvedVersion = Math.max(nextVersion, existing.keyVersion + 1);
        await db.serverSecurityState.update({
          where: { id: existing.id },
          data: {
            connectKeyEncrypted: encryptSecret(storageKey, nextKey),
            connectKeyHash: hashConnectKey(nextKey),
            keyVersion: resolvedVersion,
          },
        });
        currentConnectKey = nextKey;
        keyVersion = resolvedVersion;
      } else {
        await db.serverSecurityState.create({
          data: {
            singleton: true,
            connectKeyEncrypted: encryptSecret(storageKey, nextKey),
            connectKeyHash: hashConnectKey(nextKey),
            keyVersion: nextVersion,
          },
        });
        currentConnectKey = nextKey;
        keyVersion = nextVersion;
      }
      return { connectKey: currentConnectKey, keyVersion };
    },
    createAdminSessionToken() {
      const issuedAt = now();
      return signPayload(adminSessionKey, {
        kind: "server_admin",
        iat: issuedAt,
        exp: issuedAt + 8 * 60 * 60 * 1000,
      });
    },
    verifyAdminSessionToken(token: string | undefined) {
      if (!token) return false;
      const payload = verifySignedPayload(adminSessionKey, token);
      if (!payload) return false;
      if (payload.kind !== "server_admin") return false;
      if (typeof payload.exp !== "number" || now() > payload.exp) return false;
      return true;
    },
  };

  return { security, consoleCode };
}
