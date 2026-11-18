import type { Prisma } from "@prisma/client";
import type { ManagerApproval } from "@thepos/contracts";
import { ApiError } from "../errors";
import { hashPassword, newToken, verifyPassword } from "../security";
import { audit, nextFailure } from "./auth";
import type { StoreActor } from "./catalog";

let dummyHash: Promise<string> | undefined;

function getDummyHash() {
  dummyHash ??= hashPassword(newToken());
  return dummyHash;
}

export async function managerApproval(
  tx: Prisma.TransactionClient, actor: StoreActor, approval: ManagerApproval | undefined, now: number,
  purpose: "sales" | "shifts" = "sales",
) {
  if (!approval) return new ApiError(403, "APPROVAL_REQUIRED");
  const requiredPermission = purpose === "sales" ? "sales:approve" : "shift:review";
  const failureEvent = purpose === "sales" ? "SALE_APPROVAL_FAILED" : "SHIFT_APPROVAL_FAILED";

  const candidate = await tx.user.findFirst({
    where: { username: approval.username, storeId: actor.storeId },
    select: { id: true },
  });
  if (!candidate) {
    await verifyPassword(approval.pin, await getDummyHash());
    await audit(tx, actor, failureEvent, `INVALID_PIN:${approval.username}`);
    return new ApiError(401, "INVALID_PIN");
  }

  await tx.$queryRaw`SELECT id FROM users WHERE id = CAST(${candidate.id} AS uuid) FOR UPDATE`;
  const manager = await tx.user.findUnique({
    where: { id: candidate.id },
    select: {
      id: true,
      disabledAt: true,
      pinHash: true,
      loginUntil: true,
      approvalFails: true,
      approvalUntil: true,
      roles: {
        select: {
          role: {
            select: {
              permissions: { select: { permission: { select: { code: true } } } },
            },
          },
        },
      },
    },
  });

  const hasPermission = manager?.roles.some(({ role }) =>
    role.permissions.some(({ permission }) => permission.code === requiredPermission),
  ) ?? false;

  if (!manager || manager.disabledAt || !hasPermission) {
    await verifyPassword(approval.pin, await getDummyHash());
    await audit(tx, actor, failureEvent, `INVALID_PIN:${approval.username}`);
    return new ApiError(401, "INVALID_PIN");
  }

  if (manager.id === actor.userId) {
    return new ApiError(403, "FORBIDDEN");
  }

  if ((manager.approvalUntil && +manager.approvalUntil > now) || (manager.loginUntil && +manager.loginUntil > now)) {
    return new ApiError(429, "RATE_LIMITED");
  }

  if (!await verifyPassword(approval.pin, manager.pinHash)) {
    const next = nextFailure(manager.approvalFails, manager.approvalUntil, now);
    await tx.user.update({
      where: { id: manager.id },
      data: { approvalFails: next.failures, approvalUntil: next.until },
    });
    await audit(tx, actor, failureEvent, `INVALID_PIN:${approval.username}`);
    return next.until ? new ApiError(429, "RATE_LIMITED") : new ApiError(401, "INVALID_PIN");
  }

  if (manager.approvalFails || manager.approvalUntil) {
    await tx.user.update({
      where: { id: manager.id },
      data: { approvalFails: 0, approvalUntil: null },
    });
  }
  return manager.id;
}

export async function lockSaleRequest(tx: Prisma.TransactionClient, scope: string, actor: StoreActor, key: string) {
  const lockKey = scope + "/" + actor.storeId + "/" + key.toLowerCase();
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}
