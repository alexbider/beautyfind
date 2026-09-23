# Handoff: BeautyFind — Israeli beauty & aesthetics marketplace

## Overview
BeautyFind is a Hebrew, right-to-left directory and booking platform for Israeli beauty and aesthetics clinics. It has three sides:

- **Client side** — discover clinics (search, directory, region, treatment pages), compare and save, book or request a medical consult, sign a health declaration, manage the booking from a message link, get aftercare, review the visit, buy and redeem gift cards.
- **Business side** — list or claim a business, onboard, invite staff, run the clinic (calendar, CRM, inventory, automations), handle consult requests and the waitlist, check clients in, manage branches, buy sponsored placements.
- **BeautyFind staff side** — moderate reviews, verify licenses and ownership claims, run billing, disputes and sponsored-content approval.

44 screens are designed. This folder explains how they connect so the product can be built end to end.

## About the design files
The files in `` are **design references built in HTML** — working prototypes that show the intended look, copy, states and behaviour. They are **not production code**. Recreate them in the target stack (recommended: React / Next.js with server components for public SEO pages, an RTL-aware component library, Postgres). Every page opens directly in a browser; most have a **Tweaks** panel (component props) that switches scenarios — e.g. `Clinic Booking` → `declaration: signed | flagged | pending`. Use those switches to see every state a screen must support. The full list per screen is in `06-screens.md`.

Prototype shortcuts you must **not** copy:
- All data is hard-coded mock data in each file. There is no shared data layer — `02-data-model.md` is the source of truth.
- Footer/nav links in older public pages use route strings (`/about`, `/sharon/biz/noa-clinic`) with a `go` handler that only previews the route. Newer pages link file-to-file. Use the route map in `01-flows.md`.
- `localStorage` is used for two things only: `bf-cookie-consent` (real, keep it) and `bf-saved` (prototype stand-in for the saved-clinics table).
- Mock people, license numbers, phone numbers and company numbers are fictional.

## Fidelity
**High fidelity.** Colors, typography, spacing, copy (Hebrew), states and validation messages are final. Recreate pixel-accurately; take exact values from the HTML inline styles.

## Read in this order
| File | What it answers |
|---|---|
| `08-open-decisions.md` | **Read first.** Product decisions (booking, consult, pricing, reviews, roles), vendor choices still open, legal checks. |
| `01-flows.md` | Every user journey, step by step, with the screen for each step and the proposed production route map. |
| `02-data-model.md` | Entities, fields, relations, which screens read/write each. |
| `03-states.md` | State machines: booking, consult, declaration, deposit/refund, waitlist, gift card, review, verification, campaign, branch, subscription, invite. |
| `04-permissions.md` | Clinic roles and per-area levels, medical-only actions, BeautyFind staff roles. |
| `05-messages.md` | Every WhatsApp / SMS / email: trigger, audience, service vs marketing, template screen. |
| `06-screens.md` | Screen inventory: file, route, side, purpose, scenario props, outgoing links. |
| `07-rules-and-tokens.md` | Business rules (money, VAT, time, legal), RTL/Hebrew rules, design tokens, component specs. |
| `BeautyFind Developer Handoff.dc.html` | Visual flow map — every box links to its screen. Open in a browser. |

## Non-negotiables (summary — details in 07)
1. RTL everywhere (`dir="rtl"`, `lang="he"`); numbers, phones, emails, URLs, codes and star rows isolated with `dir="ltr"` + `unicode-bidi:isolate`.
2. **Injectables are a medical act.** Only a physician (or a nurse under physician supervision) performs them. They cannot be booked instantly — they go through a consult. Cosmeticians never inject.
3. Health declaration answers are visible **only** to the treating staff of that booking — not reception, not BeautyFind. Store encrypted.
4. Moderation, verification, dispute and medical decisions are **append-only** (never edited; corrections are new decisions referencing the old one).
5. Deposit policy is a clinic setting, never a hard-coded amount.
6. Prices shown **before VAT (18%)**; every charge produces a tax invoice/receipt; every refund a credit note. Aesthetic treatments are not covered by the national health basket (סל) — say so where pricing is explained.
7. Sponsored placement never changes ranking, comparison or reviews; always labelled "ממומן"; max 2 per list.
8. Accessibility statement (ת״י 5568, AA) is legally required; build to WCAG 2.1 AA, min 44px targets.
9. Week starts Sunday (index 0). Clinics are closed on Shabbat by default.

## Files
- `*.dc.html` — the 44 designs + `support.js` (prototype runtime), `image-slot.js`, `israel-map.js`, `assets/`.
- `AUTHORING-RULES.md` — the authoring rules the designs follow (useful context for RTL and layout pitfalls).
