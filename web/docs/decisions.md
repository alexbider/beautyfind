# Product and company decisions

Decisions made after the design handoff. The handoff's `08-open-decisions.md` still holds the earlier ones (booking, consult flow, pricing, reviews, roles).

## 2026-09-23

**Operating company.** BeautyFind is operated by **Israfind Group**, a Delaware company. There is no Israeli ח.פ. Legal pages use generic wording under Israeli law, approved by the company. Contacts are role mailboxes (`privacy@`, `access@`, `legal@beautyfind.co.il`), never personal names. Values live in `src/components/content/meta.ts`.
- Because the company and its hosting are outside Israel, the privacy policy states that data may be processed abroad under the Privacy Protection (Transfer of Data to Databases Abroad) Regulations, 2001.
- Terms: Israeli law applies, the competent courts in Israel have jurisdiction, and consumer rights under the Consumer Protection Law are preserved (no exclusive venue clause).
- **Platform billing (decided):** Israfind Group does not issue Israeli tax invoices. Plans and sponsored weeks are billed from the Delaware company with a regular invoice and no Israeli VAT; Israeli businesses report VAT on services from abroad as the law requires of them. Wording lives in `src/lib/pricing.ts` (`PLATFORM_PRICE_NOTE`, `PLATFORM_BILLING_LINE`, `PLATFORM_VAT_RATE = 0`) and is used by Get Listed, Onboarding, Claim, Billing, Standards, Terms, About, Contact and Help.
- Clinics are unaffected: treatment prices are shown before VAT, and each clinic issues its own tax invoices through its invoicing provider.

**Payments: every business connects its own provider.** Israeli clinics already use different acquirers and invoicing systems, so BeautyFind does not pick one. Each business connects the providers it uses (payments and, separately, invoicing) from its dashboard, and every deposit, treatment payment, gift card and refund goes through that business's own connection. BeautyFind's own charges (subscriptions, sponsored weeks) use one provider chosen by Israfind Group.
- Architecture: one `PaymentProvider` adapter interface (hosted checkout or tokenised charge, refund, webhook verification) and one `InvoiceProvider` interface (issue receipt/invoice, credit note), with an adapter per provider and a per-business `PaymentConnection` holding encrypted credentials.
- First adapters to build: Cardcom, Tranzila, Grow (Meshulam), PayPlus for payments; Green Invoice (Morning), iCount, EZcount for invoicing. Others are added behind the same interface.
- A business without a connected provider can still list and take free bookings; deposits, gift cards and paid consults switch on only after a provider is connected.

**Gift cards: receipt at sale, tax invoice at redemption.** A gift card sale is a prepayment, so the clinic's invoicing provider issues a plain receipt (קבלה) with no VAT when the card is bought. A tax invoice is issued for the amount used at each redemption, so VAT is charged once. Refunds of an unused card go back to the card through the payment provider.

**Guest records follow the verified phone.** Clients can book, join a waitlist or ask for a consult without an account. Signing up or signing in with the same phone, verified by OTP, moves those records to the account. Records that already belong to an account are never moved.

**Online booking is live** (`BOOKING_LIVE = true`). A business can still switch online booking off per branch or per treatment; staff booking by phone or walk-in may override those switches, clients may not.

## 2026-09-24

**Business profile: one combined rating under the name.** The line under the business name shows a single score for Google and BeautyFind together, weighted by review count, with the total count (for example "4.9 (415 ביקורות) Google ו־BeautyFind"). It links to the reviews section, where each source is still shown on its own with its own score, count and distribution. Everywhere else (cards, sidebar, reviews section) the two sources stay separate.

**Directory import: staff approve every listing.** Unclaimed listings can be built in bulk from Google Places, each business's own website and a Claude extraction of its menu (docs/import.md). Nothing is published by the pipeline itself: an ops team member approves, merges or rejects each record at `/ops/import/review`. A record is only auto-marked duplicate on a shared phone, email or Google place id; weaker matches go to a person. Imported listings use our category photos, never photos copied from Google or the business's site. Merging into a claimed listing only links the Google place and rating. `branches.google_place_id` is unique, so the same place cannot be listed twice.
