# Directory import

Builds unclaimed listings from public business data at low cost. Records are staged, checked and reviewed; nothing reaches the public site until someone on the ops team approves it at `/ops/import/review`. Owner-confirmed data and staff edits always win over imported data.

## Stages

**Stage 1: discovery with DataForSEO** (`scripts/import/stages/dfsDiscover.ts`, provider client `scripts/import/providers/dataforseo.ts`, mapping `src/lib/import/dataforseo.ts`).

- Business Listings Search (live), one request per page of up to 1,000 records. Tasks are *area x category chunk* (at most 10 category ids per request, results filtered to country code IL). A city uses its centre and radius from the catalogue; "all Israel" uses one circle over the country.
- Every page is a unit of work with a stable request key (`dfs:<task>:<page>:<staff resend>:<retry>`):
  1. check the kill switch, the run's record limit and its budget;
  2. reserve the page's gross maximum cost (atomic, see Costs);
  3. checkpoint the task as `dispatched`;
  4. send, then commit the cost DataForSEO reports;
  5. store items and checkpoint `offset` / `offset_token`.
- A request that was sent but got no answer (timeout, reset) counts as spent and the page becomes **needs_reconciliation**. It is never resent automatically. On the run card staff either keep it as billed or mark it not billed, optionally sending it again under a new key.
- A fatal provider error (authorization, payment, balance) stops the run with the provider's message. Rate limits and 5xx get at most three retries with backoff.
- Each place is stored once: the key is the Google place id when DataForSEO returns one, otherwise `dfs:cid:<cid>`. Items without coordinates are skipped. The number shown is "matching records in the provider's database", not the number of businesses in Israel.
- What the provider said is kept as **field observations** (value, source URL, retrieval and source-update times, confidence, publishable flag). Ratings and photos are stored as observations but are not publishable until the provider's terms are confirmed (setting `publishProviderRatings`).

**Stage 2A: the business's own website** (`scripts/import/crawl.ts`, `stages/enrich.ts`, extraction `src/lib/import/siteExtract.ts`).

- Plain HTTP only, as `BeautyFindBot/1.0`, respecting robots.txt, with a pause between pages. Home page plus at most 4 relevant pages (contact, about, services, prices, branches), depth 2 or less, stopping early once an email and a phone are found.
- Skipped when there is no website or the record already has email, phone and hours.
- Reads mailto/tel links, JSON-LD (`telephone`, `email`, `address`, `openingHoursSpecification`, `sameAs`, `logo`), explicit WhatsApp links, social profile links, known booking hosts and explicit ₪ price lines. Every fact keeps its page URL and a short evidence snippet.
- The site builder's footer email ("נבנה ע"י…", "powered by…") is set aside, never used.
- Emails get a status: `dns_valid` (the domain accepts mail) or `syntax_valid`. Mailboxes are never probed over SMTP.
- The provider's phone stays. The site's number fills it only when the site shows exactly one number. A different number, or hours that disagree, is a **conflict** and sends the record to review.
- An explicit block (401, 403, 429, 451, a challenge page) stops that site. No proxies, no challenge bypassing.
- Results are cached per domain (`site_fetches`): one crawl serves every branch on the same domain; conditional requests (ETag, Last-Modified) and content hashes avoid re-reading unchanged pages; rechecks after 30 days, or 7 after a failure (negative cache).
- SSRF protection (`src/lib/import/safeFetch.ts`): only http/https on ports 80/443, no credentials in URLs, DNS checked at connect time so the address connected is the address checked, every redirect (at most 5) checked again, private/loopback/link-local/metadata ranges refused, size and time caps.
- Optional and off by default: a capped headless-browser render (`browserFallback`, `browserMaxPerRun`) and an LLM step (`llmEnabled`, `llmBudgetUsd`) that returns categories and treatments only with a quote from the page; anything the quote does not support is dropped.

**Stage 2B: Google Places (New), selective** (`src/lib/server/googleDisplay.ts`, `src/lib/import/googleFields.ts`).

- Off unless `GOOGLE_ENRICHMENT_ENABLED=true` in Vercel **and** the admin switch is on. The kill switch wins.
- Used only when a staff member presses "אימות מול Google" or "דירוג ב־Google" on a record. Never on page views, cards, crawlers or at import time.
- Explicit allowlisted field masks, never `*`. The SKU is taken from the highest-tier field in the mask. Each call is reserved against the daily and monthly caps first.
- Google content is shown in a separate, attributed panel and never copied into listing fields, exports, logs or analytics. Only the place id is kept permanently and the location for 30 days (`google_display`, deleted on expiry by the sweep that runs before each lookup and at the start of each worker).
- Photos: off (`googlePhotoCap` 0). When enabled, one photo URI per lookup, capped per day, never stored.

**Checks** (`stages/check.ts`). Over every open record, not only this run's:

- Duplicates: automatic only for the same place id, or a shared phone/email plus a matching name. A shared domain or a chain's central phone never merges two branches. Weaker matches go to review.
- Existing listings: compared with every live branch. A possible match goes to review with a merge button.
- Publication minimum (settings): name, category, a location, a phone or website (`requirePhoneOrWebsite`), and an email (`requireEmail`). Conflicts, possible duplicates, medical categories and similar go to review. Staff-edited fields are never overwritten by a rerun.

## Admin (`/ops/import`)

Only the `ops` staff role. Every action is written to `audit_logs`.

- **New run**: provider (DataForSEO; Google kept for old runs), cities or all Israel, categories, record limit, USD ceiling, with the maximum cost shown before starting. "Preview" stages 10 records; "Import to staging" stages up to the limit.
- **Run card**: pause, resume, cancel, retry incomplete, spend and reservations per provider, pages needing reconciliation, website outcomes for records without an email, CSV exports.
- **Settings**: kill switch, provider switches, pilot defaults, crawl limits, recheck days, browser and LLM switches and caps, Google caps, publication minimum, provider ratings.
- **Estimator**: cost for 100, 1,000 and 10,000 businesses with the assumptions shown.
- **Review** (`/ops/import/review`): per record the source, email status, website outcome, conflicts, and an evidence table (value, source link, date, confidence, quote). Select records and "בדיקה חוזרת של האתר" to re-read their sites. Approve, merge, edit, reject, mark duplicate, restore. Publish the ready records on the page, or every ready record in a run. "Needs review" records are never bulk-published.
- **Exports** (`/ops/import/export?run=<id>&kind=canonical|audit`): the canonical CSV has only publishable fields (no Google content, no Maps links, provider ratings only when enabled); the audit CSV has counts, reasons, website outcomes, spend per provider and open reconciliation items.

## Costs

Prices are versioned in `src/lib/import/pricing.ts` (override with `IMPORT_PRICING_JSON`). Reference rates for DataForSEO Business Listings Search: **$0.012 per request + $0.00036 per record**, supplied on 2026-09-25 and not fetched (the pricing page was not reachable from the build environment). Google Place Details prices in the file are unverified; confirm them before turning Google on.

- Every paid call reserves its gross maximum before it is sent, with single conditional SQL updates in one transaction against the run budget and each provider cap. Concurrent workers cannot overspend.
- Settling is idempotent: a request key is never billed twice by us.
- Pilot default: 100 records, $1 ceiling. At most one request: $0.012 + 100 x $0.00036 = **$0.048** gross, before tax and any minimum top-up DataForSEO requires.
- `npm run import:dryrun` prints the estimate for 100 / 1,000 / 10,000 businesses without credentials or network.

## What you need to provide

| What | Where | Needed for |
|---|---|---|
| `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | GitHub secrets | Stage 1. API login and password from the DataForSEO dashboard (not the account password if they differ). |
| `IMPORT_DATABASE_URL` | GitHub secret | The worker. Neon **direct (unpooled)** connection string. |
| `GITHUB_DISPATCH_TOKEN` | Vercel env | Starting the worker from the admin. Fine-grained token on this repository with *Actions: read and write*. Without it, start "Import worker" in the Actions tab. |
| `GOOGLE_ENRICHMENT_ENABLED` | Vercel env | Stage 2B. `true` to allow Google lookups at all. Default off. |
| `GOOGLE_MAPS_API_KEY` | Vercel env (2B), GitHub secret (legacy runs) | Places API (New) key, restricted to that API, with a console quota as a second safety net. |
| `ANTHROPIC_API_KEY`, `IMPORT_MODEL` | GitHub secret / variable | Optional LLM step only. |
| `IMPORT_BROWSER` | GitHub variable | `1` installs Chromium for the optional browser fallback. |
| `IMPORT_PRICING_JSON` | GitHub variable / Vercel env | Optional price override. |

No secret is ever sent to the browser or printed in logs.

## Commands

```bash
cd web
npm run import:dryrun                         # cost estimate, no credentials
npm run test:import                           # unit tests + DB tests (DB tests need a local DATABASE_URL)
npm run import:simulate                       # SIMULATED pilot on a mock provider and fixture sites (local DB only)
npm run import:dfs-categories -- --confirm    # check the category ids against DataForSEO (live, may be billed)
npm run import:work -- --max-minutes 30       # the worker (normally runs in GitHub Actions)
```

The worker resumes where it stopped; a lease makes sure only one worker processes a run.

## First live pilot

1. Add the DataForSEO secrets. Top up the minimum balance yourself; nothing here buys credits.
2. Category ids were checked on 2026-09-25 (all 31 exist). Re-run the check from the "Import maintenance" workflow after changing `DFS_CATEGORY_MAP`.
3. In `/ops/import`: DataForSEO, one city, record limit 100, ceiling $1. Check spend on the run card against the DataForSEO usage log.
4. Review the records, then decide on a bigger run. There is no automatic national crawl.

## Source-use constraints

- `src/lib/import/sourcePolicy.ts` says what is kept and published per source. DataForSEO ratings and photos, and website logos, stay unpublished until the terms are confirmed; record any change in `docs/decisions.md`.
- Google content only through the attributed provider view, with the retention above.
- Business contact details of sole traders are personal data under the Israeli Privacy Protection Law (Amendment 13). Confirm the database registration and notice duties with counsel before launch.
- Outreach by email or SMS is subject to section 30A of the Communications Law.
- No social-network scraping, no web-search scraping, no proxies.
