-- Delivery log for messages sent through a real provider (Messaggio). Recipients are masked. Additive.
CREATE TABLE "message_sends" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "to_masked" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider_id" TEXT,
    "error" TEXT,
    "fallback_from" TEXT,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_sends_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "message_sends_created_at_idx" ON "message_sends"("created_at");
