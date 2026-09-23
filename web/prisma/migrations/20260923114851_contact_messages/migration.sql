-- CreateEnum
CREATE TYPE "ContactReason" AS ENUM ('general', 'business', 'correction', 'complaint', 'access', 'press');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('new', 'in_progress', 'closed');

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "reason" "ContactReason" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "business_name" TEXT,
    "page_url" TEXT,
    "message" TEXT NOT NULL,
    "status" "ContactStatus" NOT NULL DEFAULT 'new',
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_messages_ref_key" ON "contact_messages"("ref");

-- CreateIndex
CREATE INDEX "contact_messages_reason_status_idx" ON "contact_messages"("reason", "status");
