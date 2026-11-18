-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "approval_fails" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "approval_until" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "sale_item_lot_allocations" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "bill_discount_share" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "line_discount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "bill_discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "cashier_name" VARCHAR(120),
ADD COLUMN     "member_id" UUID,
ADD COLUMN     "member_name" VARCHAR(120),
ADD COLUMN     "store_name" VARCHAR(120);

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "return_allocation_id" UUID;

-- CreateTable
CREATE TABLE "members" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "number" VARCHAR(50) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "barcode" VARCHAR(100),
    "phone" VARCHAR(10),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_purchase_ledgers" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "sale_id" UUID,
    "sale_return_id" UUID,
    "transaction_type" VARCHAR(12) NOT NULL,
    "gross_amount" DECIMAL(12,2) NOT NULL,
    "net_eligible_amount" DECIMAL(12,2) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_purchase_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "held_sales" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "cashier_id" UUID NOT NULL,
    "terminal_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "held" BOOLEAN NOT NULL DEFAULT true,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "note" VARCHAR(100) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "held_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_decisions" (
    "id" UUID NOT NULL,
    "manager_id" UUID NOT NULL,
    "sale_id" UUID,
    "sale_return_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_returns" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "cashier_id" UUID NOT NULL,
    "terminal_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "net_total" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return_items" (
    "id" UUID NOT NULL,
    "sale_return_id" UUID NOT NULL,
    "sale_item_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "base_quantity" DECIMAL(12,3) NOT NULL,
    "refund" DECIMAL(12,2) NOT NULL,
    "gross_refund" DECIMAL(12,2) NOT NULL,
    "disposition" VARCHAR(10) NOT NULL,

    CONSTRAINT "sale_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return_allocations" (
    "id" UUID NOT NULL,
    "sale_return_item_id" UUID NOT NULL,
    "sale_allocation_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "sale_return_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_refunds" (
    "id" UUID NOT NULL,
    "sale_return_id" UUID NOT NULL,
    "sale_payment_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "sale_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "members_store_id_phone_idx" ON "members"("store_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "members_store_id_number_key" ON "members"("store_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "members_store_id_barcode_key" ON "members"("store_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "member_purchase_ledgers_sale_id_key" ON "member_purchase_ledgers"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_purchase_ledgers_sale_return_id_key" ON "member_purchase_ledgers"("sale_return_id");

-- CreateIndex
CREATE INDEX "member_purchase_ledgers_member_id_recorded_at_idx" ON "member_purchase_ledgers"("member_id", "recorded_at");

-- CreateIndex
CREATE INDEX "held_sales_store_id_updated_at_idx" ON "held_sales"("store_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "approval_decisions_sale_id_key" ON "approval_decisions"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_decisions_sale_return_id_key" ON "approval_decisions"("sale_return_id");

-- CreateIndex
CREATE INDEX "sale_returns_sale_id_created_at_idx" ON "sale_returns"("sale_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_store_id_idempotency_key_key" ON "sale_returns"("store_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "sale_return_items_sale_item_id_idx" ON "sale_return_items"("sale_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_return_items_sale_return_id_sale_item_id_key" ON "sale_return_items"("sale_return_id", "sale_item_id");

-- CreateIndex
CREATE INDEX "sale_return_allocations_sale_allocation_id_idx" ON "sale_return_allocations"("sale_allocation_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_return_allocations_sale_return_item_id_sale_allocation_key" ON "sale_return_allocations"("sale_return_item_id", "sale_allocation_id");

-- CreateIndex
CREATE INDEX "sale_refunds_sale_payment_id_idx" ON "sale_refunds"("sale_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_refunds_sale_return_id_sale_payment_id_key" ON "sale_refunds"("sale_return_id", "sale_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_return_allocation_id_key" ON "stock_movements"("return_allocation_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_return_allocation_id_fkey" FOREIGN KEY ("return_allocation_id") REFERENCES "sale_return_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_purchase_ledgers" ADD CONSTRAINT "member_purchase_ledgers_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_purchase_ledgers" ADD CONSTRAINT "member_purchase_ledgers_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_purchase_ledgers" ADD CONSTRAINT "member_purchase_ledgers_sale_return_id_fkey" FOREIGN KEY ("sale_return_id") REFERENCES "sale_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_sales" ADD CONSTRAINT "held_sales_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_sale_return_id_fkey" FOREIGN KEY ("sale_return_id") REFERENCES "sale_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_sale_return_id_fkey" FOREIGN KEY ("sale_return_id") REFERENCES "sale_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_allocations" ADD CONSTRAINT "sale_return_allocations_sale_return_item_id_fkey" FOREIGN KEY ("sale_return_item_id") REFERENCES "sale_return_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_allocations" ADD CONSTRAINT "sale_return_allocations_sale_allocation_id_fkey" FOREIGN KEY ("sale_allocation_id") REFERENCES "sale_item_lot_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_sale_return_id_fkey" FOREIGN KEY ("sale_return_id") REFERENCES "sale_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_sale_payment_id_fkey" FOREIGN KEY ("sale_payment_id") REFERENCES "sale_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "held_sales" ADD CONSTRAINT "held_sales_revision" CHECK ("revision" > 0 AND NOT ("consumed" AND "held"));
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_target" CHECK (num_nonnulls("sale_id", "sale_return_id") = 1);
ALTER TABLE "member_purchase_ledgers" ADD CONSTRAINT "member_purchase_ledgers_entry" CHECK (
  ("transaction_type" = 'SALE' AND "sale_id" IS NOT NULL AND "sale_return_id" IS NULL
    AND "gross_amount" >= 0 AND "net_eligible_amount" >= 0)
  OR ("transaction_type" = 'RETURN' AND "sale_id" IS NULL AND "sale_return_id" IS NOT NULL
    AND "gross_amount" <= 0 AND "net_eligible_amount" <= 0)
);
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_amounts" CHECK (
  "quantity" > 0 AND "base_quantity" > 0 AND "refund" >= 0 AND "gross_refund" >= 0
  AND "disposition" IN ('SELLABLE', 'DAMAGED')
);
ALTER TABLE "sale_return_allocations" ADD CONSTRAINT "sale_return_allocations_quantity" CHECK ("quantity" > 0);
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_amount" CHECK ("amount" > 0);
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_amount" CHECK ("net_total" >= 0);
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_discount" CHECK (
  "line_discount" >= 0 AND "bill_discount_share" BETWEEN 0 AND "line_total"
);

CREATE TRIGGER member_purchase_ledgers_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON "member_purchase_ledgers"
FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_log_changes();

