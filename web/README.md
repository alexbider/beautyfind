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

## What's built

### Phase 1: business funnel

| Route | Screen | Design file |
|---|---|---|
| `/for-business` | Get Listed (marketing + pricing) | `BeautyFind Get Listed.dc.html` |
| `/login` | Auth: client WhatsApp/SMS OTP, business password + OTP signup, password reset | `BeautyFind Auth.dc.html` |
| `/for-business/join` | Onboarding, 7-step wizard (needs a business login) | `BeautyFind Onboarding.dc.html` |
| `/for-business/claim` | Claim an existing listing (needs a business login) | `BeautyFind Claim.dc.html` |
| `/logout` | POST, ends the session | |

The funnel is Get Listed → business signup (phone OTP) → Onboarding → a `BIZ-xxxx` verification request (plus `LIC-xxxx` when medical categories are picked). Existing listings go Claim → code sent to the listing's registered phone or email → a `CLM-xxxx` request. Ownership and publishing wait for BeautyFind approval (the Verification console is a later phase).

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

Shared pieces: `SiteHeader` (mega menu), `SiteFooter`, `CookieConsent` (`localStorage['bf-cookie-consent']`), tokens in `src/app/globals.css`, catalog in `src/lib/catalog.ts`, routes in `src/lib/routes.ts`.

## Stubs until vendors are chosen

- **Messaging** (`src/lib/vendors/messaging.ts`): WhatsApp BSP, SMS and email all go through one interface; only the console adapter exists. It prints codes and links, so it refuses to run in production unless `ALLOW_CONSOLE_MESSAGING=1` (local testing only).
- **File storage** (`src/lib/vendors/storage.ts`): local disk under `.data/uploads` until a vendor is chosen. Public images are served from `/media/<id>`; license scans are private and only readable by verifiers at `/ops/media/<id>`.
- **Registry lookups** (Ministry of Health, company registry): the verification console shows a manual-check state (`TODO(registry)`).
- **Billing job**: nothing applies `pendingPlan` / `pendingCycle` at `currentPeriodEnd` yet (`TODO(billing-job)`).
- **Payments / invoices**: a `Subscription` row is created with the chosen plan; nothing is charged.

## Conventions

- RTL everywhere; numbers, phones, emails and refs inside Hebrew go in `.ltr` spans.
- Breakpoints are CSS media queries, never measured widths.
- Money is integer agorot, stored before VAT.
- `Decision` rows are append-only.
- No em dashes in copy.
