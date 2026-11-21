import { z } from "zod";
import { capabilitySchema, foundationPermissionSchema } from "../shared/permissions";
import { passwordSchema, pinSchema, roleSchema, tokenSchema, usernameSchema } from "../shared/primitives";

export const credentialsFields = {
  username: usernameSchema,
  password: z.string().min(1).max(128),
};

export const loginSchema = z.strictObject(credentialsFields);
export const unlockSchema = z.strictObject({ pin: pinSchema });
export const changePasswordSchema = z
  .strictObject({
    currentPassword: credentialsFields.password,
    newPassword: passwordSchema,
  })
  .refine(({ currentPassword, newPassword }) => currentPassword !== newPassword);

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
