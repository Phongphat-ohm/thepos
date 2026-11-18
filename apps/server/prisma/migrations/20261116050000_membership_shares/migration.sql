ALTER TABLE "members"
  ADD COLUMN "address" VARCHAR(400),
  ADD COLUMN "national_id_encrypted" TEXT,
  ADD COLUMN "joined_on" DATE;

CREATE TABLE "share_accounts" (
  "id" UUID PRIMARY KEY,
  "member_id" UUID NOT NULL REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "share_value" DECIMAL(12,2) NOT NULL CHECK ("share_value" > 0)
);
CREATE UNIQUE INDEX "share_accounts_member_id_key" ON "share_accounts"("member_id");

CREATE TABLE "share_transactions" (
  "id" UUID PRIMARY KEY,
  "share_account_id" UUID NOT NULL REFERENCES "share_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "transaction_type" VARCHAR(16) NOT NULL,
  "share_quantity" INTEGER NOT NULL,
  "unit_value" DECIMAL(12,2) NOT NULL CHECK ("unit_value" > 0),
  "total_amount" DECIMAL(12,2) NOT NULL CHECK ("total_amount" = "unit_value" * "share_quantity"),
  "effective_date" DATE NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_by" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reason" VARCHAR(300) NOT NULL CHECK (length(trim("reason")) > 0),
  "transfer_id" UUID,
  CHECK (
    ("transaction_type" IN ('INITIAL', 'PURCHASE_ADD') AND "share_quantity" > 0 AND "transfer_id" IS NULL) OR
    ("transaction_type" = 'WITHDRAWAL' AND "share_quantity" < 0 AND "transfer_id" IS NULL) OR
    ("transaction_type" = 'CORRECTION' AND "share_quantity" <> 0 AND "transfer_id" IS NULL) OR
    ("transaction_type" = 'TRANSFER' AND "share_quantity" <> 0 AND "transfer_id" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "share_transactions_transfer_id_share_account_id_key" ON "share_transactions"("transfer_id", "share_account_id");
CREATE INDEX "share_transactions_share_account_id_effective_date_recorde_idx"
  ON "share_transactions"("share_account_id", "effective_date", "recorded_at", "id");

CREATE TABLE "share_requests" (
  "store_id" UUID NOT NULL,
  "key" UUID NOT NULL,
  "fingerprint" CHAR(64) NOT NULL,
  "transaction_id" UUID NOT NULL REFERENCES "share_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY ("store_id", "key")
);
CREATE UNIQUE INDEX "share_requests_transaction_id_key" ON "share_requests"("transaction_id");

CREATE FUNCTION reject_share_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Share history is append only; post a correction instead';
END;
$$;
CREATE TRIGGER share_accounts_immutable BEFORE UPDATE OR DELETE ON "share_accounts"
  FOR EACH ROW EXECUTE FUNCTION reject_share_history_change();
CREATE TRIGGER share_transactions_immutable BEFORE UPDATE OR DELETE ON "share_transactions"
  FOR EACH ROW EXECUTE FUNCTION reject_share_history_change();
