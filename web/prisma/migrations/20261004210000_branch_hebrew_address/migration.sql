-- Hebrew addresses for every listing: the original stays in address_raw, the postal code gets its own
-- column for the schema, and address_source records how the display line was made (google, dictionary,
-- city_only, unchanged, owner). Additive only.
ALTER TABLE "branches" ADD COLUMN "address_raw" TEXT;
ALTER TABLE "branches" ADD COLUMN "postal_code" TEXT;
ALTER TABLE "branches" ADD COLUMN "address_source" TEXT;
