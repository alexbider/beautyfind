-- CreateEnum
CREATE TYPE "OpsRole" AS ENUM ('moderator', 'verifier', 'ops', 'support', 'legal');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('sent', 'accepted', 'expired', 'declined', 'revoked');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('new', 'contacted', 'booked', 'done', 'lost');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('form', 'whatsapp', 'phone', 'walkin', 'referral');

-- CreateEnum
CREATE TYPE "LeadEventKind" AS ENUM ('form', 'contact', 'stage', 'note', 'edit', 'visit');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('submitted', 'published', 'rejected', 'removed');

-- CreateEnum
CREATE TYPE "ProfileEventType" AS ENUM ('view', 'contact_click', 'whatsapp_click', 'call_click', 'waze_click', 'booking_start', 'form_submit');

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "description" TEXT,
ADD COLUMN     "faqs" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "google_place_url" TEXT,
ADD COLUMN     "google_rating" DOUBLE PRECISION,
ADD COLUMN     "google_review_count" INTEGER,
ADD COLUMN     "google_synced_at" TIMESTAMP(3),
ADD COLUMN     "instagram" TEXT,
ADD COLUMN     "waze_url" TEXT;

-- AlterTable
ALTER TABLE "treatments" ADD COLUMN     "is_published" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ops_role" "OpsRole";

-- CreateTable
CREATE TABLE "staff_invites" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "preset" TEXT NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "token_hash" TEXT NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'sent',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "treatment" TEXT,
    "source" "LeadSource" NOT NULL,
    "stage" "LeadStage" NOT NULL DEFAULT 'new',
    "value_agorot" INTEGER,
    "next_action" TEXT,
    "next_date" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_events" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "kind" "LeadEventKind" NOT NULL,
    "text" TEXT NOT NULL,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "booking_id" UUID,
    "author_name" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "treatment_name" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'submitted',
    "business_reply" TEXT,
    "replied_at" TIMESTAMP(3),
    "replied_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_events" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "type" "ProfileEventType" NOT NULL,
    "device" TEXT,
    "city" TEXT,
    "query" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_files" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "business_id" UUID,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "alt" TEXT,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_invites_token_hash_key" ON "staff_invites"("token_hash");

-- CreateIndex
CREATE INDEX "staff_invites_business_id_status_idx" ON "staff_invites"("business_id", "status");

-- CreateIndex
CREATE INDEX "leads_business_id_stage_idx" ON "leads"("business_id", "stage");

-- CreateIndex
CREATE INDEX "lead_events_lead_id_created_at_idx" ON "lead_events"("lead_id", "created_at");

-- CreateIndex
CREATE INDEX "reviews_branch_id_status_idx" ON "reviews"("branch_id", "status");

-- CreateIndex
CREATE INDEX "profile_events_branch_id_type_created_at_idx" ON "profile_events"("branch_id", "type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "media_files_key_key" ON "media_files"("key");

-- AddForeignKey
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_events" ADD CONSTRAINT "profile_events_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
