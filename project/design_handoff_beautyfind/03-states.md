# State machines

Format: `from → to` · trigger · who · side effects (⇢ = message, see 05). Anything not listed is not allowed.

## Booking (kind = treatment)
```
pending_payment → confirmed → checked_in → in_treatment → completed
        ↘ abandoned         ↘ cancelled_client / cancelled_clinic / rescheduled(→ new confirmed)
                            ↘ no_show
```
| transition | trigger / guard | who | effects |
|---|---|---|---|
| → pending_payment | submit Booking step 4 with deposit required | client | hold slot 10 min |
| pending_payment → confirmed | deposit succeeded, or no deposit needed | system | ⇢ M1 confirmation · ⇢ M3 declaration link if required · Receipt (deposit) |
| pending_payment → abandoned | hold expired | system | release slot |
| confirmed → confirmed (reschedule) | Manage Booking; same treatment & practitioner; if `< refund_window` counts as late cancel | client / clinic | ⇢ M1 with new time; deposit & declaration carry over |
| confirmed → cancelled_client | Manage Booking | client | on time: refund + credit note (⇢ M11); late: deposit kept; free the slot → Waitlist offer |
| confirmed → cancelled_clinic | clinic | clinic | always full refund; ⇢ M12 |
| confirmed → checked_in | "המטופלת הגיעה" | staff with booking rights | notify practitioner |
| confirmed → no_show | "לא הגיעה" after start time | staff | deposit kept per policy; undo allowed within 24h (new decision) |
| checked_in → in_treatment | guard: medical ⇒ declaration signed; flagged ⇒ physician_ack | practitioner / physician | log |
| in_treatment → completed | clinical record saved | practitioner | inventory deduction · ⇢ M5 aftercare · ⇢ M6 review request +3 days · follow-up suggestion |

## Consult request
Submitting with a chosen slot goes straight to `consult_scheduled` (consult Booking created, ⇢ M1). Without a slot ("אף מועד לא מתאים") it starts at `new`.
```
new → awaiting_client → consult_scheduled → closed_treatment_booked
 ↘ ↘                 ↘ closed_declined (medical | scope | duplicate)
```
| transition | guard | who | effects |
|---|---|---|---|
| new → awaiting_client | "בקשת פרטים" | booking-rights staff | ⇢ M8 |
| new/awaiting → consult_scheduled | propose slot; client confirms on WhatsApp | booking-rights staff | ⇢ M9 proposal; on confirm creates Booking(kind=consult, fee) |
| any open → closed_declined(medical) | **physician only** | physician | ⇢ M10 with explanation; free call offered; Decision logged |
| any open → closed_declined(scope/duplicate) | | booking-rights staff | ⇢ M10 |
| consult_scheduled → closed_treatment_booked | physician approves treatment | physician | creates treatment Booking; consult fee offset |

## Health declaration
`draft → signed → (flagged) → acknowledged` · `signed → expired` (12 months) · `signed → superseded` (client updates answers).
- Submit requires: every question answered, meds text or "none", first+last name, signature (≥10 ink points), attestation.
- `flagged` = any "yes". Pregnancy/breast-feeding + medical treatment ⇒ injection will not happen; physician contacts client; rescheduling for medical reason is free.
- Clinic side (Clinic Booking) may resend the link or open it on the reception tablet.

## Deposit / payment / refund
`pending → succeeded → (refund_requested → credit_note_issued → sent_to_card → received)` · `succeeded → forfeited` (late cancel / no-show) · `succeeded → applied` (offset against treatment payment).
- Refund window from `DepositPolicy.refund_window_hours`; refund always creates a credit note referencing the original invoice.
- Expected card refund: 7–10 business days.

## Waitlist
Entry: `active → offered → booked` · `offered → active` (pass / expired) · `active → expired` (duration end) · `active → left`.
Offer: `sent → accepted | passed | expired` (hold = `settings.waitlist_hold_minutes`, default 30). Offers go in join order to the first entry matching day, time range and practitioner preference; one open offer per slot at a time.

## Gift card
`scheduled → active → partially_redeemed → redeemed` · `active → refunded` (within 14 days of purchase, no redemption) · `active|partially_redeemed → expired` (after `expires_at`; remind 90 and 30 days before).
- Redemption amount ≤ balance; each redemption issues the clinic's tax invoice.
- Treatment-kind cards for medical treatments redeem only after consult approval.

## Review
`draft → submitted → published | rejected` · `published → removed` (only via a new moderation Decision after a report).
- Submit requires rating, title ≥4, body ≥40, both declarations. Photos publish only with consent.
- Target moderation time ≤6 hours. Negative reviews are not removed for being negative; criminal accusations without evidence and naming staff negatively are rejected.

## Verification request
`open → awaiting_document (SLA paused) → open` · `open → approved | rejected`.
- License approve ⇒ name shown as אחריות רפואית; `next_check_at` = +90 days (auto re-check; failure ⇒ hide the medical responsibility and notify owner).
- Claim reject when business already has a verified owner ⇒ suggest staff invite.

## Staff invite
`sent → accepted → active` · `sent → expired` (7 days) · `sent → declined` · `accepted` with licensed profession ⇒ creates VerificationRequest(license).

## Branch
`draft (not billed) → live (billed from next cycle, no proration) → unpublished`.

## Subscription
Plan change: upgrade basic → advanced immediately (prorated); downgrade at next cycle, clinic-system data kept 90 days.
`active → past_due` (charge failed; retry day 3 and day 7; ⇢ M17) `→ hidden` (day 14; profile hidden, not deleted) `→ active` (paid) · `active → cancelled` (self-serve, end of period).

## Campaign (sponsored)
`draft → in_review (weeks held 24h) → approved (charged) → live → ended` · `in_review → rejected (not charged, weeks released)` · `approved → cancelled` (≥48h before a week starts: that week refunded).
- Client-side block before submit on forbidden wording; staff approval blocked while wording flags or unpaid subscription.

## Cookie consent
`unset → essential_only | all | custom` — changeable any time from the floating button.
