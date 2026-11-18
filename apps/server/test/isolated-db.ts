import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function isolatedDatabase() {
  const connection = process.env.TEST_DATABASE_URL;
  if (!connection) throw new Error("TEST_DATABASE_URL must point to PostgreSQL with CREATEDB permission.");
  const database = "thepos_test_" + crypto.randomUUID().replaceAll("-", "");
  const target = new URL(connection);
  target.pathname = "/" + database;
  const db = new PrismaClient({ datasourceUrl: target.toString() });
  const admin = new PrismaClient({ datasourceUrl: connection });
  let created = false;

  return {
    db,
    async create() {
      // The name comes only from a generated UUID, with no external input.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
      created = true;
    },
    migrate() {
      const manifest = createRequire(import.meta.url).resolve("prisma/package.json");
      const prismaCli = join(dirname(manifest), "build/index.js");
      execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: { ...process.env, DATABASE_URL: target.toString() },
      });
    },
    async drop() {
      await db.$disconnect();
      try {
        if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${database}"`);
      } finally {
        await admin.$disconnect();
      }
    },
  };
}
