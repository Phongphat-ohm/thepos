import { Prisma, type PrismaClient } from "@prisma/client";

// Keep only the server credentials and the system grants needed for first-time setup.
const SYSTEM_MODELS = new Set(["ServerSecurityState", "Role", "Permission", "RolePermission"]);
export const resetTables = Prisma.dmmf.datamodel.models
  .filter((model) => !SYSTEM_MODELS.has(model.name))
  .map((model) => model.dbName ?? model.name);

export async function resetServerData(db: PrismaClient): Promise<void> {
  // Identifiers come exclusively from the generated schema, never from a request.
  const tables = resetTables.map((name) => `"public"."${name.replaceAll('"', '""')}"`);
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
    await tx.$executeRawUnsafe(`LOCK TABLE ${tables.join(", ")} IN ACCESS EXCLUSIVE MODE`);
    // Append-only guards normally forbid truncation. DDL and data roll back together
    // on any failure; foreign-key triggers stay enabled throughout the reset.
    for (const table of tables) {
      await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    }
    await tx.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY`);
    for (const table of tables) {
      await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    }
  }, { timeout: 30_000 });
}
