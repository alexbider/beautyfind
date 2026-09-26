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

**Stage 2A: the business's own website** (`scripts/import/crawl.ts`, `stages/enrich.ts`, extraction `src/lib/import/siteExtract.ts`, classification `src/lib/import/websiteKind.ts`, service vocabulary `src/lib/import/services.ts`).

- **What counts as the website.** Every website value (from the provider or typed by staff) is classified first:
  - *own site* or *social profile* (Facebook, Instagram, TikTok, YouTube page): kept as the website;
  - *link-in-bio page* (Linktree and similar): read once to find the real site, socials and booking link;
  - *booking page* (Tor4You, Fresha, Calendly…) and *WhatsApp link*: moved to the booking and WhatsApp fields;
  - *directory or third party* (easy, b144, Dapei Zahav, Google Maps, Waze, health funds, gov.il, review and delivery sites, shorteners): never kept. The link is recorded as a rejected observation and shown on the record.
  Staff edits are validated the same way.
- **The site must belong to the business.** After reading it, its phones, site name and domain are compared with the listing. A site that shows its own phones and another name is dropped as *unrelated* (its emails and phones are not used). A site with nothing to compare is kept and flagged "website unverified" for review.
- Social profiles are kept as links but not read (login walls and platform terms). An account is **verified** (and published) only when the business's own site links to it, when its handle equals the site's domain label, when the provider and a link-in-bio page both name it, or when the owner entered it. A same-name account from the provider alone stays in `socials` for review and is not shown (`src/lib/import/socials.ts`).
- **Progressive page budget.** The first `crawlMaxPages` (default 5) relevant pages are read: contact, prices, services, gallery, team, about, branches, videos, found through same-site links and one bounded read of `/sitemap.xml`. The budget extends once to `crawlMaxPagesExtended` (default 12) only while template fields are still missing (phone, email, hours, three services, a price, five photos, a team member, a description) and stops as soon as they are covered.
- **Profile facts** (`src/lib/import/profileExtract.ts`): people named with a role on the site (name + role cards, with the paragraph under them as the biography; a single signature on a non-team page does not count), YouTube ids and channel links, languages only from an explicit "we speak" statement (never the site's own language), the founding year from "since" wording (never years of experience or post dates). Images on a before/after page or with a before/after caption are kept as candidates that wait for the owner's confirmation and are never published by the import.
- **Prices** keep their published form: fixed, from, range (with the upper bound), per unit / ml / area, package (with the session wording), published free, and **on_request** when the site lists the service without a price. An unknown price is stored as null, never 0, and the profile shows "המחיר לא פורסם" with a "לקבלת מחיר ופרטים" action that carries the business, branch and service ids. Imported prices are stored as published (tax status unknown); nothing is converted or assumed.

**Stage 2C: editorial writing** (`src/lib/import/editorial.ts`, `scripts/import/editorialCall.ts`, `stages/editorial.ts`).

- One structured call per profile on a compact **evidence packet** (name, city, address, categories, services with prices, hours, which contact channels exist, verified socials, team, languages, founding year, accessibility, parking, the business's own description and FAQs, rating, media counts). Never the raw pages, never raw phone numbers or emails.
- Output: the Hebrew description (450 to 550 words, short paragraphs, third person), five to eight FAQs each with the packet fields it rests on, meta title and description, one-line service summaries, the section heading (על הקליניקה / על המספרה / על הספא / על הסטודיו / על העסק), and `insufficientEvidence` with the missing items.
- Deterministic checks after the call: every number, price, year and named person must exist in the packet; no em or en dashes; no generic praise, no first person as the owner, no exclamation marks, no Markdown, no booking-through-BeautyFind claims when native booking is off; FAQ count and lengths; meta lengths. At most **one repair call** with the exact problems; the draft with fewer problems is kept and the rest are shown in admin.
- Cached by `sha256(packet) + PROMPT_VERSION`; the same evidence is never paid for twice. Reserved against the run budget and the per-run editorial cap (`editorialBudgetUsd`, `editorialMaxPerRun`) before dispatch, settled at the token cost the API reports (`editorialCostUsd`). Model: `IMPORT_EDITORIAL_MODEL` (default `claude-sonnet-5`).
- A draft under 450 words is stored as it is with `needsMoreInfo` and the missing evidence; it fills an empty description but never replaces existing text. A complete draft replaces our earlier imported text on unclaimed listings; owner text (claimed, or `ownerApproved`) is never touched. `IMPORT_EDITORIAL_MOCK=1` (tests, simulation) uses the deterministic template draft instead of the API.

**Stage 2D: media and videos** (`src/lib/server/importMedia.ts`, `src/lib/import/youtube.ts`).

- Each copied image keeps a provenance record on the listing (`mediaProvenance`): source asset URL, page or profile, provider, retrieval time, dimensions, bytes, sha256 (duplicates dropped), alt text, reuse basis (`business_published`: the business's own published material about itself), status and derivative type. The served file is a WebP (orientation corrected, metadata stripped, banner up to 1600px, gallery 1200px, logo 512px; quality lowered until the banner is about 350KB and gallery images about 160KB); the safe original is stored privately next to it. The first landscape photo becomes the banner. A listing with no approved photo shows a neutral branded monogram and `hero_media_missing` in admin; nothing is generated or borrowed.
- YouTube: ids found on the official site are validated (Data API `videos.list` in batches of 50 when `YOUTUBE_API_KEY` is set, 1 quota unit per call; otherwise the public oEmbed endpoint, no key, no quota). With the key, the verified channel's uploads are read (2 units) when fewer than `youtubeMaxVideos` playable videos were found. Quota is counted per run (`youtubeQuotaPerRun`). Only public, embeddable videos reach the profile, as click-to-load `youtube-nocookie` players behind the embed consent. Nothing is downloaded or rehosted.

**Coverage and readiness** (`src/lib/import/coverage.ts`, `docs/coverage-manifest.md`). Every visible template element has a manifest entry (implementation, data, source rule, honest fallback, action, test). `coverageOf()` scores a listing into two separate numbers, template coverage (every section renders content or a truthful state) and evidence readiness (weighted sections filled with sourced content), and classifies it as `ready`, `ready_with_disclosed_gaps`, `needs_owner_information` or `needs_review`. The result is stored on the listing and the record (`profileStatus`, `profileChecklist`) and shown in the admin checklist.
- Plain HTTP only, as `BeautyFindBot/1.0`, respecting robots.txt, with a pause between pages. Home page plus up to 5 relevant pages (contact, prices, services, gallery, about), depth 2 or less; it stops early once it has an email, a phone and at least three priced services.
- **Services.** Read from JSON-LD offers, price lines with the name before or after the price, card layouts (name, then price on the next line), ranges and "from" prices, and short menu items that name a known treatment (listed without a price). Each service gets one of our categories, a medical flag, a duration when written, and the line it came from. Services are merged with what the record already has (a price fills a missing one; nothing is dropped). A category is added when the site has one priced or two listed services in it (unless staff edited the categories). On approval, unpriced services are saved but hidden until the owner prices them.
- **No website of its own.** When a business has no own site or social profile (or its link was a directory or another business's site), its Google profile link (Maps, by cid) becomes the website.
- **Google rating.** The Google rating and review count from DataForSEO are kept for every business that has reviews and published with a link to its Google profile (`publishProviderRatings`, on). Review texts are not collected.
- **Logo and photos.** The Google profile logo and main photo (DataForSEO, larger rendition) are candidates for every business (`useProviderImages`, on) and are used when the site has none. Logo candidates (JSON-LD logo, header logo images, touch icon) and photos (large content images, lazy-loaded and srcset images at their largest size, og:image, JSON-LD images) are collected; icons, SVG, GIF, tracking pixels and social or payment badges are skipped. The best logo and up to `maxListingPhotos` photos are pre-selected; staff can change the choice in review. On approval the chosen files are downloaded through the same SSRF-safe fetch, checked to be real JPEG/PNG/WebP files of a usable size, stored in our own storage and set as the listing's logo, cover and gallery. Nothing is hotlinked. Controlled by `useWebsiteImages` (on by default).
- Reads mailto/tel links, JSON-LD (`telephone`, `email`, `address`, `openingHoursSpecification`, `sameAs`), explicit WhatsApp links, social profile links and known booking hosts. Every fact keeps its page URL and a short evidence snippet.
- The site builder's footer email ("נבנה ע"י…", "powered by…") is set aside, never used.
- Emails get a status: `dns_valid` (the domain accepts mail) or `syntax_valid`. Mailboxes are never probed over SMTP.
- The provider's phone stays. The site's number fills it only when the site shows exactly one number. A different number, or hours that disagree, is a **conflict** and sends the record to review.
- An explicit block (401, 403, 429, 451, a challenge page) stops that site. No proxies, no challenge bypassing.
- Results are cached per domain (`site_fetches`): one crawl serves every branch on the same domain; conditional requests (ETag, Last-Modified) and content hashes avoid re-reading unchanged pages; rechecks after 30 days, or 7 after a failure (negative cache).
- SSRF protection (`src/lib/import/safeFetch.ts`): only http/https on ports 80/443, no credentials in URLs, DNS checked at connect time so the address connected is the address checked, every redirect (at most 5) checked again, private/loopback/link-local/metadata ranges refused, size and time caps.
- Optional and off by default: a capped headless-browser render (`browserFallback`, `browserMaxPerRun`) and an LLM step (`llmEnabled`, `llmBudgetUsd`) that returns categories and treatments only with a quote from the page; it adds services and fills missing prices but never replaces what the site stage found.

**Stage 2B: Google Places (New), selective** (`src/lib/server/googleDisplay.ts`, `src/lib/import/googleFields.ts`).

- Off unless `GOOGLE_ENRICHMENT_ENABLED=true` in Vercel **and** the admin switch is on. The kill switch wins.
- Used only when a staff member presses "אימות מול Google" or "דירוג ב־Google" on a record. Never on page views, cards, crawlers or at import time.
- Explicit allowlisted field masks, never `*`. The SKU is taken from the highest-tier field in the mask. Each call is reserved against the daily and monthly caps first.
- Google content is shown in a separate, attributed panel and never copied into listing fields, exports, logs or analytics. Only the place id is kept permanently and the location for 30 days (`google_display`, deleted on expiry by the sweep that runs before each lookup and at the start of each worker).
- Photos: off (`googlePhotoCap` 0). When enabled, one photo URI per lookup, capped per day, never stored.

**Listing template.** Every field the listing page shows has a source, in this order:

| Field | Sources |
|---|---|
| Phone, address, map pin | DataForSEO, then the site |
| Email | The site (contact page first), then DataForSEO contact info |
| Website | Own site, else social profile, else the Google profile link |
| WhatsApp, Instagram, Facebook, booking link | The site, the Google profile's reservation link |
| Opening hours | DataForSEO, then the site (JSON-LD, then hours written as text: "א'-ה' 09:00-19:00", "Sun-Thu…") |
| Logo, cover, gallery | The site's images (gallery pages read early), then the Google profile logo and main photo, then photos from the business's own Google posts when it still has fewer than five; picked in review, copied on approval (up to 8; the gallery shows 5). A photo that fails the size check is replaced by the next candidate. |
| Description | The Google profile description, then the site's own (JSON-LD, meta description), else a factual summary built from the record (categories, city, services, rating) |
| Services and prices | The Google profile's services, the site's price lists and menus |
| Categories | Provider categories, plus categories the site clearly offers |
| Google rating and review count, Google profile link | DataForSEO |
| Wheelchair access, free parking | Google attributes, then explicit statements on the site |
| FAQs | The site's FAQ (JSON-LD FAQPage or question/answer blocks) |
| Waze link | Built from the map pin |

The review screen shows each record's completeness and what is still missing.

**Google post photos** (`stages/googlePosts.ts`, setting `googlePostPhotos`, on). For records with fewer than five photos after the website stage: DataForSEO Google business updates (the business's own posts), up to 100 tasks per request, reserved against the run budget at an unverified $0.004 per task (the reported cost is recorded), collected for up to 20 minutes.

**Listing addresses.** Listings live at `/:region/:category/:slug`, the category being the listing's first category in catalog order. `/:region/biz/:slug` and any other category redirect there permanently (308), so old links keep working. The rewrite in `next.config.ts` only matches category slugs, which never overlap with city slugs.

**Enhancing published listings** (`stages/enhance.ts`, `src/lib/server/importEnhance.ts`). A separate run type, started from `/ops/import` ("העשרת עסקים שפורסמו") or for chosen records on the review screen's approved tab. For live listings that came from the import and that no owner has claimed:
1. optionally refreshes the DataForSEO data (one request per up to 500 listings, filtered by cid, reserved against the run budget);
2. reads each business's website again;
3. fills only what the listing is missing: contact details, hours, description, FAQs, accessibility, parking, Waze and Google profile links, logo, cover and gallery (copied to storage), categories, services and missing prices. The Google rating is refreshed. Nothing that is already on a listing is overwritten, and claimed listings are never touched.
The worker needs `BLOB_READ_WRITE_TOKEN` as a GitHub secret to copy images; without it the run fills everything else and reports how many listings are waiting for images.

**Checks** (`stages/check.ts`). Over every open record, not only this run's:

- Duplicates: automatic only for the same place id, or a shared phone/email plus a matching name. A shared domain or a chain's central phone never merges two branches. Weaker matches go to review.
- Existing listings: compared with every live branch. A possible match goes to review with a merge button.
- Publication minimum (settings): name, category, a location, and a phone or an email (`requirePhoneOrEmail`, default). Email alone can be made mandatory (`requireEmail`, off). Conflicts, possible duplicates, medical categories and similar go to review. Staff-edited fields are never overwritten by a rerun.

## Admin (`/ops/import`)

Only the `ops` staff role. Every action is written to `audit_logs`.

- **New run**: provider (DataForSEO; Google kept for old runs), cities or all Israel, categories, record limit, USD ceiling, with the maximum cost shown before starting. "Preview" stages 10 records; "Import to staging" stages up to the limit.
- **Run card**: pause, resume, cancel, retry incomplete, spend and reservations per provider, pages needing reconciliation, website outcomes for records without an email, CSV exports.
- **Settings**: kill switch, provider switches, pilot defaults, crawl limits, recheck days, browser and LLM switches and caps, Google caps, publication minimum, provider ratings.
- **Estimator**: cost for 100, 1,000 and 10,000 businesses with the assumptions shown.
- **Review** (`/ops/import/review`): per record the source, the website and what kind it is (or the directory link that was dropped), email status, website outcome, conflicts, services with category and price, a logo and photo picker, and an evidence table (value, source link, date, confidence, quote). Select records and "בדיקה חוזרת של האתר" to re-read their sites. Approve, merge, edit, reject, mark duplicate, restore. Publish the ready records on the page, or every ready record in a run. "Needs review" records are never bulk-published.
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
| `ANTHROPIC_API_KEY`, `IMPORT_EDITORIAL_MODEL`, `IMPORT_MODEL` | GitHub secret / variables | Editorial writing (description, FAQs, meta; default model `claude-sonnet-5`) and the optional extraction step. Without the key the worker stops the editorial stage with `no_api_key` and listings keep their source text. |
| `YOUTUBE_API_KEY` | GitHub secret | Optional. Video status and channel discovery through the Data API. Without it, videos found on the site are validated with oEmbed and channels are not followed. |
| `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` | Vercel env | The interactive map (Maps Embed API, place mode, no usage charge at the time of writing). A **browser** key restricted to our domains and to the Maps Embed API only; keep it separate from server keys. Without it the profile shows the schematic map with Waze and Google directions links. |
| `IMPORT_BROWSER` | GitHub variable | `1` installs Chromium for the optional browser fallback. |
| `IMPORT_PRICING_JSON` | GitHub variable / Vercel env | Optional price override. |
| `BLOB_READ_WRITE_TOKEN` | GitHub secret | Lets the worker copy images when enhancing published listings. The same value as in Vercel. |

No secret is ever sent to the browser or printed in logs.

## Commands

```bash
cd web
npm run import:dryrun                         # cost estimate, no credentials
npm run test:import                           # unit tests + DB tests (DB tests need a local DATABASE_URL)
npm run import:simulate                       # SIMULATED pilot on a mock provider and fixture sites (local DB only), editorial in mock mode
npm run import:manifest                       # regenerate docs/coverage-manifest.md from src/lib/import/coverage.ts
npm run import:screenshots -- --url <listing> # 390 / 768 / 1440px screenshots of a running listing page (Playwright)
npm run import:dfs-categories -- --confirm    # check the category ids against DataForSEO (live, may be billed)
npm run import:work -- --max-minutes 30       # the worker (normally runs in GitHub Actions)
```

The worker resumes where it stopped; a lease makes sure only one worker processes a run.

## First live pilot

1. Add the DataForSEO secrets. Top up the minimum balance yourself; nothing here buys credits.
2. Category ids were checked on 2026-09-25 (all 31 exist). Re-run the check from the "Import maintenance" workflow after changing `DFS_CATEGORY_MAP`.
3. In `/ops/import`: DataForSEO, one city, record limit 100, ceiling $1. Check spend on the run card against the DataForSEO usage log.
4. Review the records, then decide on a bigger run. There is no automatic national crawl.
5. For complete profiles add `ANTHROPIC_API_KEY` (and `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` on Vercel). A 10-business pilot with the editorial writer costs roughly DataForSEO $0.02 + editorial $0.6 to $0.8 (Sonnet, one repair in four) at the reference rates; YouTube oEmbed and Maps Embed are free. The admin checklist on each record shows the words, FAQ count, media, video, map and cost per profile; the run card shows the editorial calls, cache hits and YouTube quota.

## Source-use constraints

- `src/lib/import/sourcePolicy.ts` says what is kept and published per source. DataForSEO ratings and photos (which come from Google) stay unpublished until the terms are confirmed; record any change in `docs/decisions.md`.
- Logos and photos come only from the business's own website, are chosen by staff, and are copied to our storage. The listing says it is not managed by the business, and the owner can replace or remove them after claiming. Turn `useWebsiteImages` off if that is not acceptable.
- Google content only through the attributed provider view, with the retention above.
- Business contact details of sole traders are personal data under the Israeli Privacy Protection Law (Amendment 13). Confirm the database registration and notice duties with counsel before launch.
- Outreach by email or SMS is subject to section 30A of the Communications Law.
- No social-network scraping, no web-search scraping, no proxies.
