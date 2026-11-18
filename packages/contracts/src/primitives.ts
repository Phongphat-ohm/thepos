import { z } from "zod";

export const roleSchema = z.enum(["ADMIN", "MANAGER", "CASHIER", "STOCK_STAFF"]);
export const uuidSchema = z.uuid().transform((id) => id.toLowerCase());
export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/);
export const passwordSchema = z.string().min(12).max(128);
export const pinSchema = z.string().regex(/^\d{6}$/);
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const shortNameSchema = z.string().trim().min(1).max(120);
export const optionalText = (size: number) => z.string().trim().max(size).nullable().default(null)
  .transform((value) => value || null);
export const moneySchema = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
