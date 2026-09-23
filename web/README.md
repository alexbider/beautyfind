# BeautyFind web

Hebrew RTL directory and booking platform for Israeli beauty and aesthetics clinics. Designs and product spec live in `../project/` (start with `design_handoff_beautyfind/README.md`).

Stack: Next.js 16 (App Router, React 19), TypeScript, Prisma 6 + Postgres, CSS Modules.

## Run it

```bash
cp .env.example .env          # then set SESSION_SECRET to a long random string
npm install
npx prisma migrate dev        # creates the schema
npm run db:seed               # regions, 69 cities, 14 categories, 8 claimable listings
npm run dev                   # http://localhost:3000
```

In development every OTP code is `DEV_FIXED_OTP` (123456). Messages (OTP, password reset) are printed to the server console by the `console` messaging adapter.

## Deploy (Vercel)

- Project root directory: `web`. Vercel runs `npm run vercel-build`, which applies migrations (`prisma migrate deploy`) and then builds.
- Storage: a Neon Postgres database (sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`) and a Vercel Blob store (sets `BLOB_READ_WRITE_TOKEN`), both connected to the project. Set `STORAGE_ADAPTER=blob`.
- Also set `SITE_URL`, `SESSION_SECRET` and `DATA_KEY`. Never change `DATA_KEY` once data exists: it encrypts health declarations and provider credentials.
- Test deployments: `STAGING=1` adds a noindex header to every response, a disallow-all robots.txt and a "test environment" bar. `ALLOW_CONSOLE_MESSAGING=1` prints login codes to the Vercel logs and `ALLOW_SANDBOX_PAYMENTS=1` enables the fake checkout. Remove all three before a real launch.
- Demo data on a test deployment: set `SEED_DEMO=1` and redeploy (the build runs `scripts/staging-seed.mjs`). `OPS_EMAILS` (comma separated) makes those existing accounts ops staff on the next build. Both do nothing without `STAGING=1`.

## What's built

### Phase 1: business funnel

| Route | Screen | Design file |
|---|---|---|
| `/for-business` | Get Listed (marketing + pricing) | `BeautyFind Get Listed.dc.html` |
| `/login` | Auth: client WhatsApp/SMS OTP, business password + OTP signup, password reset | `BeautyFind Auth.dc.html` |
| `/for-business/join` | Onboarding, 7-step wizard (needs a business login) | `BeautyFind Onboarding.dc.html` |
| `/for-business/claim` | Claim an existing listing (needs a business login) | `BeautyFind Claim.dc.html` |
| `/logout` | POST, ends the session | |

The funnel is Get Listed → business signup (phone OTP) → Onboarding → a `BIZ-xxxx` verification request (plus `LIC-xxxx` when medical categories are picked). Existing listings go Claim → code sent to the listing's registered phone or email → a `CLM-xxxx` request. Ownership and publishing wait for BeautyFind approval in the Verification console (phase 2).

### Phase 2: dashboard and verification

| Route | Screen | Design file |
|---|---|---|
| `/biz` | Dashboard overview (KPIs, profile completion, sources, hours) | `BeautyFind Dashboard.dc.html` |
| `/biz/analytics` · `/biz/profile` · `/biz/menu` · `/biz/reviews` · `/biz/leads` · `/biz/billing` | Dashboard tabs | same |
| `/biz/team` | Team, per-member permissions, staff invites (owner only) | same |
| `/invite/[token]` | Staff invite acceptance (licensed professions go to verification) | `BeautyFind Staff Invite.dc.html` |
| `/ops/verification` | BeautyFind staff queue: business, license, certificate and claim requests | `BeautyFind Verification.dc.html` |

Every dashboard tab reads real data; a new business sees empty states, never mock numbers. Areas follow `src/lib/permissions.ts` (presets × areas; `none` hides the tab, `view` shows a lock banner). Owners can preview any role from the header menu.

Approvals run through `src/lib/server/verification.ts`: approving a license verifies it (recheck in 90 days); approving a business publishes it and its branches, but only after a medical branch's doctor is verified; approving a claim grants ownership and applies the submitted details. Every decision is an append-only `Decision` row.

Give someone console access (they must have signed up first):

```bash
npm run ops:grant -- someone@beautyfind.co.il verifier
```

### Phase 3: public site

| Route | Screen | Design file |
|---|---|---|
| `/` | Homepage (search, region carousel, Israel map, categories) | `BeautyFind Homepage.dc.html` |
| `/search?q=&region=&city=&t=` | Search with URL-driven filters (noindex, follow) | `BeautyFind Search.dc.html` |
| `/[region]` | Region landing | `BeautyFind Region.dc.html` |
| `/[region]/[city]` · `/[region]/[city]/[category]` | City and city + category directory | `BeautyFind Directory.dc.html` |
| `/[region]/biz/[slug]` | Business profile with contact form (creates a CRM lead) | `BeautyFind Business Profile.dc.html` |
| `/pro/[id]` | Practitioner | `BeautyFind Practitioner.dc.html` |
| `/treatments` · `/treatments/[category]` | All categories, category explainers | `BeautyFind Treatments.dc.html`, `BeautyFind Treatment Category.dc.html` |
| `/about` (+ `/editorial`, `/methodology`) · `/listing-standards` (+ `/sponsorship`) | Content pages | `BeautyFind About.dc.html`, `BeautyFind Standards.dc.html` |
| `/privacy` · `/terms` · `/accessibility` | Legal (Israfind Group, Delaware) | `BeautyFind Legal.dc.html` |
| `/contact` · `/help` | Contact form (stored as `ContactMessage`), help centre | `BeautyFind Contact.dc.html`, `BeautyFind Help.dc.html` |
| 404 / error | System states | `BeautyFind States.dc.html` |

Public data comes only from `src/lib/server/public.ts` (live branches of live businesses). Google and BeautyFind ratings are separate fields and never averaged; JSON-LD `aggregateRating` uses BeautyFind reviews only. Profile analytics are recorded through `/api/events` only for visitors who accepted analytics cookies. `sitemap.xml` and `robots.txt` are generated.

`src/lib/features.ts` → `BOOKING_LIVE` gates every public claim, count and filter on online booking. It is `true` since phase 4; set it to `false` to take booking offline everywhere at once.

Demo content for local development (36 fictional businesses, treatments, reviews): `npm run db:seed:demo`. It refuses to run in production.

Shared pieces: `SiteHeader` (mega menu), `SiteFooter`, `CookieConsent` (`localStorage['bf-cookie-consent']`), tokens in `src/app/globals.css`, catalog in `src/lib/catalog.ts`, routes in `src/lib/routes.ts`.

### Phase 4: booking, clinic system and money

| Route | Screen | Design file |
|---|---|---|
| `/book/[branch]?t=` | Booking: treatment, practitioner, slot, details, deposit checkout | `BeautyFind Booking.dc.html` |
| `/b/[token]` | Manage booking (guest link): reschedule, cancel with refund, add to calendar | `BeautyFind Manage Booking.dc.html` |
| `/b/[token]/declaration` (`?kiosk=1` for the reception tablet) | Health declaration, drawn or typed signature | `BeautyFind Health Declaration.dc.html` |
| `/b/[token]/receipt` · `/receipt/[doc]` | The clinic's documents: tax invoice/receipt, receipt, credit note, refund tracker | `BeautyFind Receipt.dc.html` |
| `/b/[token]/aftercare` | Aftercare by phase, after the treatment is finished | `BeautyFind Aftercare.dc.html` |
| `/consult/[branch]?t=` | Consult request for medical treatments (real doctor slots, or preferred times) | `BeautyFind Consult Request.dc.html` |
| `/waitlist/[branch]?t=` · `/w/[token]` · `/waitlist/leave/[token]` | Join, offer with hold timer, leave | `BeautyFind Waitlist.dc.html` |
| `/review/[token]` | Verified review, completed bookings only | `BeautyFind Review.dc.html` |
| `/gift/[branch]` · `/gift/check` | Buy a gift card, check a balance | `BeautyFind Gift Cards.dc.html` |
| `/account` · `/saved` · `/saved/compare` · `/unsubscribe/[token]` | Client account, saved clinics, compare, one-click unsubscribe | `BeautyFind Account.dc.html`, `BeautyFind Saved.dc.html` |
| `/clinic` · `/clinic/booking/[id]` | Clinic system: appointments, booking card (check-in, doctor ack, start, finish, no-show, clinic cancel) | `BeautyFind Clinic Booking.dc.html` |
| `/clinic/consults` · `/clinic/waitlist` · `/clinic/gift-cards` | Consult inbox, waitlist queue, gift card desk and ledger | as above |
| `/biz/payments` | Connect the business's own payment and invoicing providers, deposit policy | `BeautyFind Dashboard.dc.html` |

How it fits together:
- **Services** in `src/lib/server/`: `availability.ts` (slot engine), `booking.ts` (create, confirm, cancel, reschedule, holds), `money.ts` (checkout, webhooks, receipts, refunds with credit notes), `waitlist.ts`, `giftcards.ts`, `clinic.ts` (plan and role gates, who may read a declaration), `claim-guest.ts`.
- **Concurrency:** bookings take a Postgres advisory lock per practitioner and re-check the slot inside it. A deposit holds the slot for 10 minutes.
- **Clinic features need the advanced plan.** Basic listings book without deposits; clinic pages show an upgrade card.
- **Health declarations** are sealed with AES-256-GCM (`DATA_KEY`). Only the treating practitioner or the branch's medical doctor can read the answers or the signature, and every read is audit-logged.
- **Guest to account:** clients book as guests by phone. When the same phone is verified by OTP (sign-up or sign-in), its bookings, waitlist entries, consult requests and consents move to the account.
- **Local payments:** the `sandbox` provider serves a fake checkout at `/pay/sandbox/[paymentId]`. Production builds refuse it unless `ALLOW_SANDBOX_PAYMENTS=1`. `SITE_URL` must match the address you open, or checkout redirects go elsewhere.

## Stubs until vendors are chosen

- **Messaging** (`src/lib/vendors/messaging.ts`): WhatsApp BSP, SMS and email all go through one interface; only the console adapter exists. It prints codes and links, so it refuses to run in production unless `ALLOW_CONSOLE_MESSAGING=1` (local testing only).
- **File storage** (`src/lib/vendors/storage.ts`): local disk under `.data/uploads` until a vendor is chosen. Public images are served from `/media/<id>`; license scans are private and only readable by verifiers at `/ops/media/<id>`.
- **Registry lookups** (Ministry of Health, company registry): the verification console shows a manual-check state (`TODO(registry)`).
- **Billing job**: nothing applies `pendingPlan` / `pendingCycle` at `currentPeriodEnd` yet (`TODO(billing-job)`).
- **Sponsored placements**: no campaigns table yet, so no ממומן cards anywhere (`TODO(sponsored)`).
- **Map view** on Search: needs branch coordinates (`TODO(map)`).
- **Magazine / articles**: no CMS yet; links point to `/magazine` (`TODO(cms)`).
- **Platform billing**: a `Subscription` row is created with the chosen plan; nothing is charged to the business yet.
- **Clinic payment and invoicing providers**: the adapter interfaces and registry are in `src/lib/vendors/payments` and `src/lib/vendors/invoicing`. Only `sandbox` works; Cardcom, Tranzila, Grow, PayPlus, Green Invoice, iCount and EZcount are listed as coming soon.
- **Scheduler**: nothing runs on a timer yet. Pages close expired holds, offers and waitlist entries when they load. Still missing: M6 review requests, gift card delivery on a future date and expiry reminders, marking cards expired.
- **Treatment booking from an approved consult**: the approval is recorded, but the clinic books the treatment itself (`TODO(clinic-booking)`).
- **Inventory**: product batches are recorded on the clinical record; stock is not deducted (`TODO(inventory)`).
- **Rate limits** for gift card lookups are in memory per server instance; they need a shared store with more than one instance.

## Conventions

- RTL everywhere; numbers, phones, emails and refs inside Hebrew go in `.ltr` spans.
- Breakpoints are CSS media queries, never measured widths.
- Money is integer agorot, stored before VAT.
- `Decision` rows are append-only.
- No em dashes in copy.
