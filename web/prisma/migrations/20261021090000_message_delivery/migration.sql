-- Delivery reports for provider sends (Twilio status callbacks). Additive.
ALTER TABLE "message_sends" ADD COLUMN "delivery_status" TEXT;
ALTER TABLE "message_sends" ADD COLUMN "delivery_error" TEXT;
ALTER TABLE "message_sends" ADD COLUMN "delivered_at" TIMESTAMP(3);
CREATE INDEX "message_sends_provider_provider_id_idx" ON "message_sends"("provider", "provider_id");
