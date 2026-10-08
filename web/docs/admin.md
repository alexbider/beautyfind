# Master admin (`/ops`)

The BeautyFind staff console, built to the `BeautyFind_Master_Admin.html` design: a right-hand sidebar with grouped areas, a top bar with search and the assistant button, and one page per area. Every number on it is read from the database or measured at request time; where no backend exists yet the page says so instead of showing a placeholder.

## Sign-in and roles

Staff sign in at `/ops/login` with email and password. The first admin sets a password through `/ops/setup?token=…` (the token's SHA-256 is `OPS_SETUP_TOKEN_HASH`, the account is `OPS_BOOTSTRAP_EMAIL`). Everyone else is invited from `/ops/team`: the invite creates the account with its role and a one-time link to the same setup page, valid seven days. There is no messaging provider by default, so the inviter sends the link.

Roles (`src/components/ops/roles.ts`): `ops` (מנהל־על), `verifier`, `moderator`, `support`, `legal`. Each role has a level in each of the 18 areas: `none` hides the menu item, `view` reads, `edit` acts, `full` also changes the area's settings. The defaults follow the permissions handoff; the ops role can change the others from the matrix on `/ops/team`, and the result is stored in platform settings (`rolePermissions`). The ops role is always full, so the admin cannot lock itself out. Guards: `requireArea(area, level, next)` for pages, `areaUserOrNull(area, level)` for server actions.

Two-factor authentication does not exist in the system; the team page says so for every account rather than pretending.

## Areas

| Route | What it reads and does |
|---|---|
| `/ops` | KPIs from live subscriptions, businesses, bookings and churn; 12 months of platform income; the attention list from the real queues; recent activity; AI cost; service health. |
| `/ops/search?q=` | Businesses, clients, bookings and documents by name, phone, ref. |
| `/ops/businesses` | Two views. The list: filters by status, region, city, category, ownership and plan, CSV export; the business card edits the business details (legal name, company number, type, invoice emails, chain key), changes status with a reason, and links to the full editor of every branch. The gaps view (חוסרים והשלמה ב־AI): every live listing scored against the profile template with readiness, missing sections, the automatic plan and the last run, filterable by missing section and profile status, with tick boxes and one button that starts the AI completion for the selection (below). |
| `/ops/businesses/[id]/branches/[branchId]` | The full branch editor: details (name, slug, region, city, address, coordinates, contact, website, Waze, Google profile, medical responsible, categories with the primary one, hours with unknown days, flags, status, claimed), content (description, section heading, approved flag, FAQs, meta title and description), media (cover, logo, gallery with alt text and tags, YouTube videos; uploads go through `/ops/businesses/upload` under the business), facts (socials, year, team size, languages, people named on the site, tri-state accessibility and parking), treatments (every column: price type, price, range, note, duration, published, medical, declaration, online, VAT), and the AI tab. Every save validates like the owner's editor, writes one audit row with the changed fields and refreshes the public pages. |
| `/ops/clients` | Client accounts with consent and block/unblock; privacy requests with due dates; completing a deletion anonymizes the account. |
| `/ops/bookings` | Every booking with filters and KPIs. |
| `/ops/disputes` | Deposit and gift card disputes opened from a booking ref or gift code, with the system facts and the policy shown; decisions: recommend refund, policy upheld, escalate to legal. |
| `/ops/sponsored` | Sponsored placements (`Campaign`) reviewed before going live: forbidden promises, line length, capacity per list, open debt. Approve or reject with a reason. Orders are entered by staff; there is no business-side flow yet. |
| `/ops/moderation` | Reviews queue (publish, reject, remove) and reports from contact messages. |
| `/ops/verification` and `/ops/import/*` | The existing consoles, unchanged in behaviour, rendered inside the new shell. |
| `/ops/accounting` | Income ledger, subscriptions and charges, expenses, VAT note, profit and loss, manual platform invoices, accountant export. Platform invoices carry no Israeli VAT (`docs/decisions.md`). |
| `/ops/content` | Per-page SEO overrides (`PageSeo`, applied through `applySeo`), the indexing switches (below), Google indexing (below), catalog, sitemap and robots state. |
| `/ops/messages` | The 25-template catalog with what the code already sends, the messaging adapter state, consent counts, editable draft copy. |
| `/ops/ai` | The operations assistant, AI providers, the MCP server tab (connection steps, tools, personal tokens, connected apps, recent calls), the approvals queue, usage and costs (below). |
| `/ops/integrations` | Payments and invoicing providers with connected-business counts, messaging, calendars, analytics, import sources, operations. "בדיקה" runs a free check (database round trip, site, GitHub workflow state, key presence). Secrets are never shown. |
| `/ops/team` | Staff accounts, last admin sign-in (from the audit log), invites, role changes, the permissions matrix. |
| `/ops/audit` | Audit log and decisions merged, filtered by people, AI or system, CSV export. Append-only. |
| `/ops/settings` | Platform settings (pricing, VAT display rate, billing retry days, hide-in-debt days, gift card validity, feature switches, maintenance mode). |
| `/ops/health` | Database and site latency, worker heartbeat, import queues, open sessions, failed runs, provider connections in error. Uptime history is not measured. |

## Platform settings

One JSON row (`platform_settings`, id 1) parsed with `PlatformSettingsSchema`; code constants are the defaults so an empty row behaves exactly as before. Where they are read:

- `basicMonthlyNis`, `advancedMonthlyNis`: MRR on the overview and accounting pages, the assistant's business tool. New subscriptions take the setting at signup; existing subscriptions keep their stored price.
- `sponsoredWeeklyNis`, `sponsoredMaxPerList`: sponsored orders and capacity checks.
- `vatRatePct`: clinic-side display only. Platform billing has no Israeli VAT.
- `onlineBooking`, `giftCards`, `waitlist`: gates on `/book/[branch]`, `/gift/[branch]` and `/waitlist/[branch]` (`src/components/shell/FeatureOff.tsx`). Existing bookings and cards keep working.
- `maintenanceMode`, `maintenanceMessage`: a banner on the home page and the same gates above show the message.
- `clientAssistant`: stored only; nothing on the site reads it yet.
- `rolePermissions`, `templateDrafts`: the team matrix and the messages page.
- `indexSite`, `indexSections`: the indexing switches (below).

## MCP server

Claude (claude.ai, Claude Desktop, Claude Code) can work with the admin through the site's own MCP server at `/api/mcp` (Streamable HTTP, stateless, one `McpServer` per request).

- **Tools:** the registry in `src/lib/server/mcpTools.ts`, which is the whole admin as tools (about forty): overview and finance (`platform_summary`, `billing_overview`, `analytics_30d`, `platform_settings`, `audit_log`); businesses and listings (`search_businesses`, `list_businesses`, `get_business`, `update_business`, `set_business_status`, `list_branches`, `get_branch`, `update_branch_details`, `update_branch_content`, `update_branch_media`, `generate_alt_text`, `update_branch_facts`, `set_branch_treatments`, `list_gaps`, `estimate_ai_completion`, `run_ai_completion`); pages, SEO and indexing (`list_pages`, `update_page_seo`, `get_indexing`, `set_indexing`, `revalidate_pages`); trust (`list_reviews`, `moderate_review`, `list_reports`, `set_report_status`, `list_disputes`, `open_dispute`, `decide_dispute`, `list_campaigns`, `review_campaign`, `create_campaign`); clients (`list_clients`, `block_client`, `privacy_requests`, `complete_privacy_request`); the AI queue (`approvals_queue`, `propose_action`, `decide_ai_action`); and `update_platform_settings`. Each tool names the admin area and level it needs; a caller is offered only the tools their role allows (the matrix on `/ops/team`, with overrides).
- **Writes are the admin's own server actions.** The server runs each call inside `withActor(user, ...)` (`src/lib/server/actorContext.ts`, an AsyncLocalStorage that `currentUser()` consults first), so the same validation, audit rows, decisions and page refreshes happen as when the person clicks in the screen. Patch tools (`update_branch_*`, `update_business`, `update_page_seo`, `update_platform_settings`) read the current record and merge, so a caller sends only the fields that change. Every call is also an `mcp_call` audit row (tool, write flag, client, token kind, error). The in-admin assistant keeps its own read-only catalog in `assistant.ts`.
- **Auth:** every request carries a bearer token that belongs to one staff member. Unauthenticated requests get `401` with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/api/mcp"`, which is how MCP clients discover the OAuth flow.
- **OAuth 2.1 (claude.ai, Desktop, Code):** `/.well-known/oauth-authorization-server` (RFC 8414) and `/.well-known/oauth-protected-resource[/api/mcp]` (RFC 9728); dynamic client registration at `POST /api/mcp/oauth/register` (RFC 7591, public clients by default, redirect URIs must be https or loopback http); the staff member approves on `/ops/mcp/authorize` (login first, then consent listing the tools their role allows); `POST /api/mcp/oauth/token` exchanges the one-time code (PKCE S256, ten minutes) for an access token (7 days) and a refresh token (180 days, rotated on use). Tables: `mcp_clients`, `mcp_tokens` (hashes only), `mcp_auth_codes`.
- **Personal tokens:** on `/ops/ai`, tab שרת MCP, a staff member creates a `bfmcp_...` token (shown once, up to ten live per person) for clients that take a header, such as Claude Code with `--header "Authorization: Bearer ..."`. Revocable there; disconnecting an app revokes every token it holds for that person.
- The tab shows the server URL, connection steps, the tool table with the caller's access, their personal tokens, their connected apps and the last twenty calls. Pure helpers (metadata, PKCE, redirect rules) live in `src/lib/mcp.ts`; the database side in `src/lib/server/mcp.ts`.
- **Magazine tools and scope:** the `magazine` area adds the article tools (authors, categories with parent treatment pages, tags, media, articles, sitemap URLs, site settings; no medical reviewer gate) described in `docs/magazine.md`. A personal token created with "מגזין בלבד", or an OAuth grant for the `mcp:magazine` scope alone, is offered only those tools plus `list_pages`, `revalidate_pages`, `list_branches`, `search_businesses` and `get_indexing`. Calls are rate limited per token (240 calls and 90 writes a minute per instance).

## Indexing

What search engines may index is decided in `src/lib/indexing.ts` (pure) and read on the server by `indexingPolicy()`.

- **Private areas are never indexed and have no switch:** `/ops`, `/biz`, `/clinic`, `/account`, `/saved`, `/login`, `/logout`, `/invite`, `/for-business/join`, `/for-business/claim`, `/pay`, `/receipt`, `/unsubscribe`, `/b/`, `/w/`, `/review/`, `/api`. Three layers: `robots.txt` disallows them, every response under them carries `X-Robots-Tag: noindex, nofollow` (`next.config.ts`, so exports and JSON are covered too), and the `/ops`, `/biz` and `/clinic` layouts declare `robots: noindex, nofollow`.
- **Public sections** (`/ops/content`, tab אינדוקס): one master switch (`indexSite`) and one per section (`indexSections`: home, regions, cities, categories, cityCategories, profiles, content, legal). A section that is off keeps serving its pages, but they get `robots: noindex, follow` through `applySeo` and leave the sitemap. The master switch off also makes `robots.txt` disallow everything and empties the sitemap. Every change is an `indexing_update` audit row and refreshes all public pages, `/robots.txt` and `/sitemap.xml`.
- **Single pages:** the noindex box in the עמודים tab (`PageSeo.noindex`). **Single listings:** the "מוסתר ממנועי חיפוש" box in the branch editor's details (`Branch.noindex`); the profile gets noindex and leaves the sitemap.
- **`STAGING=1`** on the deployment overrides everything: robots.txt disallows all, every response is noindex, the sitemap is empty, and the tab says so. Remove the variable in Vercel to launch; the switches saved meanwhile take effect then.
- Every public page passes its metadata through `applySeo(path, metadata)`, including the directory pages and the business profile, so the policy is applied in one place. Pages that are noindex by design (search, magazine, filtered directories) keep their own robots metadata.

## Google indexing (Indexing API and URL Inspection)

`src/lib/server/googleIndexing.ts`, settings and history on `/ops/content`, tab גוגל. Off until someone turns it on.

- **Which URLs:** only what `sitemapEntries()` returns, so the indexing policy above decides: staging, the master switch, sections that are off and noindex pages never reach Google. Each URL is a row in `indexing_urls`; one that leaves the sitemap gets `removed_at` and is never sent.
- **A run** (`runGoogleIndexing`): sync the sitemap (the very first sync marks everything as existing; anything that appears later is `is_new`), inspect what is due with Search Console's URL Inspection API (never inspected first, then not-indexed URLs weekly and indexed ones monthly, within `dailyInspectLimit`), then send `URL_UPDATED` notifications to the Indexing API within `dailySubmitLimit`: new URLs first, then URLs Google reports as not indexed (again after 14 days, at most 3 times), then URLs not inspected yet. Only a `PASS` verdict counts as indexed, and an indexed URL is never sent. A 429 or a permission error stops that API for the run. Each run is a row in `indexing_runs`.
- **When it runs:** daily at 03:17 UTC by the Vercel cron in `vercel.json` (`GET /api/cron/indexing`, which needs `Authorization: Bearer $CRON_SECRET`; Vercel sends it); right after an article is published (`indexSoon`, limited to the article, its category page and `/magazine`, no inspection); and from the "הרצה עכשיו" button. The "בדיקת חיבור" button gets a token and inspects the homepage, and changes nothing.
- **Settings** (`googleIndexing` in platform settings): `enabled`, `submitNew`, `submitBacklog`, `inspect`, `dailySubmitLimit` (Google's default quota is 200 a day), `dailyInspectLimit` (2,000 a day per property is the API limit), `property` (empty means `SITE_URL` with a trailing slash; a domain property is `sc-domain:beautyfind.co.il`). Changes are `google_indexing_update` audit rows, manual runs `google_indexing_run`.
- **The key:** upload the service account JSON file (or paste it) in the "מפתח Google" card at the top of the tab. It is checked (parsed and used to sign once), stored in `platform_secrets` encrypted with `DATA_KEY`, never sent back to the browser and never logged; the tab and `/ops/integrations` show only the service account email. Removing it stops indexing. A `GOOGLE_INDEXING_CREDENTIALS` variable on Vercel (raw or base64 JSON) still works and wins when both exist. Uploads and removals are `google_indexing_key` audit rows. `CRON_SECRET` (set on Vercel) authorizes the scheduled route.
- **Google side:** a Google Cloud project with the Web Search Indexing API and the Google Search Console API enabled, a service account with a JSON key, and that service account added as an **Owner** of the Search Console property (Settings, Users and permissions). Without Owner the Indexing API answers 403.
- **Caveat:** Google documents the Indexing API for job posting and livestream pages. For other pages it accepts the notification but promises nothing; the sitemap keeps working alongside it.

## AI completion of listings

`src/lib/server/enhanceRuns.ts`. A completion is an enhance run of the import worker: the website read again, ChatGPT research for what is still missing, the writer for the description and FAQs, and images copied, each step only where the listing's gaps call for it (`planFor` in `src/lib/import/enrichPlan.ts`). It fills empty fields only; a staff or owner edit stands. Two rules carry over from the import: a claimed listing is never touched, and only live listings are completed.

Listings registered by hand have no import record to hang the evidence on. `ensureImportRecords` creates one from the listing itself (name, address, coordinates, contact, website, socials, hours, categories; provider `manual`, under a finished holder run the worker never picks up) the first time a completion is requested, so the same pipeline runs on them. A listing without coordinates is skipped and the screen says so: the pipeline keys matching and directions on them.

Entry points: the AI tab of the branch editor and the AI card of the business card (one listing, or all branches), and the gaps view for a selection. Modes: automatic plan, website re-read plus plan, rewrite of the description and FAQs, images only. The run's budget ceiling is the plan estimate plus a margin; progress and spend show on the import runs screen. The request is an `ai_completion_requested` audit row.

The fix that came with this: `research` is a planner step but the enhance scope schema did not list it, so the enrichment tab's default selection (every step) failed validation and collapsed to no steps at all. The schema now accepts it.

## The assistant and the approvals queue

`src/lib/server/assistant.ts` calls Claude (`claude-opus-5-5` by default, `OPS_ASSISTANT_MODEL` to change) with adaptive thinking and read-only tools over the platform's own tables: platform summary, business search, billing overview, disputes, the approvals queue. The only write tool, `propose_action`, files a row in `ai_actions` (`hide_business`, `restore_business`, `note`) with a Q-ref. Nothing runs until a person with edit access to the AI area approves it on the queue tab; approval executes through `src/lib/server/aiActions.ts` with the same decision and audit rows a manual change leaves. Rejection stores the note.

Requests are sent with Anthropic's server-side fallback (`fallbacks: "default"` under the `server-side-fallback-2026-07-01` beta), so an overloaded primary model is answered by a fallback model instead of failing. Each question is one `ai_assistant_query` audit row with the tokens used; the usage tab sums those, and metered provider spend comes from the import spend ledger.

The assistant has no tool over client health data, and the web side needs `ANTHROPIC_API_KEY`; without it the chat says so. An MCP server is not deployed yet; the MCP tab states that and lists the tools it would expose.

## Tests

`tests/import/admin.test.ts`: role permissions and overrides, seeded import records and gap listing for hand-registered listings, the enhance scope accepting every planner step, platform settings parsing (sparse `rolePermissions` must parse, which is why the schema uses `partialRecord`), sponsored content checks, and with a local database the approvals executor (approve hides and restores with decision and audit rows, reject changes nothing, a decided row cannot run twice) and staff invite links (fresh, spent, expired, role removed).
