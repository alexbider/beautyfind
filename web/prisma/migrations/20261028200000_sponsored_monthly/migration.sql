-- Sponsored placements move from weekly region x category slots to monthly slots on a page
-- (city + category list, national treatment page, homepage), billed as a Stripe subscription.
CREATE TYPE "CampaignPlacement" AS ENUM ('city_list', 'treatment_page', 'homepage');

ALTER TABLE "campaigns"
  ADD COLUMN "placement" "CampaignPlacement" NOT NULL DEFAULT 'city_list',
  ADD COLUMN "page_key" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "city_slug" TEXT,
  ADD COLUMN "monthly_price_agorot" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "free_months" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "stripe_customer_id" TEXT,
  ADD COLUMN "stripe_subscription_id" TEXT,
  ADD COLUMN "active_until" TIMESTAMP(3),
  ADD COLUMN "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ended_at" TIMESTAMP(3),
  ALTER COLUMN "region_slug" DROP NOT NULL,
  ALTER COLUMN "category_slug" DROP NOT NULL,
  DROP COLUMN "weeks",
  DROP COLUMN "weekly_price_agorot",
  DROP COLUMN "discount_pct";

DROP INDEX IF EXISTS "campaigns_region_slug_category_slug_week_start_idx";
CREATE UNIQUE INDEX "campaigns_stripe_subscription_id_key" ON "campaigns"("stripe_subscription_id");
CREATE INDEX "campaigns_page_key_status_idx" ON "campaigns"("page_key", "status");
CREATE INDEX "campaigns_business_id_idx" ON "campaigns"("business_id");

CREATE TABLE "sponsored_stats" (
    "campaign_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "contacts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "sponsored_stats_pkey" PRIMARY KEY ("campaign_id", "day")
);
ALTER TABLE "sponsored_stats" ADD CONSTRAINT "sponsored_stats_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
