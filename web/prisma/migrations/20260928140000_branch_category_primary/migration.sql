-- The listing's primary category (decides the profile address and the card). Additive; existing rows keep
-- false and the app falls back to catalog order for them.
ALTER TABLE "branch_categories" ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false;
