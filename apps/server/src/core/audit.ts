import { Prisma } from "@prisma/client";
import { ApiError } from "./errors";

export type StoreActor = { storeId: string; userId: string; deviceId: string };

export function audit(
  tx: Prisma.TransactionClient,
  actor: { storeId: string; userId?: string; deviceId?: string; deviceName?: string },
  event: string,
  reason?: string,
) {
  return tx.auditLog.create({
    data: {
      storeId: actor.storeId,
      userId: actor.userId,
      deviceId: actor.deviceId,
      deviceName: actor.deviceName,
      event,
      reason,
    },
  });
}

export function translateDuplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ApiError(409, "DUPLICATE_RECORD");
  }
  throw error;
}
