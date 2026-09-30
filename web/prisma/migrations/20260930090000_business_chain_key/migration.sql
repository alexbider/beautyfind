-- A chain or franchise key on the business (the website domain its branches share). Additive.
ALTER TABLE "businesses" ADD COLUMN "chain_key" TEXT;
CREATE INDEX "businesses_chain_key_idx" ON "businesses"("chain_key");
