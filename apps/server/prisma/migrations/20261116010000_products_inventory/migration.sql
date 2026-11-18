-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "sku" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "base_unit" VARCHAR(50) NOT NULL,
    "cost_price" DECIMAL(14,4) NOT NULL,
    "regular_price" DECIMAL(12,2) NOT NULL,
    "member_price" DECIMAL(12,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "track_stock" BOOLEAN NOT NULL DEFAULT true,
    "track_expiration" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_barcodes" (
    "code" VARCHAR(100) NOT NULL,
    "product_id" UUID NOT NULL,

    CONSTRAINT "product_barcodes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "product_unit_conversions" (
    "product_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "multiplier" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "product_unit_conversions_pkey" PRIMARY KEY ("product_id","name")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_lots" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "lot_number" VARCHAR(100) NOT NULL,
    "initial_quantity" DECIMAL(12,3) NOT NULL,
    "remaining_quantity" DECIMAL(12,3) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "expiration_date" DATE,
    "received_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_store_id_name_key" ON "categories"("store_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_store_id_name_key" ON "suppliers"("store_id", "name");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_store_id_sku_key" ON "products"("store_id", "sku");

-- CreateIndex
CREATE INDEX "product_barcodes_product_id_idx" ON "product_barcodes"("product_id");

-- CreateIndex
CREATE INDEX "goods_receipts_store_id_received_at_idx" ON "goods_receipts"("store_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_store_id_idempotency_key_key" ON "goods_receipts"("store_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "stock_lots_product_id_expiration_date_received_at_id_idx" ON "stock_lots"("product_id", "expiration_date", "received_at", "id");

-- CreateIndex
CREATE INDEX "stock_lots_goods_receipt_id_idx" ON "stock_lots"("goods_receipt_id");

-- CreateIndex
CREATE INDEX "stock_movements_lot_id_created_at_idx" ON "stock_movements"("lot_id", "created_at");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_unit_conversions" ADD CONSTRAINT "product_unit_conversions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "products"
  ADD CONSTRAINT "products_nonnegative_prices" CHECK ("cost_price" >= 0 AND "regular_price" >= 0 AND "member_price" >= 0),
  ADD CONSTRAINT "products_stock_tracking" CHECK ("track_stock" OR NOT "track_expiration");

ALTER TABLE "product_unit_conversions"
  ADD CONSTRAINT "product_units_positive_multiplier" CHECK ("multiplier" > 0);

ALTER TABLE "stock_lots"
  ADD CONSTRAINT "stock_lots_nonnegative_remaining" CHECK ("remaining_quantity" >= 0),
  ADD CONSTRAINT "stock_lots_positive_initial" CHECK ("initial_quantity" > 0),
  ADD CONSTRAINT "stock_lots_nonnegative_cost" CHECK ("unit_cost" >= 0);

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_nonzero_quantity" CHECK ("quantity" <> 0);

CREATE OR REPLACE FUNCTION forbid_audit_log_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER stock_movements_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON "stock_movements"
FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_log_changes();
