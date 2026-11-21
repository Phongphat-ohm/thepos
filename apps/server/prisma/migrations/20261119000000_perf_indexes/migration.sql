-- Partial index for active FIFO/FEFO stock allocation and low-stock/expiry dashboard checks
CREATE INDEX IF NOT EXISTS "stock_lots_active_fifo_idx"
  ON "stock_lots"("product_id", "expiration_date", "received_at", "id")
  WHERE "remaining_quantity" > 0;

-- Trigram indexes for substring search on stock lots and audit logs
CREATE INDEX IF NOT EXISTS "stock_lots_lot_number_trgm_idx"
  ON "stock_lots" USING gin ("lot_number" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "audit_logs_event_trgm_idx"
  ON "audit_logs" USING gin ("event" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "audit_logs_reason_trgm_idx"
  ON "audit_logs" USING gin ("reason" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "audit_logs_device_name_trgm_idx"
  ON "audit_logs" USING gin ("device_name" gin_trgm_ops);
