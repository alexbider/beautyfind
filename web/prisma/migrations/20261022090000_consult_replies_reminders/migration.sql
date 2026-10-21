-- Day-before reminder stamp on bookings, and client replies to consultation requests. Additive.
ALTER TABLE "bookings" ADD COLUMN "reminded_at" TIMESTAMP(3);

CREATE TABLE "consult_replies" (
    "id" UUID NOT NULL,
    "consult_request_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "emailed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consult_replies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "consult_replies_consult_request_id_created_at_idx" ON "consult_replies"("consult_request_id", "created_at");
ALTER TABLE "consult_replies" ADD CONSTRAINT "consult_replies_consult_request_id_fkey" FOREIGN KEY ("consult_request_id") REFERENCES "consult_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
