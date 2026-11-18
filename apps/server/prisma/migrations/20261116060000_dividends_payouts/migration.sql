-- CreateTable
CREATE TABLE "dividend_rules" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "version" INTEGER NOT NULL,
    "formula" VARCHAR(24) NOT NULL,
    "dividend_rate" DECIMAL(7,4) NOT NULL,
    "rebate_rate" DECIMAL(7,4) NOT NULL,

    CONSTRAINT "dividend_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "rule_id" UUID NOT NULL,
    "current_run_id" UUID,
    "locked_at" TIMESTAMPTZ(3),
    "locked_by" UUID,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dividend_runs" (
    "id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "calculated_at" TIMESTAMPTZ(3) NOT NULL,
    "calculated_by" UUID NOT NULL,

    CONSTRAINT "dividend_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dividend_results" (
    "run_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "dividend_results_pkey" PRIMARY KEY ("run_id","member_id")
);

-- CreateTable
CREATE TABLE "purchase_rebate_results" (
    "run_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "purchase_rebate_results_pkey" PRIMARY KEY ("run_id","member_id")
);

-- CreateTable
CREATE TABLE "payout_obligations" (
    "id" UUID NOT NULL,
    "accounting_period_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "dividend_amount" DECIMAL(12,2) NOT NULL,
    "rebate_amount" DECIMAL(12,2) NOT NULL,
    "total_obligation" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "payout_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "payout_receipt_number" VARCHAR(50) NOT NULL,
    "payment_method" VARCHAR(16) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "transfer_reference" VARCHAR(120),
    "paid_by_user_id" UUID NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_allocations" (
    "payout_id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "payout_allocations_pkey" PRIMARY KEY ("payout_id")
);

-- CreateTable
CREATE TABLE "purchase_adjustments" (
    "id" UUID NOT NULL,
    "accounting_period_id" UUID NOT NULL,
    "ledger_id" UUID NOT NULL,
    "approved_by" UUID NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,

    CONSTRAINT "purchase_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dividend_rules_store_id_name_version_key" ON "dividend_rules"("store_id", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_current_run_id_key" ON "accounting_periods"("current_run_id");

-- CreateIndex
CREATE INDEX "accounting_periods_store_id_start_date_end_date_idx" ON "accounting_periods"("store_id", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "dividend_runs_period_id_calculated_at_idx" ON "dividend_runs"("period_id", "calculated_at");

-- CreateIndex
CREATE UNIQUE INDEX "payout_obligations_accounting_period_id_member_id_key" ON "payout_obligations"("accounting_period_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_payout_receipt_number_key" ON "payouts"("payout_receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_store_id_idempotency_key_key" ON "payouts"("store_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "payout_allocations_obligation_id_idx" ON "payout_allocations"("obligation_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_adjustments_ledger_id_key" ON "purchase_adjustments"("ledger_id");

-- AddForeignKey
ALTER TABLE "dividend_rules" ADD CONSTRAINT "dividend_rules_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "dividend_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_current_run_id_fkey" FOREIGN KEY ("current_run_id") REFERENCES "dividend_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividend_runs" ADD CONSTRAINT "dividend_runs_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividend_runs" ADD CONSTRAINT "dividend_runs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "dividend_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividend_runs" ADD CONSTRAINT "dividend_runs_calculated_by_fkey" FOREIGN KEY ("calculated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividend_results" ADD CONSTRAINT "dividend_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "dividend_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividend_results" ADD CONSTRAINT "dividend_results_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_rebate_results" ADD CONSTRAINT "purchase_rebate_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "dividend_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_rebate_results" ADD CONSTRAINT "purchase_rebate_results_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_obligations" ADD CONSTRAINT "payout_obligations_accounting_period_id_fkey" FOREIGN KEY ("accounting_period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_obligations" ADD CONSTRAINT "payout_obligations_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_paid_by_user_id_fkey" FOREIGN KEY ("paid_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_allocations" ADD CONSTRAINT "payout_allocations_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_allocations" ADD CONSTRAINT "payout_allocations_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "payout_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_adjustments" ADD CONSTRAINT "purchase_adjustments_accounting_period_id_fkey" FOREIGN KEY ("accounting_period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_adjustments" ADD CONSTRAINT "purchase_adjustments_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "member_purchase_ledgers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_adjustments" ADD CONSTRAINT "purchase_adjustments_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE dividend_rules ADD CONSTRAINT dividend_rules_values CHECK (
  version > 0 AND formula IN ('CLOSING_BALANCE', 'MONTHLY_AVERAGE')
  AND dividend_rate BETWEEN 0 AND 100 AND rebate_rate BETWEEN 0 AND 100);

ALTER TABLE accounting_periods ADD CONSTRAINT accounting_period_dates CHECK (start_date <= end_date),
  ADD CONSTRAINT accounting_period_state CHECK (
    (status = 'DRAFT' AND current_run_id IS NULL AND locked_at IS NULL AND locked_by IS NULL) OR
    (status = 'CALCULATED' AND current_run_id IS NOT NULL AND locked_at IS NULL AND locked_by IS NULL) OR
    (status IN ('APPROVED_LOCKED', 'CLOSED') AND current_run_id IS NOT NULL AND locked_at IS NOT NULL AND locked_by IS NOT NULL)
  ),
  ADD CONSTRAINT accounting_period_no_overlap EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&);

ALTER TABLE dividend_results ADD CONSTRAINT dividend_result_nonnegative CHECK (amount >= 0);
ALTER TABLE purchase_rebate_results ADD CONSTRAINT purchase_rebate_nonnegative CHECK (amount >= 0);
ALTER TABLE payout_obligations ADD CONSTRAINT payout_obligation_amounts CHECK (
  dividend_amount >= 0 AND rebate_amount >= 0 AND total_obligation > 0 AND total_obligation = dividend_amount + rebate_amount);
ALTER TABLE payouts ADD CONSTRAINT payout_amount_method CHECK (total_amount > 0 AND (
  (payment_method = 'CASH' AND transfer_reference IS NULL) OR
  (payment_method = 'BANK_TRANSFER' AND transfer_reference IS NOT NULL AND length(trim(transfer_reference)) > 0)));
ALTER TABLE payout_allocations ADD CONSTRAINT payout_allocation_positive CHECK (amount > 0);

ALTER TABLE member_purchase_ledgers DROP CONSTRAINT member_purchase_ledgers_entry;
ALTER TABLE member_purchase_ledgers ADD CONSTRAINT member_purchase_ledgers_entry CHECK (
  (transaction_type = 'SALE' AND sale_id IS NOT NULL AND sale_return_id IS NULL AND gross_amount >= 0 AND net_eligible_amount >= 0) OR
  (transaction_type = 'RETURN' AND sale_id IS NULL AND sale_return_id IS NOT NULL AND gross_amount <= 0 AND net_eligible_amount <= 0) OR
  (transaction_type = 'ADJUSTMENT' AND sale_id IS NULL AND sale_return_id IS NULL AND gross_amount = 0 AND net_eligible_amount <> 0));

CREATE FUNCTION reject_financial_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Financial history is append only';
END;
$$;

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['dividend_rules', 'dividend_runs', 'dividend_results', 'purchase_rebate_results',
    'payout_obligations', 'payouts', 'payout_allocations', 'purchase_adjustments'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_financial_history BEFORE UPDATE OR DELETE OR TRUNCATE ON %I
      FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change()', name);
  END LOOP;
END;
$$;

CREATE FUNCTION check_accounting_period_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Accounting periods retain their history'; END IF;
  IF NEW.status <> 'DRAFT' AND NOT EXISTS (SELECT 1 FROM dividend_runs r
    WHERE r.id = NEW.current_run_id AND r.period_id = NEW.id AND r.rule_id = NEW.rule_id) THEN
    RAISE EXCEPTION 'The calculation must belong to this period and rule';
  END IF;
  IF OLD.status IN ('APPROVED_LOCKED', 'CLOSED') THEN
    IF OLD.status <> 'APPROVED_LOCKED' OR NEW.status <> 'CLOSED'
      OR to_jsonb(NEW) - 'status' <> to_jsonb(OLD) - 'status' THEN
      RAISE EXCEPTION 'Approved accounting periods are immutable';
    END IF;
    IF EXISTS (SELECT 1 FROM payout_obligations o WHERE o.accounting_period_id = OLD.id
      AND o.total_obligation > COALESCE((SELECT SUM(a.amount) FROM payout_allocations a WHERE a.obligation_id = o.id), 0)) THEN
      RAISE EXCEPTION 'An accounting period with outstanding payments cannot close';
    END IF;
  ELSIF NEW.status IN ('APPROVED_LOCKED', 'CLOSED') AND NOT (
    OLD.status = 'CALCULATED' AND NEW.status = 'APPROVED_LOCKED' AND OLD.current_run_id = NEW.current_run_id) THEN
    RAISE EXCEPTION 'Only the current calculation can be approved';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER accounting_period_transition BEFORE UPDATE OR DELETE ON accounting_periods
  FOR EACH ROW EXECUTE FUNCTION check_accounting_period_transition();
CREATE TRIGGER accounting_period_no_truncate BEFORE TRUNCATE ON accounting_periods
  FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();

CREATE FUNCTION guard_dividend_result_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
  SELECT p.status INTO state FROM accounting_periods p JOIN dividend_runs r ON r.period_id = p.id
    JOIN members m ON m.id = NEW.member_id AND m.store_id = p.store_id
    WHERE r.id = NEW.run_id AND p.current_run_id = r.id FOR UPDATE OF p;
  IF state IS DISTINCT FROM 'CALCULATED' THEN RAISE EXCEPTION 'Results can only be inserted during approval'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dividend_result_insert BEFORE INSERT ON dividend_results
  FOR EACH ROW EXECUTE FUNCTION guard_dividend_result_insert();
CREATE TRIGGER rebate_result_insert BEFORE INSERT ON purchase_rebate_results
  FOR EACH ROW EXECUTE FUNCTION guard_dividend_result_insert();

CREATE FUNCTION guard_obligation_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM accounting_periods p
    JOIN dividend_results d ON d.run_id = p.current_run_id AND d.member_id = NEW.member_id AND d.amount = NEW.dividend_amount
    JOIN purchase_rebate_results b ON b.run_id = p.current_run_id AND b.member_id = NEW.member_id AND b.amount = NEW.rebate_amount
    WHERE p.id = NEW.accounting_period_id AND p.status = 'CALCULATED' FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'An obligation must match the current results at approval'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER obligation_insert BEFORE INSERT ON payout_obligations
  FOR EACH ROW EXECUTE FUNCTION guard_obligation_insert();

CREATE FUNCTION check_payout_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE limit_amount numeric;
DECLARE already_paid numeric;
BEGIN
  SELECT o.total_obligation INTO limit_amount FROM payout_obligations o
    JOIN accounting_periods p ON p.id = o.accounting_period_id
    JOIN payouts f ON f.id = NEW.payout_id AND f.store_id = p.store_id AND f.total_amount = NEW.amount
    WHERE o.id = NEW.obligation_id AND p.status = 'APPROVED_LOCKED' FOR UPDATE OF o;
  IF limit_amount IS NULL THEN RAISE EXCEPTION 'Payout allocation requires an approved payable obligation'; END IF;
  SELECT COALESCE(SUM(a.amount), 0) INTO already_paid FROM payout_allocations a WHERE a.obligation_id = NEW.obligation_id;
  IF already_paid + NEW.amount > limit_amount THEN RAISE EXCEPTION 'Payout exceeds the remaining obligation'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payout_allocation_insert BEFORE INSERT ON payout_allocations
  FOR EACH ROW EXECUTE FUNCTION check_payout_allocation();

CREATE FUNCTION require_payout_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payout_allocations WHERE payout_id = NEW.id) THEN
    RAISE EXCEPTION 'Payout must be allocated in the same transaction';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER payout_allocated AFTER INSERT ON payouts DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION require_payout_allocation();

