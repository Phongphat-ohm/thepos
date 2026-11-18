CREATE SEQUENCE "sale_invoice_sequence" AS BIGINT;

CREATE TABLE "sales" (
  "id" UUID PRIMARY KEY,
  "store_id" UUID NOT NULL REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "cashier_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "terminal_id" UUID NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "invoice_number" VARCHAR(50) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'COMPLETED',
  "subtotal" DECIMAL(12,2) NOT NULL CHECK ("subtotal" >= 0),
  "discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK ("discount_total" >= 0),
  "tax_total" DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK ("tax_total" >= 0),
  "net_total" DECIMAL(12,2) NOT NULL CHECK ("net_total" >= 0),
  "completed_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX "sales_invoice_number_key" ON "sales"("invoice_number");
CREATE INDEX "sales_store_id_completed_at_id_idx" ON "sales"("store_id", "completed_at", "id");

CREATE TABLE "sale_items" (
  "id" UUID PRIMARY KEY,
  "sale_id" UUID NOT NULL REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "product_id" UUID NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "line_number" INTEGER NOT NULL CHECK ("line_number" > 0),
  "sku" VARCHAR(50) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "unit" VARCHAR(50) NOT NULL,
  "base_unit" VARCHAR(50) NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL CHECK ("quantity" > 0),
  "base_quantity" DECIMAL(12,3) NOT NULL CHECK ("base_quantity" > 0),
  "base_price" DECIMAL(12,2) NOT NULL CHECK ("base_price" >= 0),
  "line_total" DECIMAL(12,2) NOT NULL CHECK ("line_total" >= 0),
  "untracked_unit_cost" DECIMAL(14,4) CHECK ("untracked_unit_cost" >= 0)
);
CREATE UNIQUE INDEX "sale_items_sale_id_line_number_key" ON "sale_items"("sale_id", "line_number");

CREATE TABLE "sale_item_lot_allocations" (
  "id" UUID PRIMARY KEY,
  "sale_item_id" UUID NOT NULL REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "lot_id" UUID NOT NULL REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "quantity_allocated" DECIMAL(12,3) NOT NULL CHECK ("quantity_allocated" > 0),
  "unit_cost_snapshot" DECIMAL(14,4) NOT NULL CHECK ("unit_cost_snapshot" >= 0)
);
CREATE UNIQUE INDEX "sale_item_lot_allocations_sale_item_id_lot_id_key" ON "sale_item_lot_allocations"("sale_item_id", "lot_id");

CREATE TABLE "sale_payments" (
  "id" UUID PRIMARY KEY,
  "sale_id" UUID NOT NULL REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "line_number" INTEGER NOT NULL CHECK ("line_number" > 0),
  "method" VARCHAR(16) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" > 0),
  "tendered" DECIMAL(12,2),
  "change" DECIMAL(12,2),
  "reference" VARCHAR(120),
  CONSTRAINT "sale_payments_tender" CHECK (
    ("method" = 'CASH' AND "reference" IS NULL AND "tendered" IS NOT NULL AND "change" IS NOT NULL
      AND "change" >= 0 AND "tendered" = "amount" + "change")
    OR ("method" IN ('TRANSFER', 'PROMPTPAY') AND "reference" IS NOT NULL AND "tendered" IS NULL AND "change" IS NULL)
  )
);
CREATE UNIQUE INDEX "sale_payments_sale_id_line_number_key" ON "sale_payments"("sale_id", "line_number");

CREATE TABLE "sale_requests" (
  "store_id" UUID NOT NULL REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "idempotency_key" UUID NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "sale_id" UUID NOT NULL REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY ("store_id", "idempotency_key")
);
CREATE UNIQUE INDEX "sale_requests_sale_id_key" ON "sale_requests"("sale_id");

ALTER TABLE "stock_movements"
  ADD COLUMN "sale_item_id" UUID REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "stock_movements_sale_item_id_idx" ON "stock_movements"("sale_item_id");

CREATE TRIGGER sale_item_lot_allocations_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON "sale_item_lot_allocations"
FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_log_changes();
