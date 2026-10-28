-- Email monitoring (/ops/emails): tracking columns on message_sends, webhook events, received replies. Additive only.
-- AlterTable
ALTER TABLE "message_sends" ADD COLUMN     "audience" TEXT,
ADD COLUMN     "business_id" UUID,
ADD COLUMN     "click_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "clicked_at" TIMESTAMP(3),
ADD COLUMN     "last_click_url" TEXT,
ADD COLUMN     "last_clicked_at" TIMESTAMP(3),
ADD COLUMN     "last_opened_at" TIMESTAMP(3),
ADD COLUMN     "message_id" TEXT,
ADD COLUMN     "open_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "opened_at" TIMESTAMP(3),
ADD COLUMN     "replied_at" TIMESTAMP(3),
ADD COLUMN     "reply_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reply_token" TEXT,
ADD COLUMN     "user_id" UUID;

-- CreateTable
CREATE TABLE "email_events" (
    "id" TEXT NOT NULL,
    "send_id" UUID,
    "provider_id" TEXT,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "link" TEXT,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_replies" (
    "id" UUID NOT NULL,
    "resend_id" TEXT NOT NULL,
    "send_id" UUID,
    "business_id" UUID,
    "user_id" UUID,
    "from_email" TEXT NOT NULL,
    "from_name" TEXT,
    "to_address" TEXT NOT NULL,
    "subject" TEXT,
    "text" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "received_at" TIMESTAMP(3) NOT NULL,
    "forwarded_at" TIMESTAMP(3),
    "forward_error" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "handled_by_id" UUID,
    "handled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_events_send_id_at_idx" ON "email_events"("send_id", "at");

-- CreateIndex
CREATE INDEX "email_events_type_at_idx" ON "email_events"("type", "at");

-- CreateIndex
CREATE UNIQUE INDEX "email_replies_resend_id_key" ON "email_replies"("resend_id");

-- CreateIndex
CREATE INDEX "email_replies_status_received_at_idx" ON "email_replies"("status", "received_at");

-- CreateIndex
CREATE INDEX "email_replies_business_id_received_at_idx" ON "email_replies"("business_id", "received_at");

-- CreateIndex
CREATE INDEX "email_replies_send_id_idx" ON "email_replies"("send_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_sends_reply_token_key" ON "message_sends"("reply_token");

-- CreateIndex
CREATE INDEX "message_sends_business_id_created_at_idx" ON "message_sends"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "message_sends_user_id_idx" ON "message_sends"("user_id");

-- CreateIndex
CREATE INDEX "message_sends_message_id_idx" ON "message_sends"("message_id");

-- CreateIndex
CREATE INDEX "message_sends_template_created_at_idx" ON "message_sends"("template", "created_at");

-- AddForeignKey
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_send_id_fkey" FOREIGN KEY ("send_id") REFERENCES "message_sends"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_replies" ADD CONSTRAINT "email_replies_send_id_fkey" FOREIGN KEY ("send_id") REFERENCES "message_sends"("id") ON DELETE SET NULL ON UPDATE CASCADE;

