-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "website_url" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "pending_cycle" "BillingCycle";
