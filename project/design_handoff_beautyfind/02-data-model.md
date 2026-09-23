# Data model

Types are indicative (Postgres). `id` = uuid unless noted. All tables have `created_at`, `updated_at`. Money = integer agorot + currency `ILS`; store net, VAT and gross separately on documents.

## Identity

### User
| field | notes |
|---|---|
| phone | E.164 (`+972…`), unique, verified by OTP (WhatsApp, SMS fallback) |
| email | optional for clients, required for business users |
| full_name | |
| birth_date, national_id_last4 | only collected for Health Declaration; national id shown masked `•••••4821` |
| password_hash | business users only (clients use OTP) |
Screens: Auth, Account, Staff Invite.

### StaffMember (user ↔ business)
| field | notes |
|---|---|
| business_id, user_id | |
| branch_ids[] | branches they work at |
| profession | `doctor · nurse · cosmetician · technician · front · management` |
| is_owner | exactly one per business |
| permissions | `{overview, analytics, profile, menu, reviews, leads, billing: none\|view\|edit}` + `bookings: none\|view\|manage` + `team` (owner only) — see 04 |
| license_id | nullable → License |
| status | `invited · active · removed` |
Screens: Dashboard (team), Staff Invite, Noa Clinic, Clinic Booking, Consult Request.

### License
`kind (doctor | nurse | cosmetician_cert)`, `number`, `name_on_record`, `status (pending · verified · rejected · expired)`, `verified_at`, `next_check_at` (+90 days), `source (moh_doctors | moh_nurses | manual)`, `document_file` (certificates). Screens: Staff Invite, Onboarding, Verification, Practitioner.

## Businesses

### Business (legal entity)
`legal_name`, `company_or_vat_no` (ח.פ. / ע.מ.), `owner_user_id`, `status (pending · live · past_due · hidden)`, `subscription_id`, `deposit_policy` (embedded or 1:1), `settings` (cancel window, waitlist hold minutes, consult fee, reminder timing). Screens: Onboarding, Claim, Dashboard, Admin.

### Branch
| field | notes |
|---|---|
| business_id, name, slug | |
| region | one of 7: `north, haifa, sharon, dan, jerusalem, shfela, south` |
| city, address, geo | 60+ cities |
| phone, whatsapp | E.164 |
| hours | 7 entries, index 0 = Sunday; `{open, close, closed}`; Shabbat closed by default |
| flags | `accessible, free_parking, waze_link, online_booking` |
| calendar_connection_id | → CalendarConnection (optional) |
| medical_responsible_id | StaffMember (verified doctor) — required if any medical treatment |
| status | `draft · live` (draft is never billed) |
| cover, gallery[] | alt text required |
Screens: Branches, Dashboard profile, Business Profile, Directory, Search, Saved.

### Category (14) & Treatment (menu item)
Treatment: `branch_id, category_id, name, description, price_type (fixed | from | per_unit | per_ml | per_area), price, duration_min, is_medical, requires_declaration, online_bookable (false if is_medical), deposit_override, practitioners[]`.
Rule: `is_medical` ⇒ performed by doctor or supervised nurse; booking goes via ConsultRequest.
Screens: Onboarding, Dashboard menu, Booking, Profile, Treatments, Treatment Category, Saved compare.

### DepositPolicy (per business)
`enabled`, `mode (fixed | percent)`, `value`, `scope (all | medical_only | per_treatment)`, `refund_window_hours` (default 24). Read by Booking, Manage Booking, Clinic Booking, Receipt, Waitlist copy. Edited in Noa Clinic → הגדרות.

## Client journey

### Booking
| field | notes |
|---|---|
| ref | human ref `BF-4288` |
| branch_id, treatment_id, practitioner_id, client_user_id | |
| kind | `treatment · consult` |
| starts_at, duration_min, room | |
| status | see 03 |
| source | `online · phone · walkin · waitlist · consult` |
| deposit_payment_id, declaration_id | nullable |
| checked_in_at, started_at, finished_at | |
| clinical | `{product_batch_id, units, notes, recorded_by}` — treating staff only |
| cancellation | `{by: client\|clinic, at, reason, late: bool}` |
| guest_token | signed, for `/b/:token` |
| consents | `{policy_accepted_at, marketing_opt_in}` |
Screens: Booking, Manage Booking, Clinic Booking, Noa Clinic calendar, Account, Receipt, Aftercare, Review.

### ConsultRequest
`ref (R-311)`, `branch_id`, `client`, `areas[]`, `goal` (≥15 chars), `prior_injections (never | >1y | <1y)`, `format (clinic | video)`, `chosen_slot` (from physician consult availability) or `preferred_times[] (morning 08–12 | noon 12–16 | evening 16–20)` when no slot fits, `phone`, `consent_share_medical`, `medical_flags[]` (e.g. anticoagulant), `status`, `proposed_slot`, `outcome_text`, `decided_by`, `decline_reason (medical | scope | duplicate)`.
Screens: Consult Request (both sides), Booking hand-off.

### HealthDeclaration
`client_user_id`, `booking_id` (nullable), `type (medical | cosmetic)`, `questionnaire_version`, `answers[{key, yes, detail}]`, `medications` or `no_medications`, `signed_name`, `signature_png`, `signed_at`, `valid_until` (signed_at + 12 months, or until the client updates), `flagged` (any yes), `physician_ack {by, at}`.
Access: treating staff of the linked booking only; encrypted at rest; every read logged. Screens: Health Declaration, Manage Booking, Clinic Booking.
Questionnaires (keys): medical = `preg, blood, neuro, auto, allergy, herpes, recent, infect`; cosmetic = `preg, roacc, skin, allergy, sun, recent`.

### WaitlistEntry / WaitlistOffer
Entry: `branch_id, treatment_id, client, days[] (0–5), time_ranges[], any_practitioner, expires_at, position, status`. Offer: `entry_id, slot, sent_at, hold_until, status`.
Screens: Waitlist (all views), Booking.

### Review
`booking_id` (required — verified visit), `rating 1–5`, `aspects {clean, explain, result, time, price, after}` 1–5 optional, `title ≥4`, `body ≥40`, `tags[]`, `photos[] {before|after|place}`, `photo_consent`, `name_mode (full | initial | anon)`, `declarations {real, no_interest}`, `status`, `moderation_decision_id`, `business_reply` (one, public).
Screens: Review, Moderation, Profile, Practitioner, Account, Dashboard reviews.

### SavedClinic
`user_id, branch_id, saved_at`. Compare = client-side selection of max 3. Screens: Saved, Directory, Search, Profile, Account.

### GiftCard / GiftRedemption
GiftCard: `code (NOA-XXXX-XXXX)`, `business_id`, `kind (amount | treatment)`, `treatment_id`, `value`, `balance`, `buyer`, `recipient {name, channel wa|email|self, contact}`, `message ≤140`, `send_at`, `expires_at` (≥ purchase + 5y), `status`, `purchase_payment_id`.
Redemption: `gift_card_id, amount, booking_id, branch_id, invoice_id, by_staff`. Open balance = liability (not revenue) until redeemed.
Screens: Gift Cards (buy, redeem, clinic), Emails `gift`, Admin disputes.

## Money

### Payment
`payer`, `payee (business | beautyfind)`, `purpose (deposit | treatment | gift_card | subscription | sponsored | consult)`, `net, vat, gross`, `method {card_last4, brand}`, `installments`, `provider_ref`, `status (pending · succeeded · failed · refunded · partially_refunded)`.

### Document
`issuer (business | beautyfind)`, `type (tax_invoice_receipt | credit_note)`, `number` (sequential per issuer and type), `references_document_id` (credit notes), `lines[]`, `pdf_url`, `sent_to`. Screens: Receipt, Emails `invoice`, Admin billing.

### Refund
`payment_id, amount, credit_note_id, status (requested · issued · sent_to_card · received)`, `expected_by` (7–10 business days). Screen: Receipt (`refunding / refunded`).

### CalendarConnection
`branch_id, provider (google | microsoft | ical | booking_system:<name>)`, `external_calendar_ids[]` (one per practitioner/room), `direction (two_way | import_busy | export_only)`, `status (connected · error · paused)`, `last_sync_at`, `error`. External events create busy blocks; BeautyFind bookings are exported. Screen: Noa Clinic → אינטגרציות.

### Subscription
`business_id, plan (basic | advanced)`, `cycle (monthly | yearly)`, `price_per_branch` (basic ₪149, advanced ₪249; yearly = ×10), `billed_branches` (live only), `status (active · past_due · hidden · cancelled)`, `retry {attempts, next_at}`. Screens: Get Listed, Dashboard billing, Branches, Admin.

### Campaign (sponsored)
`business_id, branch_id, region, category, weeks[] (Sun 00:00 → Sat)`, `line ≤60`, `featured_treatment`, `weekly_price`, `discount` (10% for ≥4 weeks), `status`, `hold_until` (24h during review), `review {by, at, reason}`, `invoice_id`, `stats {impressions, profile_visits, bookings}` (only from visitors who allowed analytics cookies).
Capacity: max 2 approved campaigns per (region, category, week). Screens: Sponsored, Admin ads, Homepage/Search/Directory cards (ממומן tag).

## Trust & ops

### VerificationRequest
`ref (LIC-2291 | CRT-0418 | CLM-1107)`, `kind (license | cert | claim)`, `subject`, `submitted {…}`, `source_lookup {…}`, `checks[{result ok|warn|bad|todo, text}]`, `sla_due_at` (paused while waiting for documents), `status`, `decisions[]`.

### Decision (append-only, shared by moderation / verification / disputes / consult / campaigns)
`actor_id, actor_role, subject_type, subject_id, action, reason, created_at, supersedes_decision_id`. No update or delete.

### AuditLog
Every sensitive read (declarations, clinical notes) and every support login. Screen: Noa Clinic → יומן פעילות, Admin.

### Dispute
`kind (deposit | gift_card)`, `client, business, amount`, `claim`, `system_facts`, `policy_shown` (snapshot of the policy at booking time), `status (open · recommended_refund · closed_policy_upheld · escalated_legal)`.

### MessageConsent
`user_id`, `scope (business_id | all)`, `channel (wa | email | sms)`, `marketing (bool)`, `source`, `updated_at`. Service messages ignore this table. Screens: Unsubscribe, Account, Booking (marketing opt-in), Notifications.

### Lead (CRM)
`business_id, name, phone, email, treatment, city, source (form | whatsapp | phone | walkin | referral)`, `stage (new · contacted · booked · done · lost)`, `value`. Screen: Dashboard → leads, Noa Clinic → customers/enquiries.

### InventoryItem (schema-free)
Only `name` required. Optional: category, unit, supplier (free text with suggestions from existing values), `track_quantity`, `quantity`, `expiry`, `batch`, `storage`, `deduct_per_treatment {treatment_id, units}`, `custom_fields {}`. Clinic Booking "finish" deducts units from the chosen batch. Screen: Noa Clinic → מלאי.

### Client-side storage
- `localStorage['bf-cookie-consent'] = {essential: true, analytics: bool, embeds: bool}` — keep as is.
- `localStorage['bf-saved']` — prototype only; replace with SavedClinic.
