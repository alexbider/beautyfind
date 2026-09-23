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
