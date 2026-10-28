-- Marketing services (BeautyFind for Business): orders (purchases and quote requests) with onboarding
-- answers and Stripe ids, and admin overrides for each service's prices and order mode. Additive only.
ALTER TYPE "PaymentPurpose" ADD VALUE IF NOT EXISTS 'marketing';

CREATE TYPE "MarketingOrderKind" AS ENUM ('purchase', 'quote');
CREATE TYPE "MarketingOrderStatus" AS ENUM ('quote_requested', 'quoted', 'awaiting_payment', 'paid', 'onboarding', 'in_progress', 'active', 'completed', 'past_due', 'cancelled');

CREATE TABLE "marketing_orders" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" "MarketingOrderKind" NOT NULL,
    "status" "MarketingOrderStatus" NOT NULL,
    "service_slug" TEXT NOT NULL,
    "package_key" TEXT,
    "package_name" TEXT,
    "cycle" TEXT,
    "price_agorot" INTEGER,
    "setup_agorot" INTEGER NOT NULL DEFAULT 0,
    "business_id" UUID,
    "branch_id" UUID,
    "user_id" UUID,
    "contact_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "business_type" TEXT,
    "city" TEXT,
    "website" TEXT,
    "message" TEXT,
    "access_token" TEXT NOT NULL,
    "onboarding" JSONB,
    "onboarded_at" TIMESTAMP(3),
    "stripe_session_id" TEXT,
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "current_period_end" TIMESTAMP(3),
    "assignee_id" UUID,
    "internal_note" TEXT,
    "status_note" TEXT,
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "utm" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketing_orders_ref_key" ON "marketing_orders"("ref");
CREATE UNIQUE INDEX "marketing_orders_access_token_key" ON "marketing_orders"("access_token");
CREATE UNIQUE INDEX "marketing_orders_stripe_session_id_key" ON "marketing_orders"("stripe_session_id");
CREATE UNIQUE INDEX "marketing_orders_stripe_subscription_id_key" ON "marketing_orders"("stripe_subscription_id");
CREATE INDEX "marketing_orders_status_created_at_idx" ON "marketing_orders"("status", "created_at");
CREATE INDEX "marketing_orders_business_id_idx" ON "marketing_orders"("business_id");
CREATE INDEX "marketing_orders_contact_email_idx" ON "marketing_orders"("contact_email");
CREATE INDEX "marketing_orders_service_slug_idx" ON "marketing_orders"("service_slug");

CREATE TABLE "marketing_service_configs" (
    "slug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" TEXT NOT NULL DEFAULT 'both',
    "packages" JSONB NOT NULL DEFAULT '{}',
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_service_configs_pkey" PRIMARY KEY ("slug")
);
