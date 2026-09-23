// Plans are priced per live branch, before VAT. Yearly = 10× monthly. No commissions.
// Source: 08-open-decisions.md §A3.

export type PlanKey = 'basic' | 'advanced';

export const PLAN_MONTHLY_NIS: Record<PlanKey, number> = { basic: 149, advanced: 249 };
export const YEARLY_MULTIPLIER = 10;
export const VAT_RATE = 0.18;

export const planPrice = (plan: PlanKey, cycle: 'monthly' | 'yearly') =>
  PLAN_MONTHLY_NIS[plan] * (cycle === 'yearly' ? YEARLY_MULTIPLIER : 1);

export const isPlanKey = (v: unknown): v is PlanKey => v === 'basic' || v === 'advanced';
