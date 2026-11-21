import { z } from "zod";

export const apiPrefix = "/api/v1";

export const foundationPermissionSchema = z.enum(["session:use", "device:enroll"]);

export const catalogPermissionSchema = z.enum([
  "catalog:read",
  "catalog:write",
  "inventory:read",
  "inventory:receive",
  "inventory:count",
  "inventory:approve",
]);

export const salesPermissionSchema = z.enum([
  "sales:read",
  "sales:checkout",
  "sales:return",
  "sales:approve",
  "member:write",
]);

export const capabilitySchema = z.enum([
  ...catalogPermissionSchema.options,
  ...salesPermissionSchema.options,
  "member:read",
  "shares:write",
  "dividend:read",
  "dividend:write",
  "dividend:approve",
  "payout:write",
  "shift:operate",
  "shift:review",
  "report:sales",
  "report:profit",
  "settings:manage",
]);

export const permissions = [...foundationPermissionSchema.options, ...capabilitySchema.options] as const;
export const permissionSchema = z.enum(permissions);
export type Permission = z.infer<typeof permissionSchema>;
