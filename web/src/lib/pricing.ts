// Plans are priced per live branch, before VAT. Yearly = 10× monthly. No commissions.
// Source: 08-open-decisions.md §A3.

export type PlanKey = 'basic' | 'advanced';

export const PLAN_MONTHLY_NIS: Record<PlanKey, number> = { basic: 149, advanced: 249 };
export const YEARLY_MULTIPLIER = 10;
export const VAT_RATE = 0.18; // Israeli VAT, for clinic prices shown to clients

// BeautyFind's own charges (plans, sponsored weeks) are billed by Israfind Group, a Delaware company.
// It charges no Israeli VAT and issues a regular invoice, not an Israeli חשבונית מס (decision 2026-09-23).
export const PLATFORM_VAT_RATE = 0;
/** Short note next to BeautyFind plan and sponsored prices. */
export const PLATFORM_PRICE_NOTE = 'ללא מע״מ ישראלי';
/** One-line explanation for billing screens, FAQs and terms. */
export const PLATFORM_BILLING_LINE =
  'החיוב והחשבונית הם של Israfind Group, חברה הרשומה בדלאוור, ארה״ב, שאינה גובה מע״מ ישראלי ואינה מנפיקה חשבונית מס ישראלית. עוסקים מדווחים על מע״מ בגין שירות מחו״ל לפי הדין החל עליהם.';

export const planPrice = (plan: PlanKey, cycle: 'monthly' | 'yearly') =>
  PLAN_MONTHLY_NIS[plan] * (cycle === 'yearly' ? YEARLY_MULTIPLIER : 1);

export const isPlanKey = (v: unknown): v is PlanKey => v === 'basic' || v === 'advanced';

// Chains and franchises: every branch is billed, and from the fourth branch on each extra one gets 25% off.
export const CHAIN_FULL_PRICE_BRANCHES = 3;
export const CHAIN_DISCOUNT = 0.25;

/** The subscription total for `branches` live branches at `unit` per branch, with the chain discount applied. */
export function chainTotal(branches: number, unit: number): { total: number; fullPrice: number; discounted: number; discount: number } {
  const fullPrice = Math.min(branches, CHAIN_FULL_PRICE_BRANCHES);
  const discounted = Math.max(0, branches - CHAIN_FULL_PRICE_BRANCHES);
  const discount = Math.round(discounted * unit * CHAIN_DISCOUNT * 100) / 100;
  return { total: Math.round((fullPrice * unit + discounted * unit * (1 - CHAIN_DISCOUNT)) * 100) / 100, fullPrice, discounted, discount };
}
