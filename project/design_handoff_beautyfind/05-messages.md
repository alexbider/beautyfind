# Messages

Type: **S** = service (always sent, no unsubscribe) · **M** = marketing (needs opt-in per sender and channel, unsubscribe link mandatory). Channel order: WhatsApp → SMS fallback; email where noted. All WhatsApp templates need Meta approval (utility for S, marketing for M). Copy lives in `Notifications` (templates) and `Emails` (HTML emails); flows in `01-flows.md`.

| # | Message | Trigger | To | Channel | Type | Link target |
|---|---|---|---|---|---|---|
| M1 | Booking confirmed / rescheduled | booking confirmed or moved | client | WA + email | S | Manage Booking |
| M2 | Reminder | 24h before (configurable) | client | WA | S | Manage Booking |
| M3 | Health declaration request | booking needs declaration; again 24h before if unsigned | client | WA | S | Health Declaration |
| M4 | Clinic: new booking / check-in / flagged declaration | booking events | staff | in-app + WA | S | Clinic Booking |
| M5 | Aftercare instructions | booking completed | client | WA | S | Aftercare |
| M6 | Review request | 3 days after completed | client | WA | S | Review |
| M7 | Waitlist offer (with hold timer) | slot freed and entry matches | client | WA | S | Waitlist offer |
| M8 | Consult: request more details | clinic action | client | WA | S | reply in chat |
| M9 | Consult: proposed time | clinic action | client | WA | S | confirm in chat |
| M10 | Consult: decline with explanation | clinic action | client | WA | S | — |
| M11 | Refund & credit note | on-time cancellation | client | email | S | Receipt |
| M12 | Clinic cancelled your booking | clinic cancels | client | WA + email | S | Booking |
| M13 | Tax invoice / receipt | any payment | payer | email | S | Receipt (Emails `invoice`) |
| M14 | Gift card delivery | send_at reached | recipient | WA or email | S | Gift Cards redeem (Emails `gift`) |
| M15 | Gift card opened / expiring (90, 30 days) | events | buyer / holder | email | S | Gift Cards |
| M16 | OTP code | login, staff invite | user | WA / SMS | S | — |
| M17 | Password reset (30 min, single use) | request | business user | email | S | Auth (Emails `reset`) |
| M18 | Staff invitation (7 days) | owner invites | invitee | email | S | Staff Invite |
| M19 | Verification outcome | approve / reject / need document | business | email + in-app | S | Dashboard |
| M20 | Ownership claim outcome | decision | claimant + previous owner | email | S | Dashboard |
| M21 | Review published / rejected; business reply | moderation | reviewer / business | WA / email | S | Profile |
| M22 | Sponsored: approved / rejected / starts / report | campaign events | business | email | S | Sponsored |
| M23 | Failed charge (day 0, 3, 7, 14) | subscription | owner + billing role | email + WA | S | Dashboard billing |
| M24 | Clinic promotions / newsletter | clinic sends | opted-in clients | WA / email / SMS | **M** | Unsubscribe |
| M25 | BeautyFind magazine | editorial | opted-in users | email | **M** | Unsubscribe |

Rules:
- Marketing opt-in is collected per clinic at booking ("אשמח לקבל עדכונים ומבצעים בוואטסאפ" — unchecked by default).
- Unsubscribe applies per clinic or all, per channel; effective immediately, max 3 business days. Replying "הסר" in any channel = unsubscribe for that sender + channel.
- No marketing messages on Shabbat or holidays; quiet hours 21:00–08:00 for all non-urgent messages.
- Phone numbers in templates use international `tel:` form without spaces (`tel:+972977411180`).
- Emails: inline-styled tables, 560px, `dir="rtl"`, Arial fallback, plain-text part, sender = clinic name via `…@mail.beautyfind.co.il` for clinic documents.
