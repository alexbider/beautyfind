-- CreateEnum
CREATE TYPE "ImportRunStatus" AS ENUM ('queued', 'running', 'paused', 'done', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "ImportPlaceStatus" AS ENUM ('found', 'enriched', 'extracted', 'ready', 'needs_review', 'incomplete', 'duplicate', 'closed', 'approved', 'merged', 'rejected');

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "google_place_id" TEXT;

-- CreateTable
CREATE TABLE "import_runs" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "status" "ImportRunStatus" NOT NULL DEFAULT 'queued',
    "scope" JSONB NOT NULL,
    "max_requests" INTEGER NOT NULL,
    "requests_used" INTEGER NOT NULL DEFAULT 0,
    "max_extractions" INTEGER,
    "extractions_used" INTEGER NOT NULL DEFAULT 0,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "locked_by" TEXT,
    "locked_until" TIMESTAMP(3),
    "created_by_id" UUID,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_tasks" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "found" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_places" (
    "id" UUID NOT NULL,
    "place_id" TEXT NOT NULL,
    "run_id" UUID NOT NULL,
    "status" "ImportPlaceStatus" NOT NULL DEFAULT 'found',
    "reasons" TEXT[],
    "name" TEXT NOT NULL,
    "primary_type" TEXT,
    "types" TEXT[],
    "address" TEXT NOT NULL,
    "city_name" TEXT,
    "city_slug" TEXT,
    "region_slug" "RegionSlug",
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "phone" TEXT,
    "phone_raw" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "email_source" TEXT,
    "email_mx" BOOLEAN,
    "emails" TEXT[],
    "website" TEXT,
    "instagram" TEXT,
    "facebook" TEXT,
    "hours" JSONB,
    "google_rating" DOUBLE PRECISION,
    "google_review_count" INTEGER,
    "google_maps_uri" TEXT,
    "business_status" TEXT,
    "categories" TEXT[],
    "business_type" "BusinessType",
    "description" TEXT,
    "treatments" JSONB NOT NULL DEFAULT '[]',
    "crawl" JSONB,
    "dup_of_id" UUID,
    "match_branch_id" UUID,
    "match_score" DOUBLE PRECISION,
    "match_reasons" TEXT[],
    "branch_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "note" TEXT,
    "enriched_at" TIMESTAMP(3),
    "extracted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_places_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_runs_status_created_at_idx" ON "import_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "import_tasks_run_id_status_idx" ON "import_tasks"("run_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "import_tasks_run_id_key_key" ON "import_tasks"("run_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "import_places_place_id_key" ON "import_places"("place_id");

-- CreateIndex
CREATE INDEX "import_places_run_id_status_idx" ON "import_places"("run_id", "status");

-- CreateIndex
CREATE INDEX "import_places_status_region_slug_idx" ON "import_places"("status", "region_slug");

-- CreateIndex
CREATE INDEX "import_places_phone_idx" ON "import_places"("phone");

-- CreateIndex
CREATE INDEX "import_places_email_idx" ON "import_places"("email");

-- CreateIndex
CREATE UNIQUE INDEX "branches_google_place_id_key" ON "branches"("google_place_id");

-- AddForeignKey
ALTER TABLE "import_tasks" ADD CONSTRAINT "import_tasks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_places" ADD CONSTRAINT "import_places_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "import_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

