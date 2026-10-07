-- Google indexing: URLs seen in the sitemap with their inspection and submission state, and the run log. Additive.
CREATE TABLE "indexing_urls" (
    "id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "is_new" BOOLEAN NOT NULL DEFAULT false,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    "indexed" BOOLEAN,
    "verdict" TEXT,
    "coverage_state" TEXT,
    "last_crawl_at" TIMESTAMP(3),
    "inspected_at" TIMESTAMP(3),
    "inspect_error" TEXT,
    "submit_count" INTEGER NOT NULL DEFAULT 0,
    "last_submitted_at" TIMESTAMP(3),
    "last_submit_error" TEXT,
    CONSTRAINT "indexing_urls_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "indexing_urls_url_key" ON "indexing_urls"("url");
CREATE INDEX "indexing_urls_indexed_last_submitted_at_idx" ON "indexing_urls"("indexed", "last_submitted_at");
CREATE INDEX "indexing_urls_inspected_at_idx" ON "indexing_urls"("inspected_at");

CREATE TABLE "indexing_runs" (
    "id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "actor_id" UUID,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "discovered" INTEGER NOT NULL DEFAULT 0,
    "removed" INTEGER NOT NULL DEFAULT 0,
    "inspected" INTEGER NOT NULL DEFAULT 0,
    "submitted" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    CONSTRAINT "indexing_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "indexing_runs_started_at_idx" ON "indexing_runs"("started_at");
