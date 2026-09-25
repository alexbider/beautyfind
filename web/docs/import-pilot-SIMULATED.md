# SIMULATED import pilot

> **SIMULATED. Not a live result.** Produced by `npm run import:simulate` against a local mock of the DataForSEO
> Business Listings API and invented fixture websites. No provider was contacted and no money was spent.
> The counts below describe the fixtures (built to include blocked sites, robots.txt refusals, missing emails,
> site-builder footer emails, phone conflicts, a redirect to a cloud metadata address, a site of another business,
> directory and Instagram links given as the website, a repeated place and a record without coordinates).
> They say nothing about how many Israeli businesses a live run will find.

Generated 2026-09-25T09:09:04.322Z in 2.2s. Pricing reference: $0.012 per request + $0.00036 per record (mock billed at these rates).

## SIMULATED run

- Record limit 100, ceiling $1.00; mock provider held 142 items (140 businesses + 1 repeat + 1 without coordinates)
- Provider requests: 2; simulated spend $0.0480; reserved at end $0.0000
- Spend entries: committed 0.0480
- Unique businesses staged: 100
- With an email: 34 (34%)
- Ready to publish without edits: 80; conflicts sent to review: 11
- Services: 245 on 48 records (161 with a price)
- Images: 58 records with a logo, 58 with photos (142 photos chosen)
- Social profile kept as the website: 4
- Fixture sites that redirect to the cloud metadata address: 8; of those crawled, refused as unsafe: 6 (records marked unsafe: 6)

## SIMULATED records by status

- ready: 80
- needs_review: 14
- incomplete: 5
- merged: 1

## SIMULATED reasons

- hours_conflict: 6
- no_contact: 5
- phone_conflict: 5
- email_domain_mismatch: 4

## SIMULATED website outcomes

- google_profile: 36
- ok: 30
- robots: 6
- unsafe: 6
- no_email: 6
- blocked: 6
- unrelated: 6
- social_profile: 4

## SIMULATED listing template coverage

Average completeness 64%. Records with each field: שם 100, כתובת ומיקום 100, טלפון 94, דוא״ל 34, אתר או פרופיל 100, וואטסאפ או רשת חברתית 40, שעות פתיחה 100, לוגו 58, תמונת שער 58, גלריה (3 תמונות ומעלה) 36, תיאור 52, תחומים 100, טיפולים 48, מחירים 48, דירוג Google 100, נגישות 20, חניה 24, שאלות נפוצות 36.

## SIMULATED enhancement of published listings

5 listings approved and blanked; after enhancing: logo 5, cover 5, hours 5, description 5, email 3 | counters improved 5, refreshed 5, filled_faqs 3, filled_logo 5, filled_cover 5, filled_email 3, filled_hours 5, filled_gallery 3, filled_parking 1, filled_accessible 1, filled_description 5 | spent $0.0138

## What a live pilot needs

1. DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD as GitHub Actions secrets (the worker runs there).
2. `npm run import:dfs-categories` once, to confirm the category ids in src/lib/import/dataforseo.ts.
3. A pilot run from /ops/import: DataForSEO, one city, record limit 100, ceiling $1.
