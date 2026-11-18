-- CreateTable
CREATE TABLE "server_security_state" (
    "id" UUID NOT NULL,
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "connect_key_encrypted" TEXT NOT NULL,
    "connect_key_hash" CHAR(64) NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "server_security_state_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "server_security_state_singleton_true" CHECK ("singleton")
);

CREATE UNIQUE INDEX "server_security_state_singleton_key" ON "server_security_state"("singleton");

-- AlterTable: user manager approval rate limiting
ALTER TABLE "users" ADD COLUMN "approval_fails" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "approval_until" TIMESTAMPTZ(3);

-- AlterTable: explicit web device marker
ALTER TABLE "devices" ADD COLUMN "is_web_device" BOOLEAN NOT NULL DEFAULT false;
UPDATE "devices" SET "is_web_device" = true WHERE "name" = 'เว็บเบราว์เซอร์' AND "pin_hash" IS NULL;

-- AlterTable: device name snapshot on audit logs
ALTER TABLE "audit_logs" ADD COLUMN "device_name" VARCHAR(120);

-- Performance & Partial Indexes
CREATE INDEX IF NOT EXISTS "stock_movements_created_at_idx" ON "stock_movements"("created_at");
CREATE INDEX IF NOT EXISTS "member_purchase_ledgers_recorded_at_member_id_idx" ON "member_purchase_ledgers"("recorded_at", "member_id");
CREATE INDEX IF NOT EXISTS "sessions_active_device_idx" ON "sessions"("device_id", "created_at" DESC) WHERE "revoked_at" IS NULL;
