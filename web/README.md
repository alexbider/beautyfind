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

## What's built (phase 1: business funnel)

| Route | Screen | Design file |
|---|---|---|
| `/for-business` | Get Listed (marketing + pricing) | `BeautyFind Get Listed.dc.html` |
| `/login` | Auth: client WhatsApp/SMS OTP, business password + OTP signup, password reset | `BeautyFind Auth.dc.html` |
| `/for-business/join` | Onboarding, 7-step wizard (needs a business login) | `BeautyFind Onboarding.dc.html` |
| `/for-business/claim` | Claim an existing listing (needs a business login) | `BeautyFind Claim.dc.html` |
| `/logout` | POST, ends the session | |

The funnel is Get Listed → business signup (phone OTP) → Onboarding → a `BIZ-xxxx` verification request (plus `LIC-xxxx` when medical categories are picked). Existing listings go Claim → code sent to the listing's registered phone or email → a `CLM-xxxx` request. Ownership and publishing wait for BeautyFind approval (the Verification console is a later phase).

Shared pieces: `SiteHeader` (mega menu), `SiteFooter`, `CookieConsent` (`localStorage['bf-cookie-consent']`), tokens in `src/app/globals.css`, catalog in `src/lib/catalog.ts`, routes in `src/lib/routes.ts`.

## Stubs until vendors are chosen

- **Messaging** (`src/lib/vendors/messaging.ts`): WhatsApp BSP, SMS and email all go through one interface; only the console adapter exists.
- **File storage**: Onboarding photo and license uploads preview in the browser only (`TODO(storage)`).
- **Payments / invoices**: a `Subscription` row is created with the chosen plan; nothing is charged.

## Conventions

- RTL everywhere; numbers, phones, emails and refs inside Hebrew go in `.ltr` spans.
- Breakpoints are CSS media queries, never measured widths.
- Money is integer agorot, stored before VAT.
- `Decision` rows are append-only.
- No em dashes in copy.
