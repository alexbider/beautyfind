-- Imported services that had no published price were stored as 0 and kept hidden. An unknown price is
-- null (type on_request) and the service is shown with "המחיר לא פורסם" and a quote action.
UPDATE "treatments" t
SET "price_agorot" = NULL, "price_type" = 'on_request', "is_published" = true, "source" = COALESCE(t."source", 'website'), "tax_included" = NULL
FROM "branches" b
WHERE t."branch_id" = b."id" AND b."is_claimed" = false AND t."price_agorot" = 0 AND t."is_published" = false
  AND EXISTS (SELECT 1 FROM "import_places" p WHERE p."branch_id" = b."id");
