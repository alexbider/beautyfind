# Permissions

Two independent dimensions per staff member:
1. **Permission profile** — access level per area (what screens/actions they can use).
2. **Profession** — what they are legally allowed to do clinically. Profession gates medical actions regardless of profile.

## Clinic areas × levels
Levels: `none` (hidden from nav) · `view` (read-only; edit controls replaced by a lock banner) · `edit`.
Bookings area uses `none · view · manage` (manage = create, move, cancel, check in, message clients).

| Area | owner | manager (מנהלת קליניקה) | front (מזכירות) | book (הנהלת חשבונות) | practitioner (מטפל/ת) |
|---|---|---|---|---|---|
| overview | edit | edit | view | none | view |
| analytics | edit | view | none | none | none |
| profile & gallery | edit | edit | view | none | view |
| menu & prices | edit | edit | view | view | view |
| reviews (reply) | edit | edit | view | none | view |
| leads / CRM | edit | edit | edit | none | view |
| bookings & calendar | manage | manage | manage | none | own only |
| consult inbox, waitlist | manage | manage | manage | none | view |
| gift cards (redeem) | edit | edit | edit | view | none |
| billing, invoices, deposit policy | edit | none | none | edit | none |
| inventory | edit | edit | view | view | deduct on finish |
| team & permissions | owner only | — | — | — | — |

Presets are starting points; the owner can change any cell (Dashboard → צוות והרשאות). Staff Invite uses the same preset keys (`manager · front · book · practitioner`). Noa Clinic code keys map as `reception` → `front`, `accountant` → `book`. Advanced-only areas (bookings, consult, waitlist, gift cards, inventory, declarations) are hidden for everyone on the basic plan.

## Profession-gated actions (cannot be granted by profile)
| Action | Allowed |
|---|---|
| Perform / record an injectable treatment | doctor; nurse under a supervising doctor in the same business |
| Close a consult request for a **medical** reason | doctor |
| Acknowledge a flagged health declaration and start treatment | doctor |
| Approve treatment after consult | doctor |
| Read health declaration answers | treating practitioner(s) of that booking + doctor responsible for the branch |
| Write clinical record (batch, units, notes) | practitioner performing the treatment |
| Appear as אחריות רפואית | doctor with verified license |
| Appear as איש מקצוע אחראי | cosmetician / technician with verified certificate |

Front desk (profile = front) sees declaration **status only** (signed / pending / flagged), never answers.

## BeautyFind staff roles
| Role | Can |
|---|---|
| moderator | Moderation: reviews, reports, listing content |
| verifier | Verification: licenses, certificates, claims |
| ops | Admin: businesses, billing retries, BeautyFind invoices, disputes (recommend), sponsored approval |
| support | read-only login into a business account; every session logged and visible to the business |
| legal | receives escalated disputes |
BeautyFind staff never see health declarations or clinical notes.

## Client
- Guest link (`/b/:token`) grants view/reschedule/cancel of that booking only, no account data.
- Logged-in client: own bookings, declarations (copy / correction request), reviews, saved, gift cards, consents, export / delete request.

## UI rules
- Nav items with `none` are removed, not disabled.
- `view` areas show a lock banner stating who can grant access.
- Disabled medical actions show the reason ("שמור לרופא/ה") instead of disappearing (see Consult Request `viewerRole=front`, Clinic Booking `viewerRole=front`).
