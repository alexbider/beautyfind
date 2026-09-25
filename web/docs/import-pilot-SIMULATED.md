# SIMULATED import pilot

> **SIMULATED. Not a live result.** Produced by `npm run import:simulate` against a local mock of the DataForSEO
> Business Listings API and invented fixture websites. No provider was contacted and no money was spent.
> The counts below describe the fixtures (built to include blocked sites, robots.txt refusals, missing emails,
> site-builder footer emails, phone conflicts, a redirect to a cloud metadata address, a site of another business,
> directory and Instagram links given as the website, a repeated place and a record without coordinates).
> They say nothing about how many Israeli businesses a live run will find.

Generated 2026-09-25T07:18:32.100Z in 1.9s. Pricing reference: $0.012 per request + $0.00036 per record (mock billed at these rates).

## SIMULATED run

- Record limit 100, ceiling $1.00; mock provider held 142 items (140 businesses + 1 repeat + 1 without coordinates)
- Provider requests: 1; simulated spend $0.0480; reserved at end $0.0000
- Spend entries: committed 0.0480
- Unique businesses staged: 100
- With an email: 30 (30%)
- Ready to publish without edits: 24; conflicts sent to review: 5
- Services: 216 on 36 records (144 with a price)
- Images: 36 records with a logo, 36 with photos (108 photos chosen)
- Social profile kept as the website: 4
- Fixture sites that redirect to the cloud metadata address: 8; of those crawled, refused as unsafe: 6 (records marked unsafe: 6)

## SIMULATED records by status

- ready: 24
- needs_review: 5
- incomplete: 70
- merged: 1

## SIMULATED reasons

- no_email: 70
- phone_conflict: 5
- no_contact: 3

## SIMULATED website outcomes

- no_website: 33
- ok: 30
- unsafe: 6
- no_email: 6
- unrelated: 6
- blocked: 6
- robots: 6
- social_profile: 4
- directory: 3

## What a live pilot needs

1. DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD as GitHub Actions secrets (the worker runs there).
2. `npm run import:dfs-categories` once, to confirm the category ids in src/lib/import/dataforseo.ts.
3. A pilot run from /ops/import: DataForSEO, one city, record limit 100, ceiling $1.
