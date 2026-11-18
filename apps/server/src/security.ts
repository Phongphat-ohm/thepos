import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify as verifyHash } from "@node-rs/argon2";
import { sign, verify } from "hono/jwt";
import { z } from "zod";
import { ApiError } from "./errors";

export const accessMs = 10 * 60_000;
export const sessionMs = 12 * 60 * 60_000;
export const lockoutMs = 15 * 60_000;
const issuer = "thepos-api";
const audience = "thepos-desktop";
const claimsSchema = z.object({
  sub: z.uuid(), sid: z.uuid(), did: z.uuid(), gen: z.number().int().nonnegative(),
  iss: z.literal(issuer), aud: z.literal(audience), exp: z.number().int(),
});

export const newToken = () => randomBytes(32).toString("base64url");
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const matchesSecret = (expected: string, actual: string) =>
  timingSafeEqual(Buffer.from(digest(expected), "hex"), Buffer.from(digest(actual), "hex"));

function normalizeIp(ip: string): string {
  const lower = ip.trim().toLowerCase();
  return lower.startsWith("::ffff:") ? lower.slice(7) : lower;
}

function parseIpv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = ((value << 8) | octet) >>> 0;
  }
  return value;
}

function matchesCidr(ip: string, entry: string): boolean {
  const slash = entry.indexOf("/");
  if (slash <= 0) return false;
  const base = parseIpv4(normalizeIp(entry.slice(0, slash)));
  const bits = Number(entry.slice(slash + 1));
  const candidate = parseIpv4(ip);
  if (base === null || candidate === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (candidate & mask) === (base & mask);
}

export function isTrustedProxyIp(rawIp: string, trusted: readonly string[]): boolean {
  const ip = normalizeIp(rawIp);
  for (const rawEntry of trusted) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    if (entry === "*" || normalizeIp(entry) === ip) return true;
    if (entry.includes("/") && matchesCidr(ip, entry)) return true;
  }
  return false;
}

// Bound concurrent Argon2id calls (64 MiB each) so burst auth traffic cannot exhaust memory.
const MAX_ARGON_CONCURRENCY = 6;
const MAX_ARGON_QUEUE = 32;
let activeArgon = 0;
const argonWaiters: Array<() => void> = [];

async function withArgonLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (activeArgon >= MAX_ARGON_CONCURRENCY) {
    if (argonWaiters.length >= MAX_ARGON_QUEUE) {
      throw new ApiError(429, "RATE_LIMITED");
    }
    await new Promise<void>((resolve) => {
      argonWaiters.push(resolve);
    });
  }
  activeArgon += 1;
  try {
    return await fn();
  } finally {
    activeArgon -= 1;
    const next = argonWaiters.shift();
    if (next) next();
  }
}

export const hashPassword = (value: string) =>
  withArgonLimit(() => hash(value, { memoryCost: 65_536, timeCost: 2, parallelism: 1 })); // The default algorithm is Argon2id.

export const verifyPassword = (value: string, encoded: string) =>
  withArgonLimit(() => verifyHash(encoded, value));

export function issueAccess(
  session: { id: string; userId: string; deviceId: string; generation: number; expiresAt: Date },
  secret: string,
  now: number,
) {
  return sign({
    sub: session.userId, sid: session.id, did: session.deviceId, gen: session.generation,
    iss: issuer, aud: audience, iat: Math.floor(now / 1000),
    exp: Math.floor(Math.min(now + accessMs, session.expiresAt.getTime()) / 1000),
  }, secret, "HS256");
}

export async function readAccess(header: string | undefined, secret: string, now: number) {
  const match = header?.match(/^Bearer ([A-Za-z0-9_.-]+)$/i);
  if (match) {
    try {
      const payload = await verify(match[1], secret, { alg: "HS256", exp: false, iat: false });
      const claims = claimsSchema.parse(payload);
      if (claims.exp * 1000 > now) return claims;
    } catch {
      // Signature and claim failures share the same response.
    }
  }
  throw new ApiError(401, "SESSION_REQUIRED");
}
