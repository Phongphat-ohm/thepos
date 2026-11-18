import { Prisma, type PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { bootstrapSchema, enrollSchema, tokenSchema, type EnrollableDevice } from "@thepos/contracts";
import { ApiError } from "../errors";
import { digest, hashPassword, matchesSecret, newToken, verifyPassword } from "../security";
import { audit, nextFailure, requirePermission, withPassword } from "./auth";

let dummyPinHash: Promise<string> | undefined;

export function createSetup(db: PrismaClient, bootstrapSecret: string | undefined, now: () => number) {
  return {
    async status(raw: string | undefined) {
      const token = tokenSchema.safeParse(raw);
      const [store, device] = await Promise.all([
        db.store.findUnique({ where: { singleton: true }, select: { id: true } }),
        token.success
          ? db.device.findUnique({ where: { tokenHash: digest(token.data) }, select: { disabledAt: true } })
          : undefined,
      ]);
      return { initialized: !!store, registered: !!device && !device.disabledAt };
    },

    async devices(raw?: string): Promise<{ items: EnrollableDevice[] }> {
      const token = tokenSchema.safeParse(raw);
      const callerHash = token.success ? digest(token.data) : null;
      const currentNow = new Date(now());
      const rows = await db.device.findMany({
        where: {
          disabledAt: null,
          isWebDevice: false,
        },
        select: {
          id: true,
          name: true,
          pinHash: true,
          tokenHash: true,
          sessions: {
            where: { revokedAt: null, expiresAt: { gt: currentNow } },
            select: { user: { select: { name: true } } },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return {
        items: rows.map(({ id, name, pinHash, tokenHash, sessions }) => {
          const activeUser = sessions[0]?.user.name ?? null;
          const inUse = activeUser !== null && tokenHash !== callerHash;
          return { id, name, hasPin: pinHash !== null, inUse, activeUser };
        }),
      };
    },

    async bootstrap(input: z.infer<typeof bootstrapSchema>, tokenHash: string) {
      if (!bootstrapSecret || !matchesSecret(bootstrapSecret, input.secret)) {
        throw new ApiError(403, "INVALID_BOOTSTRAP_SECRET");
      }
      if (await db.store.findUnique({ where: { singleton: true } })) {
        throw new ApiError(409, "ALREADY_INITIALIZED");
      }
      const passwordHash = await hashPassword(input.password);
      const pinHash = await hashPassword(input.pin);
      const devicePinHash = input.devicePin ? await hashPassword(input.devicePin) : pinHash;
      try {
        await db.$transaction(async (tx) => {
          const admin = await tx.role.findUnique({ where: { code: "ADMIN" } });
          if (!admin) throw new ApiError(503, "UNAVAILABLE");
          const store = await tx.store.create({
            data: { name: input.storeName, address: input.storeAddress, taxId: input.taxId },
          });
          const user = await tx.user.create({
            data: {
              storeId: store.id, name: input.displayName, username: input.username, passwordHash, pinHash,
              roles: { create: { roleId: admin.id } },
            },
          });
          const device = await tx.device.create({
            data: { storeId: store.id, name: input.deviceName, tokenHash, pinHash: devicePinHash },
          });
          await audit(tx, { storeId: store.id, userId: user.id, deviceId: device.id, deviceName: device.name }, "BOOTSTRAP");
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ApiError(409, "ALREADY_INITIALIZED");
        }
        throw error;
      }
    },

    async enroll(input: z.infer<typeof enrollSchema>, tokenHash: string) {
      if (!await db.store.findUnique({ where: { singleton: true }, select: { id: true } })) {
        throw new ApiError(409, "SETUP_REQUIRED");
      }
      if ("deviceId" in input) {
        const result = await db.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM devices WHERE id = CAST(${input.deviceId} AS uuid) FOR UPDATE
          `;
          if (!locked.length) return new ApiError(404, "NOT_FOUND");
          const target = await tx.device.findUniqueOrThrow({ where: { id: input.deviceId } });
          if (target.disabledAt) return new ApiError(403, "FORBIDDEN");
          const timestamp = now();
          if (target.approvalUntil && +target.approvalUntil > timestamp) return new ApiError(429, "RATE_LIMITED");
          const activeSession = await tx.session.findFirst({
            where: { deviceId: target.id, revokedAt: null, expiresAt: { gt: new Date(timestamp) } },
            select: { id: true },
          });
          if (activeSession && target.tokenHash !== tokenHash) {
            return new ApiError(409, "DEVICE_IN_USE");
          }
          const expectedHash = target.pinHash ?? await (dummyPinHash ??= hashPassword(newToken()));
          if (!target.pinHash || !await verifyPassword(input.pin, expectedHash)) {
            const next = nextFailure(target.approvalFails, target.approvalUntil, timestamp);
            await tx.device.update({
              where: { id: target.id },
              data: { approvalFails: next.failures, approvalUntil: next.until },
            });
            await tx.auditLog.create({
              data: { storeId: target.storeId, deviceId: target.id, deviceName: target.name, event: "DEVICE_BIND_FAILED", reason: "INVALID_PIN" },
            });
            return next.until ? new ApiError(429, "RATE_LIMITED") : new ApiError(401, "INVALID_PIN");
          }
          const collision = await tx.device.findUnique({ where: { tokenHash }, select: { id: true } });
          if (collision && collision.id !== target.id) {
            await tx.session.updateMany({ where: { deviceId: collision.id, revokedAt: null }, data: { revokedAt: new Date(timestamp) } });
            await tx.device.update({ where: { id: collision.id }, data: { tokenHash: digest(newToken()) } });
          }
          await tx.session.updateMany({ where: { deviceId: target.id, revokedAt: null }, data: { revokedAt: new Date(timestamp) } });
          await tx.device.update({
            where: { id: target.id },
            data: { tokenHash, approvalFails: 0, approvalUntil: null },
          });
          await tx.auditLog.create({
            data: { storeId: target.storeId, deviceId: target.id, deviceName: target.name, event: "DEVICE_BOUND" },
          });
          return null;
        }, { timeout: 15_000 });
        if (result instanceof ApiError) throw result;
        return;
      }

      await withPassword(db, input, now, "ENROLLMENT_FAILED", async (tx, user) => {
        requirePermission(user, "device:enroll");
        const existing = await tx.device.findUnique({ where: { tokenHash } });
        if (existing) {
          if (existing.disabledAt || existing.storeId !== user.storeId) throw new ApiError(403, "FORBIDDEN");
          if (input.devicePin) {
            const pinHash = await hashPassword(input.devicePin);
            await tx.device.update({ where: { id: existing.id }, data: { pinHash } });
          }
          return;
        }
        const pinHash = input.devicePin ? await hashPassword(input.devicePin) : null;
        const device = await tx.device.create({
          data: { storeId: user.storeId, name: input.deviceName, tokenHash, pinHash },
        });
        await audit(tx, { storeId: user.storeId, userId: user.id, deviceId: device.id, deviceName: device.name }, "DEVICE_ENROLLED");
      });
    },
  };
}
