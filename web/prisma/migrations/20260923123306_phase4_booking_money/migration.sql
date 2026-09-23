-- CreateEnum
CREATE TYPE "BookingKind" AS ENUM ('treatment', 'consult');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('pending_payment', 'abandoned', 'confirmed', 'checked_in', 'in_treatment', 'completed', 'cancelled_client', 'cancelled_clinic', 'no_show');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('online', 'phone', 'walkin', 'waitlist', 'consult');

-- CreateEnum
CREATE TYPE "ConsultStatus" AS ENUM ('new', 'awaiting_client', 'consult_scheduled', 'closed_treatment_booked', 'closed_declined');

-- CreateEnum
CREATE TYPE "DeclarationType" AS ENUM ('medical', 'cosmetic');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('active', 'offered', 'booked', 'expired', 'left');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('sent', 'accepted', 'passed', 'expired');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('deposit', 'treatment', 'gift_card', 'consult', 'subscription', 'sponsored');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded', 'forfeited', 'applied');

-- CreateEnum
CREATE TYPE "Payee" AS ENUM ('business', 'platform');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('tax_invoice_receipt', 'credit_note', 'platform_invoice');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('requested', 'issued', 'sent_to_card', 'received', 'failed');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('payments', 'invoicing', 'calendar');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('pending', 'connected', 'error', 'disabled');

-- CreateEnum
CREATE TYPE "GiftCardKind" AS ENUM ('amount', 'treatment');

-- CreateEnum
CREATE TYPE "GiftCardStatus" AS ENUM ('pending_payment', 'scheduled', 'active', 'partially_redeemed', 'redeemed', 'refunded', 'expired');

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "aspects" JSONB,
ADD COLUMN     "name_mode" TEXT NOT NULL DEFAULT 'initial',
ADD COLUMN     "photo_consent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "photos" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "tags" TEXT[];

-- AlterTable
ALTER TABLE "treatments" ADD COLUMN     "practitioner_ids" UUID[];

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "branch_id" UUID NOT NULL,
    "treatment_id" UUID,
    "practitioner_id" UUID,
    "client_user_id" UUID,
    "client_name" TEXT NOT NULL,
    "client_phone" TEXT NOT NULL,
    "client_email" TEXT,
    "kind" "BookingKind" NOT NULL DEFAULT 'treatment',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "room" TEXT,
    "status" "BookingStatus" NOT NULL,
    "source" "BookingSource" NOT NULL DEFAULT 'online',
    "price_agorot" INTEGER,
    "deposit_agorot" INTEGER NOT NULL DEFAULT 0,
    "policy_shown" JSONB NOT NULL,
    "hold_until" TIMESTAMP(3),
    "requires_declaration" BOOLEAN NOT NULL DEFAULT false,
    "declaration_id" UUID,
    "consult_request_id" UUID,
    "checked_in_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "clinical_enc" TEXT,
    "cancellation" JSONB,
    "consents" JSONB NOT NULL DEFAULT '{}',
    "rescheduled_from_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "busy_blocks" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "practitioner_id" UUID,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "busy_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consult_requests" (
    "id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "branch_id" UUID NOT NULL,
    "client_user_id" UUID,
    "client_name" TEXT NOT NULL,
    "client_phone" TEXT NOT NULL,
    "treatment_id" UUID,
    "areas" TEXT[],
    "goal" TEXT NOT NULL,
    "prior_injections" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "chosen_slot" TIMESTAMP(3),
    "preferred_times" TEXT[],
    "preferred_days" INTEGER[],
    "consent_share_medical" BOOLEAN NOT NULL DEFAULT false,
    "medical_flags" TEXT[],
    "status" "ConsultStatus" NOT NULL,
    "proposed_slot" TIMESTAMP(3),
    "outcome_text" TEXT,
    "decided_by_id" UUID,
    "decline_reason" TEXT,
    "fee_agorot" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consult_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_declarations" (
    "id" UUID NOT NULL,
    "client_user_id" UUID,
    "type" "DeclarationType" NOT NULL,
    "questionnaire_version" TEXT NOT NULL,
    "answers_enc" TEXT NOT NULL,
    "flagged" BOOLEAN NOT NULL,
    "signed_name" TEXT NOT NULL,
    "signature_key" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "physician_ack_by_id" UUID,
    "physician_ack_at" TIMESTAMP(3),
    "superseded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "business_id" UUID,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "treatment_id" UUID NOT NULL,
    "practitioner_id" UUID,
    "client_user_id" UUID,
    "client_name" TEXT NOT NULL,
    "client_phone" TEXT NOT NULL,
    "days" INTEGER[],
    "time_ranges" TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_offers" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "slot_starts_at" TIMESTAMP(3) NOT NULL,
    "practitioner_id" UUID,
    "token_hash" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hold_until" TIMESTAMP(3) NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'sent',
    "booking_id" UUID,

    CONSTRAINT "waitlist_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "payee" "Payee" NOT NULL,
    "business_id" UUID,
    "booking_id" UUID,
    "gift_card_id" UUID,
    "payer_name" TEXT NOT NULL,
    "payer_phone" TEXT,
    "payer_email" TEXT,
    "purpose" "PaymentPurpose" NOT NULL,
    "net_agorot" INTEGER NOT NULL,
    "vat_agorot" INTEGER NOT NULL,
    "gross_agorot" INTEGER NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL,
    "connection_id" UUID,
    "provider_ref" TEXT,
    "checkout_url" TEXT,
    "card_brand" TEXT,
    "card_last4" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "issuer" "Payee" NOT NULL,
    "business_id" UUID,
    "type" "DocumentType" NOT NULL,
    "number" TEXT NOT NULL,
    "payment_id" UUID,
    "references_document_id" UUID,
    "lines" JSONB NOT NULL,
    "net_agorot" INTEGER NOT NULL,
    "vat_agorot" INTEGER NOT NULL,
    "gross_agorot" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "pdf_url" TEXT,
    "sent_to" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_agorot" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "credit_note_id" UUID,
    "provider_ref" TEXT,
    "status" "RefundStatus" NOT NULL DEFAULT 'requested',
    "expected_by" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_connections" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "ProviderKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT,
    "credentials_enc" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" "ConnectionStatus" NOT NULL DEFAULT 'pending',
    "last_checked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_cards" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "GiftCardKind" NOT NULL,
    "treatment_id" UUID,
    "value_agorot" INTEGER NOT NULL,
    "balance_agorot" INTEGER NOT NULL,
    "buyer_name" TEXT NOT NULL,
    "buyer_phone" TEXT NOT NULL,
    "buyer_email" TEXT,
    "recipient_name" TEXT NOT NULL,
    "recipient_channel" TEXT NOT NULL,
    "recipient_contact" TEXT,
    "message" TEXT,
    "send_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" "GiftCardStatus" NOT NULL DEFAULT 'pending_payment',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_redemptions" (
    "id" UUID NOT NULL,
    "gift_card_id" UUID NOT NULL,
    "amount_agorot" INTEGER NOT NULL,
    "booking_id" UUID,
    "branch_id" UUID NOT NULL,
    "document_id" UUID,
    "by_staff_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_clinics" (
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_clinics_pkey" PRIMARY KEY ("user_id","branch_id")
);

-- CreateTable
CREATE TABLE "message_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "contact" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "marketing" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_ref_key" ON "bookings"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_consult_request_id_key" ON "bookings"("consult_request_id");

-- CreateIndex
CREATE INDEX "bookings_branch_id_starts_at_idx" ON "bookings"("branch_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_practitioner_id_starts_at_idx" ON "bookings"("practitioner_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_client_user_id_idx" ON "bookings"("client_user_id");

-- CreateIndex
CREATE INDEX "busy_blocks_branch_id_starts_at_idx" ON "busy_blocks"("branch_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "consult_requests_ref_key" ON "consult_requests"("ref");

-- CreateIndex
CREATE INDEX "consult_requests_branch_id_status_idx" ON "consult_requests"("branch_id", "status");

-- CreateIndex
CREATE INDEX "audit_logs_subject_type_subject_id_idx" ON "audit_logs"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "audit_logs_business_id_created_at_idx" ON "audit_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "waitlist_entries_branch_id_status_idx" ON "waitlist_entries"("branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_offers_token_hash_key" ON "waitlist_offers"("token_hash");

-- CreateIndex
CREATE INDEX "payments_business_id_created_at_idx" ON "payments"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_provider_provider_ref_idx" ON "payments"("provider", "provider_ref");

-- CreateIndex
CREATE UNIQUE INDEX "provider_connections_business_id_kind_provider_key" ON "provider_connections"("business_id", "kind", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "gift_cards_code_key" ON "gift_cards"("code");

-- CreateIndex
CREATE INDEX "gift_cards_business_id_status_idx" ON "gift_cards"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "message_consents_contact_scope_channel_key" ON "message_consents"("contact", "scope", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_booking_id_key" ON "reviews"("booking_id");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_treatment_id_fkey" FOREIGN KEY ("treatment_id") REFERENCES "treatments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_practitioner_id_fkey" FOREIGN KEY ("practitioner_id") REFERENCES "staff_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_user_id_fkey" FOREIGN KEY ("client_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_declaration_id_fkey" FOREIGN KEY ("declaration_id") REFERENCES "health_declarations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "busy_blocks" ADD CONSTRAINT "busy_blocks_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consult_requests" ADD CONSTRAINT "consult_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_declarations" ADD CONSTRAINT "health_declarations_client_user_id_fkey" FOREIGN KEY ("client_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_offers" ADD CONSTRAINT "waitlist_offers_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "waitlist_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_redemptions" ADD CONSTRAINT "gift_redemptions_gift_card_id_fkey" FOREIGN KEY ("gift_card_id") REFERENCES "gift_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_clinics" ADD CONSTRAINT "saved_clinics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_clinics" ADD CONSTRAINT "saved_clinics_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_consents" ADD CONSTRAINT "message_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

