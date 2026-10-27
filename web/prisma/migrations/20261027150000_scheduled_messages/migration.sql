CREATE TABLE "scheduled_messages" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "automation" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "to_sealed" TEXT NOT NULL,
    "to_masked" TEXT NOT NULL,
    "fallback_sealed" TEXT,
    "vars_sealed" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'service',
    "scope" TEXT,
    "business_id" UUID,
    "ref_id" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "stale_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "sent_channel" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "scheduled_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "scheduled_messages_key_key" ON "scheduled_messages"("key");
CREATE INDEX "scheduled_messages_status_due_at_idx" ON "scheduled_messages"("status", "due_at");
CREATE INDEX "scheduled_messages_automation_created_at_idx" ON "scheduled_messages"("automation", "created_at");
CREATE INDEX "scheduled_messages_business_id_idx" ON "scheduled_messages"("business_id");
