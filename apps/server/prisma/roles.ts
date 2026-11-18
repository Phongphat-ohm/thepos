import type { PrismaClient } from "@prisma/client";
import { permissions, roleSchema, type Permission } from "@thepos/contracts";

const grantsByRole: Record<(typeof roleSchema.options)[number], readonly Permission[]> = {
  ADMIN: permissions,
  MANAGER: ["session:use", "catalog:read", "inventory:read", "inventory:approve", "sales:read", "sales:return", "sales:approve", "member:read", "member:write", "shares:write",
    "dividend:read", "payout:write", "shift:review", "report:sales", "report:profit"],
  CASHIER: ["session:use", "sales:read", "sales:checkout", "sales:return", "shift:operate"],
  STOCK_STAFF: ["session:use", "catalog:read", "catalog:write", "inventory:read", "inventory:receive", "inventory:count"],
};

export async function seedRoles(db: PrismaClient) {
  await db.$transaction(async (tx) => {
    await tx.permission.createMany({
      data: permissions.map((code) => ({ code })), skipDuplicates: true,
    });
    await tx.role.createMany({
      data: roleSchema.options.map((code) => ({ code })), skipDuplicates: true,
    });
    const roles = await tx.role.findMany({ where: { code: { in: roleSchema.options } } });
    const grants = await tx.permission.findMany({ where: { code: { in: [...permissions] } } });
    const grantByCode = new Map(grants.map((g) => [g.code, g.id]));
    for (const role of roles) {
      const expectedIds = grantsByRole[roleSchema.parse(role.code)]
        .map((code) => grantByCode.get(code))
        .filter((id): id is string => Boolean(id));
      await tx.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: expectedIds } },
      });
    }
    await tx.rolePermission.createMany({
      data: roles.flatMap((role) => grants
        .filter((permission) => grantsByRole[roleSchema.parse(role.code)].some((code) => code === permission.code))
        .map((permission) => ({ roleId: role.id, permissionId: permission.id }))),
      skipDuplicates: true,
    });
  }, { timeout: 15_000 });
}
