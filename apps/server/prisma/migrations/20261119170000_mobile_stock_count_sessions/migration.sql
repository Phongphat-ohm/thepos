-- CreateTable
CREATE TABLE "stock_count_sessions" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "reason" VARCHAR(400) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "join_code" VARCHAR(16) NOT NULL,
    "show_expected_qty" BOOLEAN NOT NULL DEFAULT false,
    "stock_count_id" UUID,
    "paused_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_count_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_participants" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "client_ip" VARCHAR(64),
    "user_agent" VARCHAR(255),
    "revoked_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_count_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_entries" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "participant_id" UUID,
    "edited_by_user_id" UUID,
    "unit_name" VARCHAR(50) NOT NULL,
    "unit_multiplier" DECIMAL(12,3) NOT NULL,
    "input_quantity" DECIMAL(12,3) NOT NULL,
    "base_quantity" DECIMAL(12,3) NOT NULL,
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_count_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_sessions_join_code_key" ON "stock_count_sessions"("join_code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_sessions_stock_count_id_key" ON "stock_count_sessions"("stock_count_id");

-- CreateIndex
CREATE INDEX "stock_count_sessions_store_id_status_created_at_idx" ON "stock_count_sessions"("store_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "stock_count_sessions_store_id_created_at_id_idx" ON "stock_count_sessions"("store_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_participants_token_hash_key" ON "stock_count_participants"("token_hash");

-- CreateIndex
CREATE INDEX "stock_count_participants_session_id_created_at_idx" ON "stock_count_participants"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_count_entries_session_id_lot_id_idx" ON "stock_count_entries"("session_id", "lot_id");

-- CreateIndex
CREATE INDEX "stock_count_entries_session_id_created_at_idx" ON "stock_count_entries"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_count_entries_participant_id_created_at_idx" ON "stock_count_entries"("participant_id", "created_at");

-- AddForeignKey
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_stock_count_id_fkey" FOREIGN KEY ("stock_count_id") REFERENCES "stock_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_participants" ADD CONSTRAINT "stock_count_participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "stock_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "stock_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "stock_count_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_edited_by_user_id_fkey" FOREIGN KEY ("edited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
