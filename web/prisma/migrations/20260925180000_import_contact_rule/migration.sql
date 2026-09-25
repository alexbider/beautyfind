-- Product owner's rules of 2026-09-25: a phone or an email is enough to publish; the Google rating and
-- review count and the Google profile logo/photo are used. Applied to settings already saved in the admin.
UPDATE "import_settings"
SET "values" = "values" || '{"requirePhoneOrEmail": true, "requireEmail": false, "requirePhoneOrWebsite": false, "publishProviderRatings": true, "useProviderImages": true}'::jsonb;
