ALTER TABLE "stores"
    ADD COLUMN "vat_rate" DECIMAL(5,2),
    ADD COLUMN "receipt_header" VARCHAR(300),
    ADD COLUMN "receipt_footer" VARCHAR(300),
    ADD COLUMN "receipt_logo" TEXT,
    ADD CONSTRAINT "stores_vat_rate_range" CHECK ("vat_rate" BETWEEN 0 AND 100);
