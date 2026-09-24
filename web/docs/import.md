# Directory import

Builds unclaimed listings from public data. A run finds businesses on Google, reads each business's own website, extracts categories and the treatment menu with Claude, and checks every record for duplicates and missing data. Nothing reaches the public site until someone on the ops team approves it at `/ops/import/review`.

## How it works

1. **Discover** (`scripts/import/places.ts`). Two sources, chosen per run:
   - A map grid by Google place type (hair salon, nail salon, spa, beauty salon and so on). Cells that come back full (20 results) are split into quarters until nothing is missed.
   - Text queries per category and city ("השתלת שיער חיפה"). These catch clinics that Google files under doctor or dentist.
   Every call is counted against the run's cap before it is sent.
2. **Enrich** (`scripts/import/crawl.ts`). Reads the home page and up to five contact, price and treatment pages on the same site. It respects robots.txt, sends a `BeautyFindBot` user agent and waits between requests. It collects email addresses (including Cloudflare-protected ones), phones, WhatsApp, Instagram and Facebook links. Each email domain is checked for MX records.
3. **Extract** (`scripts/import/extract.ts`). Claude reads the page text and returns categories, business type, the treatment list with prices as shown, and a short neutral description. The output is constrained to a JSON schema and validated again. Emails Claude reports are kept only if the crawler also found them on the site.
4. **Check** (`work.ts` → `check`). Runs over every open record, not only this run's:
   - **Duplicates.** A record is marked duplicate automatically only when it scores 0.8 or more and shares a phone, an email or the Google place id. Weaker matches (same website and address, similar name) go to review as "possible duplicate". Names that differ only by a branch number are never treated as the same business.
   - **Existing listings.** Each record is compared with every branch on the site. A possible match goes to review with a "merge into the existing listing" button. A branch created from the same Google place is linked automatically.
   - **Completeness.** A record is *ready* only with a valid Israeli phone, an email whose domain accepts mail, at least one category, and nothing that needs a person. Otherwise it is *incomplete* (missing data) or *needs review* (email on a different domain from the website, shared phone, medical category, temporarily closed, city not in our list, possible duplicate or existing listing).

## Review (`/ops/import/review`)

Only the `ops` staff role can open it. Every decision is written to `audit_logs`.

- **Approve**: creates a live, unclaimed listing. It gets our category photo (no photos are copied from Google or the business's site), Google rating fields, hours, Waze link, website, Instagram, categories and the treatment menu. Site prices include VAT, so they are stored net of the 18% VAT like the rest of the catalogue. Treatments without a price are saved but hidden until the owner prices them. The Google place id is unique on `branches`, so the same place can never be created twice, even with two reviewers clicking at once.
- **Merge**: fills only the empty fields of an existing listing. It adds missing categories, and adds treatments only when the listing has none.
- **Edit**: fixes name, phone, email, website, city and categories. The record is then checked again with the same rules.
- **Reject / mark duplicate / restore.**
- **Bulk approve**: publishes the "ready" records on the current page. "Needs review" records are never bulk-approved.

## What you need to provide

| What | Where | Notes |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | GitHub secret | Google Cloud project with billing, **Places API (New)** enabled. Restrict the key to that API and set a daily quota in the console as a second safety net. |
| `ANTHROPIC_API_KEY` | GitHub secret | From console.anthropic.com. Set a monthly spend limit on the workspace. |
| `IMPORT_DATABASE_URL` | GitHub secret | The Neon **direct (unpooled)** connection string of the database the site uses. |
| `GITHUB_DISPATCH_TOKEN` | Vercel env | Fine-grained GitHub token on this repository with *Actions: read and write*. Lets the admin start the worker. Without it, start the "Import worker" workflow by hand in the Actions tab. |
| `IMPORT_MODEL` (optional) | GitHub variable | Claude model for extraction. Defaults to `claude-opus-5`. `claude-sonnet-5` or `claude-haiku-4-5` cost less; every record is still reviewed. |
| `PLACES_USD_PER_1000` (optional) | Vercel env | Price used by the admin's cost estimate. Default 40. |

## Running it locally

```bash
cd web
DATABASE_URL=... GOOGLE_MAPS_API_KEY=... ANTHROPIC_API_KEY=... npm run import:work -- --max-minutes 30
```

The worker resumes where it stopped. A run can be paused, resumed or canceled from `/ops/import` at any time, and a lease makes sure only one worker processes a run.

## Legal notes

- Business contact details of sole traders are personal data under the Israeli Privacy Protection Law (Amendment 13). Confirm the database registration and notice duties with counsel before launch.
- Outreach to these businesses by email or SMS is subject to section 30A of the Communications Law. Confirm what may be sent without prior consent before any campaign.
- Google data is used through the official API. Only what the listing needs is stored; photos are not copied.
