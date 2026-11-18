import type { Prisma } from "@prisma/client";

// Sales and returns can book together. Closing a period waits for those postings to commit.
export async function lockFinance(tx: Prisma.TransactionClient, storeId: string, mode: "exclusive" | "posting" = "exclusive") {
  const key = "finance:" + storeId;
  if (mode === "posting") {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`;
  } else {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}
