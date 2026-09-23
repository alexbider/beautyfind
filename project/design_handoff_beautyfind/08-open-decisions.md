# Decisions (resolved) and remaining checks

## A. Product decisions — DECIDED

### A1. Booking happens on BeautyFind ✅
- Every branch books natively on the platform (Booking → Manage Booking → Clinic Booking).
- The branch calendar **syncs with an external source**: Google Calendar, Outlook/Microsoft 365, or the clinic's existing booking system (API or iCal). Two-way: BeautyFind bookings are written out; external events block slots as "busy".
- Confirmations, reminders and updates go out by **WhatsApp, SMS and email** (channel per message in `05-messages.md`; clinic can switch channels off in settings, service messages always have at least one channel).
- Directory FAQ updated accordingly.
- Data: `CalendarConnection` (see 02). If sync fails, slots stay bookable only from the BeautyFind calendar and the owner is alerted.

### A2. One consult flow — Consult Request ✅
Chosen for best UX and Israeli market practice (aesthetic clinics run consult appointments before injectables, and patients expect to pick a time):
- In **Booking**, selecting a medical treatment → the step-1 button reads "המשך לקביעת ייעוץ רפואי" and opens **Consult Request** (prefilled clinic).
- **Consult Request** = short intake (areas, goal, prior injections, format) **+ a real slot picker** from the physician's consult availability. Picking a slot books the consult immediately (status `consult_scheduled`, fee per settings, offset against treatment).
- "אף מועד לא מתאים" → the client gives preferred time ranges and the clinic proposes a time from the inbox (status `new`).
- After the consult the physician decides; if suitable, the treatment can happen in the same visit or a treatment booking is created. Medical decline stays physician-only.

### A3. Pricing ✅
| Plan | Price | Includes |
|---|---|---|
| **רישום בסיסי** (basic) | ₪149 / live branch / month | verified profile, gallery, price menu, online booking with calendar sync, WhatsApp/SMS/email confirmations & reminders, Google + verified reviews, leads board, profile analytics |
| **רישום מתקדם + CRM** (advanced) | ₪249 / live branch / month | everything in basic + clinic system (Noa Clinic): calendar, CRM, health declarations, check-in & clinical record, deposits, gift cards, waitlist, consult inbox, staff & permissions, inventory, automations, integrations |
- Yearly = 10× monthly. Prices before VAT. No commissions. Draft branches not billed. Switching plans takes effect next cycle when downgrading (clinic-system data kept 90 days), immediately (prorated) when upgrading.
- **Sponsored** placements are sold separately per week (unchanged) and invoiced separately. The old add-ons (כרטיס מודגש, קידום בקטגוריה, ניהול ביקורות) are removed.
- Feature gating: every advanced-only screen/area checks `subscription.plan === 'advanced'`; basic users see an upgrade card in place of the area.

### A4. Reviews: Google + internal, shown separately ✅
- Google: rating + count, synced weekly, link to source, cannot be replied to from BeautyFind.
- BeautyFind: verified-visit reviews only, moderated, one public business reply.
- Never averaged together. Ranking uses both as separate signals. Directory trust copy and Get Listed updated.

### A5. One role model ✅ (see `04-permissions.md`)
- **Presets:** owner · manager (מנהלת קליניקה) · front (מזכירות) · book (הנהלת חשבונות) · practitioner (מטפל/ת). Presets only seed per-area levels; the owner can change any cell.
- **Profession** is separate and gates medical actions.
- Code keys: Noa Clinic's `reception` = `front`, `accountant` = `book`; Staff Invite now uses the same preset keys.

## B. Still to choose (vendors)
- Payment + invoicing provider (Israeli acquirer with instalments, tokenisation, sub-merchants, and document API issuing in the clinic's name and BeautyFind's name). Evaluate: Cardcom, Tranzila, Grow/Meshulam, PayPlus + Green Invoice / iCount / Morning.
- WhatsApp Business BSP + SMS gateway + transactional email (Meta template approval needed per template).
- Calendar sync: Google Calendar API, Microsoft Graph, iCal fallback; list which Israeli booking systems to integrate first.

## C. Legal checks (Israel) — confirm with counsel
- Gift card validity ≥5 years and 14-day cancellation (consumer protection).
- Cancellation / deposit terms shown before payment (distance selling).
- Medical advertising wording blocked in Sponsored (Ministry of Health rules).
- Health declarations & clinical records: Privacy Protection (Data Security) Regulations, high security level; retention rules for medical records.
- Marketing messages: Communications Law §30A — opt-in per sender, unsubscribe in every marketing message.
- Accessibility: ת״י 5568 AA; statement with coordinator.

## D. Small follow-ups in the designs
- `Saved` renders demo data; bind to SavedClinic.
- `Notifications` marketing footer: link "הסרה מהרשימה" to Unsubscribe.
- `Account` export / delete request confirmation flow.
- Deposit amounts in prototypes are prop defaults; real value always from `DepositPolicy`.
