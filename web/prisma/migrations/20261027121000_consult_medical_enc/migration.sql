-- Sealed health answers on consultation requests (goal, previous injections, medical flags). Additive; the
-- backfill that seals existing rows runs at deploy (scripts/seal-consults.ts).
ALTER TABLE "consult_requests" ADD COLUMN "medical_enc" TEXT;
