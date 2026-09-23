# BeautyFind — project rules

RTL Hebrew directory for the Israeli beauty/aesthetics market. Pivoted from the
English MedSpaFind templates; the nine `MedSpaFind *.dc.html` files are the design
source of truth and stay untouched.

## Non-negotiable authoring rules

1. **Every `src="{{ … }}"` image MUST carry `loading="lazy"`.** Without it the browser
   fetches the literal `{{ hole }}` string at template-parse time and throws a
   resource error. Apply while writing, never as an audit afterwards. This has
   regressed three times.
2. **Breakpoints come from `matchMedia`, never from a measured pixel width.** An
   iframe resized by the host fires neither `resize` nor a post-resize `load`, so a
   constructor-seeded `state.w` is never superseded. Use the
   `static MQ = {…}` + `readMQ()` + listener pattern the existing pages share.
3. **Explicit grid track counts, not `auto-fit`, when the item count is known.**
   `repeat(auto-fit,minmax(215px,1fr))` resolved to 2 tracks for 3 items and left an
   empty bordered cell.
4. **Root uses `overflow-x:clip`, not `hidden`** — `hidden` creates a scroll container
   and silently kills `position:sticky` for every descendant.
5. **A tall sticky element must fit the viewport.** Gate sticky behind a
   `(min-height:…)` media query, or sticky the inner card rather than the whole aside.

## Brand

- Navy `#0C243E`, teal `#14B3C6`, deep teal `#0B7A87`, light teal `#7ED7E1`,
  tints `#F0FAFB` / `#FAFBFB` / `#F6F8F9`, borders `#E6E6E6` / `#D4D4D4`,
  body text `#3E4F62`, muted `#5B6B7B` / `#8A96A3`.
- Type: **Frank Ruhl Libre** 500 (display), **Assistant** (UI), **Jost** 300 for the
  `beautyfind.` latin wordmark — navy + teal split, teal period.
- No `text-transform:uppercase` and no wide letter-spacing: neither applies to Hebrew.
  Headings take slight negative tracking (-0.012em to -0.015em).
- Hebrew body weights run heavier than the English original: 700 where it was 600.

## RTL checklist per page

`dir="rtl"` on root · arrows point left (`M12 7H2M6 3 2 7l4 4`) · `margin-right:auto`
instead of `margin-left` · `text-align:right` · mega-menu divider `border-left` ·
dropdowns anchored `left:0` · absolute decoration mirrored · numbers, phone, email,
URLs and star rows wrapped in `dir="ltr"`.

## Market specifics

- Geography: 7 regions (צפון, חיפה, שרון, גוש דן, ירושלים, שפלה, דרום), 60+ cities.
- 14 service categories; injectables are a **medical act requiring a physician** —
  קוסמטיקאיות may not inject. Label responsibility as אחריות רפואית vs. איש מקצוע אחראי.
- Prices in ₪, note לא כולל מע״מ, mention חשבונית מס and תשלומים where billing appears.
- Aesthetic treatments are **not in the סל** — say so in pricing FAQs.
- Hours run ראשון–שישי with שבת סגור; "today" maps Sunday → index 0.
- CTAs: WhatsApp and click-to-call sit beside booking; Waze for navigation.
- הצהרת נגישות is legally required, not optional.

## Pages built (44)

**Client side** — Homepage · Directory · Search · Business Profile · Booking ·
Treatments · Treatment Category · Region · Blog · Article · About · Standards ·
Contact · Legal · Account · Review · Health Declaration (signature pad) ·
Manage Booking (guest link: reschedule/cancel by clinic policy) · Consult Request
(patient form + clinic inbox; medical decline is physician-only) · Practitioner
(doctor vs. cosmetician responsibility) · Waitlist (join / timed offer / clinic queue) ·
Aftercare (phased do/don't, red flags) · Receipt (tax invoice, credit note, refund track) · Saved
(compare up to 3; sponsored never affects compare) · Gift Cards (buy / redeem / clinic ledger;
≥5-year validity, invoice at redemption, open balance = liability) · Help (client/business FAQ)

**Business side** — Get Listed · Onboarding (7-step wizard) · Claim · Dashboard ·
Staff Invite (role + license for doctor/nurse) · Clinic Booking (declaration,
check-in, clinical log; flagged declarations need physician sign-off) · Branches
(switcher, per-branch billing, drafts unbilled) · Sponsored (region × category weeks,
max 2 per list, content review blocks outcome promises, billed only after approval) · Noa Clinic (CRM, calendar, inventory, automations, integrations, settings, log)

**System** — Auth · Moderation console · Verification (license / certificate / ownership-claim queue, immutable decisions) ·
Admin (BeautyFind ops: businesses, failed charges, BeautyFind invoices, deposit disputes, sponsored approval) ·
Unsubscribe (per clinic or all, per channel; service messages continue) · Emails (tax invoice, gift card, password reset) · Notifications (message templates) · Cookie Consent (localStorage `bf-cookie-consent`) ·
States (404, no results, empty region, unclaimed, new business, loading, error) ·
Design System

## Conventions the newer pages established

- Deposit policy is business-controlled (Noa Clinic → הגדרות): on/off, fixed ₪ or %,
  scope (all / medical only / per treatment), refund window. The booking page reads it
  via props — never hardcode an amount.
- Inventory is schema-free: name is the only required field; category, unit and supplier
  are free text with datalist suggestions built from existing items; per-item custom
  fields; a מעקב כמויות toggle for services and contracts.
- Never a `<select>` whose `<option>`s come from a streamed list — it displays the first
  option instead of the saved value. Use a chip row or an input + `datalist`.
- Latin/code literals inside Hebrew prose need their own `dir="ltr"` span with
  `unicode-bidi:isolate`, and the `<sc-for>` body must stay on ONE line — an indented
  loop body injects a whitespace text node that detaches punctuation and the ה־/מ־ maqaf.
- Hebrew plurals: singular / dual / plural forms, never "1 פנויות" (חודש · חודשיים ·
  N חודשים; פנויה אחת · שתיים פנויות · N פנויות).
- `tel:` hrefs carry no spaces and use international form: `tel:+972977411180`.
- Phone / WhatsApp buttons share one treatment: WhatsApp = #EAF7EF bg, #BFE6CC border, #0E6B3A text,
  #1DA851 glyph; phone = white bg, #D4D4D4 border, navy text, teal handset icon. Icon-only variants keep
  the same colors. Emergency call (Aftercare) stays #A33A31.

## Product decisions (locked)
- Booking is native on BeautyFind; branch calendars sync two-way with Google / Microsoft / iCal / the clinic's booking system; confirmations via WhatsApp, SMS and email.
- Plans per live branch: רישום בסיסי ₪149, רישום מתקדם + CRM ₪249 (clinic system). Sponsored sold per week, separately. No add-ons.
- Reviews: Google rating and BeautyFind verified reviews shown side by side, never merged.
- Roles: presets owner · manager · front · book · practitioner (seed per-area levels); profession gates medical actions.
- Consults: one flow — Booking hands medical treatments to Consult Request, where the client picks a real consult slot (or gives preferences for the clinic to propose).
