# Directory import

Builds unclaimed listings from public data. A run finds businesses on Google, reads each business's own website, extracts categories and the treatment menu with Claude, and checks every record for duplicates and missing data. Nothing reaches the public site until someone on the ops team approves it at `/ops/import/review`.

## How it works

1. **Discover** (`scripts/import/places.ts`). Two sources, chosen per run:
   - A map grid by Google place type (hair salon, nail salon, spa, beauty salon and so on). Cells that come back full (20 results) are split into quarters until nothing is missed.
   - Text queries per category and city ("השתלת שיער חיפה"). These catch clinics that Google files under doctor or dentist.
   Every call is counted against the run's cap before it is sent.
2. **Enrich** (`scripts/import/crawl.ts`, `search.ts`). For each business, in order, until an email is found:
   - **Its own website.** Reads the home page plus up to six contact, price and treatment pages, and guesses `/contact` and `/צור-קשר` when the menu is built by scripts. It respects robots.txt and waits between requests. A plain request with ordinary browser headers comes first. When that is blocked (403, Cloudflare check) or the page is built by JavaScript (Wix, React), a headless Chromium renders it instead. Both go through `CRAWL_PROXY` when it is set, which fixes sites that refuse visitors from outside Israel.
   - **Its public Facebook and Instagram pages** (with `CRAWL_SOCIAL=1`), read without logging in. A page behind a login wall gives nothing.
   - **A web search** (with `BRAVE_SEARCH_API_KEY`) for "name + city + email", limited to Israeli results. It trusts only results on the business's own site or social page, or titled with its name. Emails found this way always go to review ("הדוא״ל נמצא בחיפוש, צריך לאמת").
   It also collects phones, WhatsApp, Instagram and Facebook links, and checks each email domain for MX records.
3. **Extract** (`scripts/import/extract.ts`). Claude reads the page text (at most about 24,000 characters per business, repeated menus and footers removed) and returns categories, business type, the treatment list with prices as shown, and a short neutral description. The output is constrained to a JSON schema and validated again. Emails Claude reports are kept only if the crawler also found them. When Claude is busy or rate-limited, the record waits for the next pass instead of failing. If the API rejects an option (such as server-side fallbacks), the call is retried without it. A bad key, no credit or an unknown model stops the run, and the reason is shown on the run card.
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
- **Run again for incomplete records** (on a finished run): sends records without an email or with a failed extraction back through enrichment and extraction. Google is not called again.
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
| `CRAWL_PROXY` (optional) | GitHub secret | `http://user:pass@host:port` of an Israeli proxy (for example a residential or datacenter proxy with country IL from Bright Data, Oxylabs, Smartproxy or IPRoyal). Used only for reading business websites. |
| `BRAVE_SEARCH_API_KEY` (optional) | GitHub secret | From api-dashboard.search.brave.com. Web search for records without an email. |
| `CRAWL_SOCIAL` (optional) | GitHub variable | `1` to read public Facebook and Instagram pages. See the legal notes. |

## Running it locally

```bash
cd web
DATABASE_URL=... GOOGLE_MAPS_API_KEY=... ANTHROPIC_API_KEY=... npm run import:work -- --max-minutes 30
```

The worker resumes where it stopped. A run can be paused, resumed or canceled from `/ops/import` at any time, and a lease makes sure only one worker processes a run.

## Legal notes

- Business contact details of sole traders are personal data under the Israeli Privacy Protection Law (Amendment 13). Confirm the database registration and notice duties with counsel before launch.
- Outreach to these businesses by email or SMS is subject to section 30A of the Communications Law. Confirm what may be sent without prior consent before any campaign.
- Facebook's and Instagram's terms forbid automated collection without permission. Reading public pages without logging in is a gray area; it is off by default (`CRAWL_SOCIAL`). Leave it off if that risk is not acceptable.
- Google data is used through the official API. Only what the listing needs is stored; photos are not copied.
