ALTER TABLE "devices" ADD COLUMN "pin_hash" TEXT;
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_device_id_fkey";
