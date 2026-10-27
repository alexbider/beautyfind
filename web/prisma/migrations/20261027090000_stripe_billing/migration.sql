-- Platform billing through Stripe: the customer and subscription ids, the saved card for display,
-- cancellation at period end and when a charge first failed. A new "incomplete" status for a plan that
-- has no card yet. Additive: existing subscriptions keep their status.
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'incomplete' BEFORE 'active';

ALTER TABLE "subscriptions" ADD COLUMN "stripe_customer_id" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "stripe_subscription_id" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "card_brand" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "card_last4" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "card_exp" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "subscriptions" ADD COLUMN "past_due_since" TIMESTAMP(3);

CREATE UNIQUE INDEX "subscriptions_stripe_customer_id_key" ON "subscriptions"("stripe_customer_id");
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");
