import { z } from "zod";
import {
  passwordSchema,
  pinSchema,
  roleSchema,
  shortNameSchema as nameSchema,
  tokenSchema,
  usernameSchema,
  uuidSchema,
} from "./primitives";

export { passwordSchema, pinSchema, roleSchema, tokenSchema, usernameSchema, uuidSchema };
export const apiPrefix = "/api/v1";
export const foundationPermissionSchema = z.enum(["session:use", "device:enroll"]);
export const catalogPermissionSchema = z.enum([
  "catalog:read", "catalog:write", "inventory:read", "inventory:receive", "inventory:count", "inventory:approve",
]);
export const salesPermissionSchema = z.enum(["sales:read", "sales:checkout", "sales:return", "sales:approve", "member:write"]);
export const capabilitySchema = z.enum([...catalogPermissionSchema.options, ...salesPermissionSchema.options,
  "member:read", "shares:write", "dividend:read", "dividend:write", "dividend:approve", "payout:write",
  "shift:operate", "shift:review", "report:sales", "report:profit", "settings:manage"]);
export const permissions = [...foundationPermissionSchema.options, ...capabilitySchema.options] as const;
export const permissionSchema = z.enum(permissions);
export type Permission = z.infer<typeof permissionSchema>;

const credentials = { username: usernameSchema, password: z.string().min(1).max(128) };

export const bootstrapSchema = z.strictObject({
  ...credentials,
  password: passwordSchema,
  pin: pinSchema,
  devicePin: pinSchema.optional(),
  secret: z.string().min(32).max(256),
  storeName: nameSchema,
  storeAddress: z.string().trim().max(400).optional(),
  taxId: z.string().trim().regex(/^\d{13}$/).optional(),
  deviceName: nameSchema,
  displayName: nameSchema,
});
export const enrollNewSchema = z.strictObject({
  ...credentials,
  deviceName: nameSchema,
  devicePin: pinSchema.optional(),
});
export const bindDeviceSchema = z.strictObject({
  deviceId: uuidSchema,
  pin: pinSchema,
});
export const enrollSchema = z.union([enrollNewSchema, bindDeviceSchema]);
export const enrollableDeviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  hasPin: z.boolean(),
  inUse: z.boolean().default(false),
  activeUser: z.string().nullable().default(null),
});
export type EnrollableDevice = z.infer<typeof enrollableDeviceSchema>;
export const loginSchema = z.strictObject(credentials);
export const unlockSchema = z.strictObject({ pin: pinSchema });
export const changePasswordSchema = z.strictObject({
  currentPassword: credentials.password,
  newPassword: passwordSchema,
}).refine(({ currentPassword, newPassword }) => currentPassword !== newPassword);
export const healthSchema = z.object({ ready: z.literal(true) });
export const setupStatusSchema = z.object({ initialized: z.boolean(), registered: z.boolean() });
export const profileSchema = z.object({
  user: z.object({ id: z.uuid(), username: z.string(), name: z.string(), roles: z.array(roleSchema) }),
  store: z.object({ id: z.uuid(), name: z.string() }),
  device: z.object({ id: z.uuid(), name: z.string(), isWebDevice: z.boolean().optional() }),
  permissions: z.array(foundationPermissionSchema),
  capabilities: z.array(capabilitySchema).optional(),
});
export type Profile = z.infer<typeof profileSchema>;
export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: tokenSchema,
  profile: profileSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export const verifyConnectionSchema = z.strictObject({
  serverKey: z.string().trim().min(4).max(128),
});

export const errorCodeSchema = z.enum([
  "INVALID_INPUT", "INVALID_CREDENTIALS", "INVALID_BOOTSTRAP_SECRET", "INVALID_SERVER_KEY", "DEVICE_REQUIRED",
  "SESSION_REQUIRED", "SESSION_LOCKED", "INVALID_PIN", "RATE_LIMITED", "FORBIDDEN",
  "ALREADY_INITIALIZED", "SETUP_REQUIRED", "NOT_FOUND", "UNAVAILABLE",
  "NETWORK_ERROR", "INVALID_SERVER_URL", "SECURE_STORAGE_ERROR",
  "DUPLICATE_RECORD", "INVALID_REFERENCE", "STOCK_CONFIGURATION_LOCKED", "SUPPLIER_INACTIVE",
  "INVALID_QUANTITY", "EXPIRATION_REQUIRED", "IDEMPOTENCY_CONFLICT", "INSUFFICIENT_STOCK",
  "STOCK_COUNT_STALE", "STOCK_COUNT_CONFLICT",
  "PRICE_CHANGED", "PAYMENT_MISMATCH",
  "INVALID_DISCOUNT", "APPROVAL_REQUIRED", "HELD_CONFLICT", "RETURN_LIMIT", "PRINT_FAILED",
  "MEMBER_KEY_REQUIRED", "SHARE_ACCOUNT_CONFLICT", "INSUFFICIENT_SHARES", "INVALID_SHARE_DATE",
  "PERIOD_CONFLICT", "PERIOD_LOCKED", "INVALID_PERIOD_DATES", "PREVIEW_STALE", "PAYOUT_LIMIT", "FINANCIAL_LIMIT",
  "SHIFT_REQUIRED", "SHIFT_CONFLICT", "SHIFT_STALE", "CASH_LIMIT",
  "DEVICE_IN_USE", "RECORD_IN_USE",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export * from "./catalog";
export * from "./sales";
export * from "./members";
export * from "./dividends";
export * from "./operations";
export * from "./settings";
