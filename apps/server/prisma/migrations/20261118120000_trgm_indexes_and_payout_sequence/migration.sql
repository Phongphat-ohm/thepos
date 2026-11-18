CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SEQUENCE IF NOT EXISTS "payout_receipt_sequence" AS BIGINT;

CREATE INDEX IF NOT EXISTS "products_name_trgm_idx" ON "products" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "products_sku_trgm_idx" ON "products" USING gin ("sku" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "members_name_trgm_idx" ON "members" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "members_number_trgm_idx" ON "members" USING gin ("number" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "sales_invoice_number_trgm_idx" ON "sales" USING gin ("invoice_number" gin_trgm_ops);
