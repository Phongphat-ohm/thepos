-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "category_name" VARCHAR(120);

-- CreateTable
CREATE TABLE "cash_shifts" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "cashier_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "opening_float" DECIMAL(12,2) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "expected_cash" DECIMAL(12,2),
    "counted_cash" DECIMAL(12,2),
    "variance" DECIMAL(12,2),
    "variance_limit" DECIMAL(12,2),
    "approved_by" UUID,

    CONSTRAINT "cash_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(300),
    "request_key" UUID,
    "actor_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "sale_id" UUID,
    "return_id" UUID,
    "payout_id" UUID,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_shifts_store_id_opened_at_idx" ON "cash_shifts"("store_id", "opened_at");

-- CreateIndex
CREATE INDEX "cash_shifts_device_id_closed_at_idx" ON "cash_shifts"("device_id", "closed_at");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_request_key_key" ON "cash_movements"("request_key");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_sale_id_key" ON "cash_movements"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_return_id_key" ON "cash_movements"("return_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_payout_id_key" ON "cash_movements"("payout_id");

-- CreateIndex
CREATE INDEX "cash_movements_shift_id_recorded_at_id_idx" ON "cash_movements"("shift_id", "recorded_at", "id");

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "cash_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "sale_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX cash_shifts_one_open_drawer ON cash_shifts(device_id) WHERE closed_at IS NULL;
ALTER TABLE cash_shifts ADD CONSTRAINT cash_shift_reconciliation CHECK (opening_float >= 0 AND (
  (closed_at IS NULL AND num_nonnulls(expected_cash, counted_cash, variance, variance_limit, approved_by) = 0) OR
  (closed_at >= opened_at AND num_nonnulls(expected_cash, counted_cash, variance, variance_limit) = 4
    AND counted_cash >= 0 AND variance_limit >= 0 AND variance = counted_cash - expected_cash
    AND (abs(variance) <= variance_limit OR approved_by IS NOT NULL))));
ALTER TABLE cash_movements ADD CONSTRAINT cash_movement_source CHECK (amount > 0 AND (
  (kind IN ('CASH_IN', 'CASH_DROP', 'PETTY_CASH') AND request_key IS NOT NULL AND length(trim(reason)) > 0
    AND reason IS NOT NULL AND num_nonnulls(sale_id, return_id, payout_id) = 0) OR
  (request_key IS NULL AND num_nonnulls(sale_id, return_id, payout_id) = 1 AND (
    (kind = 'SALE' AND sale_id IS NOT NULL) OR (kind = 'REFUND' AND return_id IS NOT NULL) OR
    (kind = 'PAYOUT_OUT' AND payout_id IS NOT NULL)))));

CREATE TRIGGER cash_movements_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON cash_movements
  FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();

CREATE FUNCTION guard_cash_shift_close() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE booked numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Cash shifts retain their history'; END IF;
  IF OLD.closed_at IS NOT NULL OR NEW.closed_at IS NULL OR
    ROW(OLD.id, OLD.store_id, OLD.device_id, OLD.cashier_id, OLD.opening_float, OLD.opened_at) IS DISTINCT FROM
    ROW(NEW.id, NEW.store_id, NEW.device_id, NEW.cashier_id, NEW.opening_float, NEW.opened_at) THEN
    RAISE EXCEPTION 'Only an open shift can be closed';
  END IF;
  SELECT COALESCE(SUM(CASE WHEN kind IN ('SALE', 'CASH_IN') THEN amount ELSE -amount END),0)
    INTO booked FROM cash_movements WHERE shift_id = OLD.id;
  IF NEW.expected_cash IS DISTINCT FROM NEW.opening_float + booked THEN RAISE EXCEPTION 'Shift cash must match its movements'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cash_shift_close BEFORE UPDATE OR DELETE ON cash_shifts
  FOR EACH ROW EXECUTE FUNCTION guard_cash_shift_close();

CREATE FUNCTION require_open_cash_shift() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM cash_shifts s WHERE s.id = NEW.shift_id
    AND (s.cashier_id = NEW.actor_id OR (NEW.kind = 'PAYOUT_OUT' AND EXISTS (
      SELECT 1 FROM payouts f WHERE f.id=NEW.payout_id AND f.store_id=s.store_id AND f.paid_by_user_id=NEW.actor_id
        AND f.payment_method='CASH' AND f.total_amount=NEW.amount)))
    AND s.closed_at IS NULL AND s.opened_at <= NEW.recorded_at FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cash movements require an open shift owned by the operator'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cash_movement_open_shift BEFORE INSERT ON cash_movements
  FOR EACH ROW EXECUTE FUNCTION require_open_cash_shift();

