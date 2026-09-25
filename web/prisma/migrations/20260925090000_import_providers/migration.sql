-- AlterTable
ALTER TABLE "import_places" ADD COLUMN     "booking_url" TEXT,
ADD COLUMN     "email_status" TEXT,
ADD COLUMN     "name_norm" TEXT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'google',
ADD COLUMN     "rating_provider" TEXT,
ADD COLUMN     "retrieved_at" TIMESTAMP(3),
ADD COLUMN     "site_domain" TEXT,
ADD COLUMN     "source_id" TEXT,
ADD COLUMN     "source_updated_at" TIMESTAMP(3),
ADD COLUMN     "source_url" TEXT;

-- AlterTable
ALTER TABLE "import_runs" ADD COLUMN     "budget_micros" BIGINT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'google',
ADD COLUMN     "record_limit" INTEGER,
ADD COLUMN     "reserved_micros" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "spent_micros" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "field_observations" (
    "id" UUID NOT NULL,
    "import_place_id" UUID,
    "branch_id" UUID,
    "field" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "source_url" TEXT,
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "source_updated_at" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidence" TEXT,
    "retention" TEXT NOT NULL DEFAULT 'permanent',
    "expires_at" TIMESTAMP(3),
    "publishable" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_fetches" (
    "domain" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "next_check_at" TIMESTAMP(3) NOT NULL,
    "pages" INTEGER NOT NULL DEFAULT 0,
    "validators" JSONB NOT NULL DEFAULT '{}',
    "content_hash" TEXT,
    "result" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_fetches_pkey" PRIMARY KEY ("domain")
);

-- CreateTable
CREATE TABLE "spend_entries" (
    "id" UUID NOT NULL,
    "run_id" UUID,
    "provider" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "sku" TEXT,
    "request_key" TEXT NOT NULL,
    "estimated_micros" BIGINT NOT NULL,
    "actual_micros" BIGINT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spend_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_budgets" (
    "key" TEXT NOT NULL,
    "limit_micros" BIGINT NOT NULL,
    "used_micros" BIGINT NOT NULL DEFAULT 0,
    "reserved_micros" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_budgets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "import_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "values" JSONB NOT NULL DEFAULT '{}',
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_display" (
    "place_id" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "sku" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_display_pkey" PRIMARY KEY ("place_id")
);

-- CreateIndex
CREATE INDEX "field_observations_import_place_id_field_idx" ON "field_observations"("import_place_id", "field");

-- CreateIndex
CREATE INDEX "field_observations_branch_id_field_idx" ON "field_observations"("branch_id", "field");

-- CreateIndex
CREATE INDEX "field_observations_expires_at_idx" ON "field_observations"("expires_at");

-- CreateIndex
CREATE INDEX "site_fetches_next_check_at_idx" ON "site_fetches"("next_check_at");

-- CreateIndex
CREATE UNIQUE INDEX "spend_entries_request_key_key" ON "spend_entries"("request_key");

-- CreateIndex
CREATE INDEX "spend_entries_run_id_idx" ON "spend_entries"("run_id");

-- CreateIndex
CREATE INDEX "spend_entries_provider_created_at_idx" ON "spend_entries"("provider", "created_at");

-- CreateIndex
CREATE INDEX "spend_entries_status_idx" ON "spend_entries"("status");

-- CreateIndex
CREATE INDEX "google_display_expires_at_idx" ON "google_display"("expires_at");

-- CreateIndex
CREATE INDEX "import_places_site_domain_idx" ON "import_places"("site_domain");

-- AddForeignKey
ALTER TABLE "field_observations" ADD CONSTRAINT "field_observations_import_place_id_fkey" FOREIGN KEY ("import_place_id") REFERENCES "import_places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

