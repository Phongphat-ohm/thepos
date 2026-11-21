import { z } from "zod";
import { credentialsFields, loginSchema } from "../auth";
import { passwordSchema, pinSchema, shortNameSchema, uuidSchema } from "../shared/primitives";

export const bootstrapSchema = z.strictObject({
  ...credentialsFields,
  password: passwordSchema,
  pin: pinSchema,
  devicePin: pinSchema.optional(),
  secret: z.string().min(32).max(256),
  storeName: shortNameSchema,
  storeAddress: z.string().trim().max(400).optional(),
  taxId: z.string().trim().regex(/^\d{13}$/).optional(),
  deviceName: shortNameSchema,
  displayName: shortNameSchema,
});

export const enrollNewSchema = z.strictObject({
  ...credentialsFields,
  deviceName: shortNameSchema,
  devicePin: pinSchema.optional(),
});

export const bindDeviceSchema = z.strictObject({
  ...credentialsFields,
  deviceId: uuidSchema,
  pin: pinSchema,
});

export const enrollSchema = z.union([enrollNewSchema, bindDeviceSchema]);

export const verifyAdminSchema = loginSchema;

export const enrollableDeviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  hasPin: z.boolean(),
  inUse: z.boolean().default(false),
  activeUser: z.string().nullable().default(null),
});
export type EnrollableDevice = z.infer<typeof enrollableDeviceSchema>;

export const healthSchema = z.object({ ready: z.literal(true) });
export const setupStatusSchema = z.object({ initialized: z.boolean(), registered: z.boolean() });
export const verifyConnectionSchema = z.strictObject({
  serverKey: z.string().trim().min(4).max(128),
});
