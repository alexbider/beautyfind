-- CreateEnum
CREATE TYPE "RegionSlug" AS ENUM ('north', 'haifa', 'sharon', 'dan', 'jerusalem', 'shfela', 'south');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('client', 'business');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('login', 'signup', 'claim', 'staff_invite', 'password_reset');

-- CreateEnum
CREATE TYPE "OtpChannel" AS ENUM ('whatsapp', 'sms', 'voice', 'email');

-- CreateEnum
CREATE TYPE "Profession" AS ENUM ('doctor', 'nurse', 'cosmetician', 'technician', 'front', 'management');

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('invited', 'active', 'removed');

-- CreateEnum
CREATE TYPE "LicenseKind" AS ENUM ('doctor', 'nurse', 'cosmetician_cert');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('pending', 'verified', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "BusinessStatus" AS ENUM ('pending', 'live', 'past_due', 'hidden');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('clinic', 'medspa', 'cosmetics', 'salon');

-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('draft', 'live', 'unpublished');

-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('fixed', 'from', 'per_unit', 'per_ml', 'per_area');

-- CreateEnum
CREATE TYPE "DepositMode" AS ENUM ('fixed', 'percent');

-- CreateEnum
CREATE TYPE "DepositScope" AS ENUM ('all', 'medical_only', 'per_treatment');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('basic', 'advanced');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('monthly', 'yearly');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'past_due', 'hidden', 'cancelled');

-- CreateEnum
CREATE TYPE "VerificationKind" AS ENUM ('business', 'license', 'cert', 'claim');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('open', 'awaiting_document', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "regions" (
    "slug" "RegionSlug" NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "region_slug" "RegionSlug" NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "is_medical" BOOLEAN NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "full_name" TEXT,
    "kind" "AccountKind" NOT NULL DEFAULT 'client',
    "password_hash" TEXT,
    "phone_verified_at" TIMESTAMP(3),
    "email_verified_at" TIMESTAMP(3),
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "terms_accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "channel" "OtpChannel" NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "context" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_members" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID,
    "display_name" TEXT NOT NULL,
    "profession" "Profession" NOT NULL,
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "preset" TEXT,
    "branch_ids" UUID[],
    "license_id" UUID,
    "status" "StaffStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "licenses" (
    "id" UUID NOT NULL,
    "kind" "LicenseKind" NOT NULL,
    "number" TEXT NOT NULL,
    "name_on_record" TEXT NOT NULL,
    "specialty" TEXT,
    "status" "LicenseStatus" NOT NULL DEFAULT 'pending',
    "verified_at" TIMESTAMP(3),
    "next_check_at" TIMESTAMP(3),
    "source" TEXT,
    "document_file" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL,
    "legal_name" TEXT,
    "company_no" TEXT,
    "type" "BusinessType" NOT NULL DEFAULT 'salon',
    "owner_user_id" UUID,
    "status" "BusinessStatus" NOT NULL DEFAULT 'pending',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "region_slug" "RegionSlug" NOT NULL,
    "city_id" UUID,
    "city_name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "hours" JSONB NOT NULL DEFAULT '[]',
    "accessible" BOOLEAN NOT NULL DEFAULT false,
    "free_parking" BOOLEAN NOT NULL DEFAULT false,
    "online_booking" BOOLEAN NOT NULL DEFAULT true,
    "medical_responsible_id" UUID,
    "status" "BranchStatus" NOT NULL DEFAULT 'draft',
    "is_claimed" BOOLEAN NOT NULL DEFAULT false,
    "cover_url" TEXT,
    "cover_alt" TEXT,
    "logo_url" TEXT,
    "gallery" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_categories" (
    "branch_id" UUID NOT NULL,
    "category_slug" TEXT NOT NULL,

    CONSTRAINT "branch_categories_pkey" PRIMARY KEY ("branch_id","category_slug")
);

-- CreateTable
CREATE TABLE "treatments" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "category_slug" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_type" "PriceType" NOT NULL DEFAULT 'fixed',
    "price_agorot" INTEGER NOT NULL,
    "duration_min" INTEGER,
    "is_medical" BOOLEAN NOT NULL DEFAULT false,
    "requires_declaration" BOOLEAN NOT NULL DEFAULT false,
    "online_bookable" BOOLEAN NOT NULL DEFAULT true,
    "deposit_override_agorot" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treatments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_policies" (
    "business_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" "DepositMode" NOT NULL DEFAULT 'fixed',
    "value" INTEGER NOT NULL DEFAULT 0,
    "scope" "DepositScope" NOT NULL DEFAULT 'medical_only',
    "refund_window_hours" INTEGER NOT NULL DEFAULT 24,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposit_policies_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'basic',
    "cycle" "BillingCycle" NOT NULL DEFAULT 'monthly',
    "price_per_branch_agorot" INTEGER NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "retry" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_requests" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" "VerificationKind" NOT NULL,
    "business_id" UUID,
    "branch_id" UUID,
    "submitted_by_id" UUID,
    "submitted" JSONB NOT NULL,
    "source_lookup" JSONB,
    "checks" JSONB NOT NULL DEFAULT '[]',
    "sla_due_at" TIMESTAMP(3),
    "status" "VerificationStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_role" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "supersedes_decision_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ref_counters" (
    "prefix" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ref_counters_pkey" PRIMARY KEY ("prefix")
);

-- CreateIndex
CREATE UNIQUE INDEX "cities_slug_key" ON "cities"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "otp_codes_target_purpose_idx" ON "otp_codes"("target", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_license_id_key" ON "staff_members"("license_id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_slug_key" ON "branches"("slug");

-- CreateIndex
CREATE INDEX "branches_region_slug_status_idx" ON "branches"("region_slug", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_business_id_key" ON "subscriptions"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_requests_ref_key" ON "verification_requests"("ref");

-- CreateIndex
CREATE INDEX "verification_requests_kind_status_idx" ON "verification_requests"("kind", "status");

-- CreateIndex
CREATE INDEX "decisions_subject_type_subject_id_idx" ON "decisions"("subject_type", "subject_id");

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_region_slug_fkey" FOREIGN KEY ("region_slug") REFERENCES "regions"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_region_slug_fkey" FOREIGN KEY ("region_slug") REFERENCES "regions"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_medical_responsible_id_fkey" FOREIGN KEY ("medical_responsible_id") REFERENCES "staff_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_categories" ADD CONSTRAINT "branch_categories_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_categories" ADD CONSTRAINT "branch_categories_category_slug_fkey" FOREIGN KEY ("category_slug") REFERENCES "categories"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_category_slug_fkey" FOREIGN KEY ("category_slug") REFERENCES "categories"("slug") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_policies" ADD CONSTRAINT "deposit_policies_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
