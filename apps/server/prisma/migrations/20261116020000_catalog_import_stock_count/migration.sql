CREATE TABLE "stock_counts" (
  "id" UUID PRIMARY KEY,
  "store_id" UUID NOT NULL REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "submitted_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reviewed_by_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
  "reason" VARCHAR(400) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMPTZ(3),
  "idempotency_key" UUID NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  CONSTRAINT "stock_counts_review_state" CHECK (
    ("status" = 'PENDING' AND "reviewed_by_id" IS NULL AND "reviewed_at" IS NULL)
    OR ("status" IN ('APPROVED', 'REJECTED') AND "reviewed_by_id" IS NOT NULL AND "reviewed_at" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "stock_counts_store_id_idempotency_key_key" ON "stock_counts"("store_id", "idempotency_key");
CREATE INDEX "stock_counts_store_id_created_at_id_idx" ON "stock_counts"("store_id", "created_at", "id");

CREATE TABLE "stock_adjustments" (
  "id" UUID PRIMARY KEY,
  "stock_count_id" UUID NOT NULL REFERENCES "stock_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "lot_id" UUID NOT NULL REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "expected_quantity" DECIMAL(12,3) NOT NULL CHECK ("expected_quantity" >= 0),
  "counted_quantity" DECIMAL(12,3) NOT NULL CHECK ("counted_quantity" >= 0)
);
CREATE UNIQUE INDEX "stock_adjustments_stock_count_id_lot_id_key" ON "stock_adjustments"("stock_count_id", "lot_id");
CREATE INDEX "stock_adjustments_lot_id_idx" ON "stock_adjustments"("lot_id");

ALTER TABLE "stock_movements"
  ADD COLUMN "adjustment_id" UUID REFERENCES "stock_adjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "stock_movements_adjustment_id_key" ON "stock_movements"("adjustment_id");

CREATE TABLE "catalog_imports" (
  "store_id" UUID NOT NULL REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "idempotency_key" UUID NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "created_count" INTEGER NOT NULL CHECK ("created_count" > 0),
  PRIMARY KEY ("store_id", "idempotency_key")
);
