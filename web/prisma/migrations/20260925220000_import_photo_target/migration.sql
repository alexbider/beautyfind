-- The profile gallery shows five photos (one large, four small): aim for eight per imported listing.
UPDATE "import_settings"
SET "values" = jsonb_set("values", '{maxListingPhotos}', '8'::jsonb)
WHERE COALESCE(("values"->>'maxListingPhotos')::int, 0) < 8;
