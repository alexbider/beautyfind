-- WhatsApp through Twilio: the sealed SMS fallback of a WhatsApp send, cleared on its final status. Additive.
ALTER TABLE "message_sends" ADD COLUMN "fallback_enc" TEXT;
