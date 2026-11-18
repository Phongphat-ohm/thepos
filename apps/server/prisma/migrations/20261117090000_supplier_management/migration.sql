ALTER TABLE "suppliers"
    ADD COLUMN "contact_name" VARCHAR(120),
    ADD COLUMN "phone" VARCHAR(40),
    ADD COLUMN "email" VARCHAR(254),
    ADD COLUMN "address" VARCHAR(400),
    ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
