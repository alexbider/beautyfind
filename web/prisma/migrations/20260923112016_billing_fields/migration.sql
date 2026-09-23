-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "accountant_email" TEXT,
ADD COLUMN     "invoice_email" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "current_period_end" TIMESTAMP(3),
ADD COLUMN     "pending_plan" "Plan";
