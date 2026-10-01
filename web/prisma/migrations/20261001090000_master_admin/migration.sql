-- Master admin (/ops): platform settings, disputes, sponsored campaigns, expenses, AI approvals, page SEO,
-- client blocks. Additive only.
ALTER TABLE "users" ADD COLUMN "blocked_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "blocked_reason" TEXT;

CREATE TABLE "platform_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "values" JSONB NOT NULL DEFAULT '{}',
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

CREATE TYPE "DisputeKind" AS ENUM ('deposit', 'gift_card');
CREATE TYPE "DisputeStatus" AS ENUM ('open', 'recommended_refund', 'closed_policy_upheld', 'escalated_legal');

CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" "DisputeKind" NOT NULL,
    "booking_id" UUID,
    "gift_card_id" UUID,
    "business_id" UUID NOT NULL,
    "branch_id" UUID,
    "client_name" TEXT NOT NULL,
    "client_phone" TEXT,
    "amount_agorot" INTEGER NOT NULL,
    "claim" TEXT NOT NULL,
    "system_facts" JSONB NOT NULL DEFAULT '[]',
    "policy_shown" JSONB,
    "status" "DisputeStatus" NOT NULL DEFAULT 'open',
    "recommendation" TEXT,
    "opened_by_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "disputes_ref_key" ON "disputes"("ref");
CREATE INDEX "disputes_status_idx" ON "disputes"("status");
CREATE INDEX "disputes_business_id_idx" ON "disputes"("business_id");

CREATE TYPE "CampaignStatus" AS ENUM ('pending_review', 'approved', 'rejected', 'cancelled');

CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "region_slug" "RegionSlug" NOT NULL,
    "category_slug" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "weeks" INTEGER NOT NULL DEFAULT 1,
    "line" TEXT NOT NULL,
    "featured_treatment" TEXT,
    "weekly_price_agorot" INTEGER NOT NULL,
    "discount_pct" INTEGER NOT NULL DEFAULT 0,
    "status" "CampaignStatus" NOT NULL DEFAULT 'pending_review',
    "hold_until" TIMESTAMP(3),
    "checks" JSONB NOT NULL DEFAULT '[]',
    "review_note" TEXT,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "payment_id" UUID,
    "stats" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "campaigns_ref_key" ON "campaigns"("ref");
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");
CREATE INDEX "campaigns_region_slug_category_slug_week_start_idx" ON "campaigns"("region_slug", "category_slug", "week_start");

CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "vendor" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "net_agorot" INTEGER NOT NULL,
    "vat_agorot" INTEGER NOT NULL DEFAULT 0,
    "receipt_url" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "expenses_date_idx" ON "expenses"("date");

CREATE TYPE "AiActionStatus" AS ENUM ('proposed', 'approved', 'rejected', 'executed', 'failed');

CREATE TABLE "ai_actions" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID,
    "subject_label" TEXT,
    "params" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT,
    "status" "AiActionStatus" NOT NULL DEFAULT 'proposed',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "result" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_actions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_actions_ref_key" ON "ai_actions"("ref");
CREATE INDEX "ai_actions_status_idx" ON "ai_actions"("status");

CREATE TABLE "page_seo" (
    "path" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "keyword" TEXT,
    "noindex" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "page_seo_pkey" PRIMARY KEY ("path")
);
