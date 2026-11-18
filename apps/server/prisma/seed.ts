import { PrismaClient } from "@prisma/client";
import { seedRoles } from "./roles";

const db = new PrismaClient();
try {
  await seedRoles(db);
} finally {
  await db.$disconnect();
}
