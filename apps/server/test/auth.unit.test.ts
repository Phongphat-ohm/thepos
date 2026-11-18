import { expect, it } from "vitest";
import { nextFailure } from "../src/modules/auth";
import { hashPassword, lockoutMs, verifyPassword } from "../src/security";

it("hashes passwords and PINs with salted Argon2id", async () => {
  const pin = "012345";
  const first = await hashPassword(pin);
  const second = await hashPassword(pin);
  expect(first).toMatch(/^\$argon2id\$/);
  expect(first).not.toBe(second);
  expect(await verifyPassword(pin, first)).toBe(true);
  expect(await verifyPassword("012346", first)).toBe(false);
});

it("pauses after the fifth failure and resets the counter after the pause", () => {
  const now = Date.now();
  expect(nextFailure(3, null, now)).toEqual({ failures: 4, until: null });
  expect(nextFailure(4, null, now)).toEqual({ failures: 5, until: new Date(now + lockoutMs) });
  expect(nextFailure(5, new Date(now - 1), now)).toEqual({ failures: 1, until: null });
});
