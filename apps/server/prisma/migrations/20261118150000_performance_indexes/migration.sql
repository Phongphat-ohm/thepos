CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs"("user_id");
CREATE INDEX IF NOT EXISTS "sales_cashier_id_idx" ON "sales"("cashier_id");
CREATE INDEX IF NOT EXISTS "sales_terminal_id_idx" ON "sales"("terminal_id");
CREATE INDEX IF NOT EXISTS "payouts_store_id_paid_at_id_idx" ON "payouts"("store_id", "paid_at", "id");
CREATE INDEX IF NOT EXISTS "held_sales_store_id_consumed_updated_at_id_idx" ON "held_sales"("store_id", "consumed", "updated_at", "id");
CREATE INDEX IF NOT EXISTS "sale_returns_store_id_created_at_id_idx" ON "sale_returns"("store_id", "created_at", "id");
CREATE INDEX IF NOT EXISTS "cash_shifts_cashier_id_idx" ON "cash_shifts"("cashier_id");
