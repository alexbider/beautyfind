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
| `/ops/content` | Per-page SEO overrides (`PageSeo`, applied through `applySeo`), catalog, sitemap and robots state. |
| `/ops/messages` | The 25-template catalog with what the code already sends, the messaging adapter state, consent counts, editable draft copy. |
| `/ops/ai` | The operations assistant, AI providers, MCP state, the approvals queue, usage and costs (below). |
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
