-- Provider totals per city and category for the import screen ("45 of 120 found"). Additive.
CREATE TABLE "import_coverage" (
  "city_slug" TEXT NOT NULL,
  "category_slug" TEXT NOT NULL,
  "provider_total" INTEGER,
  "checked_at" TIMESTAMP(3) NOT NULL,
  "run_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "import_coverage_pkey" PRIMARY KEY ("city_slug", "category_slug")
);
