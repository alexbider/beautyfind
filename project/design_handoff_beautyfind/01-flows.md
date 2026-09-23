# Flows

Screen names = files in `` without the `BeautyFind ` prefix. "→" = navigation; "⇢" = asynchronous message (see `05-messages.md`).

## Proposed production routes
| Route | Screen |
|---|---|
| `/` | Homepage |
| `/search?q=&region=&city=&t=` | Search |
| `/:region` (e.g. `/dan`) | Region |
| `/:region/:city` | Directory (`pageType=city`) |
| `/treatments` · `/treatments/:category` | Treatments · Treatment Category |
| `/:region/biz/:slug` | Business Profile |
| `/pro/:slug` | Practitioner |
| `/book/:branch` | Booking |
| `/consult/:branch` | Consult Request (patient side) |
| `/b/:token` | Manage Booking (signed guest link, no login) |
| `/b/:token/declaration` | Health Declaration |
| `/b/:token/aftercare` | Aftercare |
| `/b/:token/receipt` · `/receipt/:doc` | Receipt |
| `/waitlist/:branch` · `/w/:offerToken` | Waitlist (join · offer) |
| `/review/:bookingToken` | Review |
| `/gift/:branch` · `/gift/check` | Gift Cards (buy · redeem) |
| `/saved` · `/saved/compare?ids=` | Saved |
| `/account` | Account |
| `/login` | Auth |
| `/help` | Help |
| `/unsubscribe/:token` | Unsubscribe |
| `/about` · `/about/editorial` · `/about/methodology` | About |
| `/listing-standards` · `/listing-standards/sponsorship` | Standards |
| `/privacy` · `/terms` · `/accessibility` | Legal |
| `/contact` | Contact |
| `/magazine` · `/magazine/:slug` | Blog · Article |
| `/for-business` | Get Listed |
| `/for-business/claim` | Claim |
| `/for-business/join` | Onboarding |
| `/invite/:token` | Staff Invite |
| `/biz` (app) | Dashboard |
| `/biz/branches` · `/biz/sponsored` | Branches · Sponsored |
| `/clinic` (app) · `/clinic/booking/:id` | Noa Clinic · Clinic Booking |
| `/clinic/consults` · `/clinic/waitlist` · `/clinic/gift-cards` | Consult Request (`side=clinic`) · Waitlist (`view=clinic`) · Gift Cards (`view=clinic`) |
| `/ops` · `/ops/moderation` · `/ops/verification` | Admin · Moderation · Verification |
| (system) | States (404, empty, error…), Cookie Consent (global), Emails, Notifications |

## Client flows

### C1. Discover → choose
Homepage / Blog / Article / Treatments → Search or Region → Directory → Business Profile → (Practitioner) → CTA.
- Cards and profile have a **save heart** → Saved (compare up to 3).
- Profile CTA: bookable treatment → Booking; medical → Consult Request. WhatsApp and call always sit beside it.

### C2. Book a non-medical treatment
Booking: treatment → practitioner → slot → details + consents → confirm.
1. Deposit is charged if `DepositPolicy` applies (Receipt: `status=deposit`).
2. ⇢ Booking confirmation (WhatsApp) with the guest link → Manage Booking.
3. If the treatment requires a declaration (all medical, some cosmetic, e.g. microneedling): ⇢ declaration link → Health Declaration.
4. No slot on a day → "הצטרפו לרשימת ההמתנה" → Waitlist (C5).

### C3. Medical (injectable) treatment
Profile / Booking (medical item → "המשך לקביעת ייעוץ רפואי") → Consult Request: intake + **pick a consult slot** from the physician's availability → consult booking created immediately (⇢ M1; fee per settings, offset against treatment).
No slot fits → preferred time ranges → clinic inbox (Consult Request `side=clinic`) proposes a time ⇢ M9 → client confirms → consult booking.
At the consult the physician decides: treat in the same visit, create a treatment booking (C2 steps 1–3), or decline (physician only).

### C4. Manage booking (guest link, no login)
Manage Booking: view, add to calendar, WhatsApp / call / Waze, pre-visit checklist (declaration status, deposit), reschedule (same treatment + practitioner), cancel.
- Cancellation inside the refund window → refund + credit note (Receipt `refunding → refunded`). Late → deposit kept per policy.

### C5. Waitlist
Waitlist join (days, time ranges, duration 2w/1m/2m, any practitioner) → entry. When a matching slot frees (cancellation), clinic or automation offers it to the first match ⇢ offer message with timer (`holdMinutes`, default 30) → accept (booking created, leaves list) / pass (stays) / expire (offer moves to next).

### C6. Visit
Clinic Booking: מאושר → צ׳ק־אין (הגיעה) → בטיפול → הסתיים, or לא הגיעה.
- Start treatment blocked if declaration missing (medical) or flagged and viewer is not a physician.
- Finish: batch + units (deducted from inventory), clinical note ⇢ Aftercare link; ⇢ review request after 3 days; follow-up visit suggested (e.g. 14 days for botox).

### C7. After the visit
Aftercare (phased do/don't, red flags, emergency call) → Review (only verified visits; explicit photo consent) → Moderation → published on Profile/Practitioner.
Receipt for the remaining balance (`status=paid`, instalments).

### C8. Gift cards
Buy (amount or treatment, recipient, channel, send time) → pay → ⇢ gift email/WhatsApp (Emails `gift`) → recipient checks balance (Gift Cards `redeem`) → books → redeemed at the desk (Gift Cards `clinic`) → tax invoice at redemption.

### C9. Account & privacy
Auth (WhatsApp/SMS OTP; password for businesses) → Account (appointments, saved, reviews, privacy). Unsubscribe from any marketing message (per clinic or all, per channel). Cookie Consent on first visit to any public page.

## Business flows

### B1. New business
Get Listed → Onboarding (7 steps: details, categories, medical responsibility — only if injectables selected, treatments & prices, hours, photos, verification) → Verification queue → live → Dashboard.

### B2. Existing listing
Claim (find → verify by code to listed phone or email → details → menu) → Verification (`claim`) → ownership granted. If the listing already has a verified owner → rejected, suggest a staff invite instead.

### B3. Team
Dashboard → צוות והרשאות → invite by email + role ⇢ invite email → Staff Invite (details, profession; license number for doctor/nurse → SMS code) → joined. Licensed professions → Verification (`license`); only after approval does the name appear as אחריות רפואית.

### B4. Run the clinic
Noa Clinic: calendar → Clinic Booking; customers (CRM); enquiries; messages; tasks; payments; inventory; automations; integrations; settings (deposit policy, cancellation window, waitlist hold, consult fee); activity log.
Related queues: Consult Request (`side=clinic`), Waitlist (`view=clinic`), Gift Cards (`view=clinic`).

### B5. Growth
Branches (add as draft → publish → billed next cycle). Sponsored (region × category × weeks → preview → submit → content review → billed on approval → live → stats).

## BeautyFind staff flows
- **Moderation:** reviews, reports, listing approvals, decision log.
- **Verification:** licenses (Ministry of Health registries), certificates (manual), ownership claims (company registry + Google Business). Approve / request document (SLA paused) / reject with reason. Licenses re-checked every 90 days.
- **Admin:** businesses (search, status, read-only support login, logged), failed charges (retry day 3 and 7, profile hidden day 14), BeautyFind invoices & credit notes, disputes (recommend only — clinic decides refunds), sponsored approval (blocked while forbidden wording or unpaid debt).
