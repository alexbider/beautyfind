'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { EMAIL_RE, isCompanyNo } from '@/lib/format';
import { isPlanKey, planPrice, type PlanKey } from '@/lib/pricing';
import { applyPlanChange, checkoutUrl, portalUrl } from '@/lib/server/billing';
import { requireArea } from '@/lib/server/biz';
import { db } from '@/lib/server/db';

// Billing tab actions. Every action re-checks `billing: edit` on the server.
// Plan rules (08-open-decisions.md A3): upgrades apply now (prorated), downgrades wait for the end of the cycle.

export type ActionResult = { ok: true; message?: string; url?: string } | { ok: false; error: string };

const RANK: Record<PlanKey, number> = { basic: 0, advanced: 1 };
const FORBIDDEN = 'אין לכם הרשאה לשנות את המנוי. שינויים אפשריים רק דרך המנהל הראשי.';

/**
 * Sends the change to Stripe when the business is billed there. `now` applies the saved plan and cycle
 * at once; anything still pending is then scheduled for the end of the period (or a schedule is undone).
 * A Stripe failure is reported, but the change stays saved and the daily billing run retries the count.
 */
async function pushToStripe(businessId: string, now: boolean): Promise<string | null> {
  try {
    if (now) await applyPlanChange(businessId, 'now');
    const sub = await db.subscription.findUnique({ where: { businessId }, select: { pendingPlan: true, pendingCycle: true } });
    await applyPlanChange(businessId, sub?.pendingPlan || sub?.pendingCycle ? 'period_end' : 'undo');
    return null;
  } catch (e) {
    console.error('[billing] plan change in Stripe failed', businessId, e);
    return 'השינוי נשמר, אבל עדכון החיוב לא הושלם. ננסה שוב אוטומטית, ואם זה נמשך נחזור אליכם.';
  }
}

async function guard() {
  try {
    return await requireArea('billing', 'edit');
  } catch {
    return null;
  }
}

export async function changePlan(target: string): Promise<ActionResult> {
  const ctx = await guard();
  if (!ctx) return { ok: false, error: FORBIDDEN };
  if (!isPlanKey(target)) return { ok: false, error: 'מסלול לא מוכר.' };

  const businessId = ctx.business.id;
  const sub = await db.subscription.findUnique({ where: { businessId } });

  let warn: string | null = null;
  if (!sub) {
    // No card yet, so nothing is billed: the first charge happens through Checkout, or when the first
    // branch goes live if the card was saved before that.
    await db.subscription.create({
      data: { businessId, plan: target, cycle: 'monthly', pricePerBranchAgorot: planPrice(target, 'monthly') * 100, status: 'incomplete' },
    });
  } else if (target === sub.plan) {
    // Picking the current plan again cancels a scheduled downgrade.
    if (sub.pendingPlan) {
      await db.subscription.update({ where: { businessId }, data: { pendingPlan: null } });
      warn = await pushToStripe(businessId, false);
    }
  } else if (RANK[target] > RANK[sub.plan] || !sub.stripeSubscriptionId) {
    // An upgrade, or any change before the first charge (nothing paid yet, so nothing to wait for).
    // Effective immediately; for an upgrade the prorated difference for the rest of the period is on the next invoice.
    await db.subscription.update({
      where: { businessId },
      data: { plan: target, pendingPlan: null, pricePerBranchAgorot: planPrice(target, sub.cycle) * 100 },
    });
    warn = await pushToStripe(businessId, true);
  } else {
    // Downgrade: scheduled for currentPeriodEnd. Clinic-system data is kept 90 days after it takes effect.
    await db.subscription.update({ where: { businessId }, data: { pendingPlan: target } });
    warn = await pushToStripe(businessId, false);
  }

  revalidatePath('/biz', 'layout');
  return warn ? { ok: true, message: warn } : { ok: true };
}

/** Monthly → yearly applies now (prorated). Yearly → monthly is scheduled for the renewal date. */
export async function changeCycle(target: string): Promise<ActionResult> {
  const ctx = await guard();
  if (!ctx) return { ok: false, error: FORBIDDEN };
  if (target !== 'monthly' && target !== 'yearly') return { ok: false, error: 'מחזור חיוב לא מוכר.' };

  const businessId = ctx.business.id;
  const sub = await db.subscription.findUnique({ where: { businessId } });
  if (!sub) return { ok: false, error: 'עדיין אין מנוי. בחרו מסלול קודם.' };
  if (sub.cycle === target) {
    // Picking the current cycle again cancels a scheduled switch.
    let warn: string | null = null;
    if (sub.pendingCycle) {
      await db.subscription.update({ where: { businessId }, data: { pendingCycle: null } });
      warn = await pushToStripe(businessId, false);
    }
    revalidatePath('/biz/billing');
    return warn ? { ok: true, message: warn } : { ok: true };
  }
  if (target === 'monthly' && !sub.stripeSubscriptionId) {
    // Nothing paid yet: the switch back to monthly applies at once.
    await db.subscription.update({ where: { businessId }, data: { cycle: 'monthly', pendingCycle: null, pricePerBranchAgorot: planPrice(sub.plan, 'monthly') * 100 } });
    revalidatePath('/biz/billing');
    return { ok: true };
  }
  if (target === 'monthly') {
    // Yearly → monthly waits for the renewal date (a Stripe subscription schedule switches the price then).
    await db.subscription.update({ where: { businessId }, data: { pendingCycle: 'monthly' } });
    const warn = await pushToStripe(businessId, false);
    revalidatePath('/biz/billing');
    return warn ? { ok: true, message: warn } : { ok: true };
  }

  // Monthly → yearly: Stripe charges the yearly price now and credits the unused part of the current month.
  await db.subscription.update({
    where: { businessId },
    data: { cycle: 'yearly', pendingCycle: null, pricePerBranchAgorot: planPrice(sub.plan, 'yearly') * 100 },
  });
  const warn = await pushToStripe(businessId, true);
  revalidatePath('/biz/billing');
  return warn ? { ok: true, message: warn } : { ok: true };
}

const Details = z.object({
  companyNo: z.string().max(20),
  invoiceEmail: z.string().max(160),
  accountantEmail: z.string().max(160),
});

export async function saveBillingDetails(input: { companyNo: string; invoiceEmail: string; accountantEmail: string }): Promise<ActionResult> {
  const ctx = await guard();
  if (!ctx) return { ok: false, error: FORBIDDEN };
  const parsed = Details.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'חלק מהפרטים אינם תקינים.' };

  const companyNo = parsed.data.companyNo.replace(/\D/g, '');
  const invoiceEmail = parsed.data.invoiceEmail.trim().toLowerCase();
  const accountantEmail = parsed.data.accountantEmail.trim().toLowerCase();

  if (companyNo && !isCompanyNo(companyNo)) return { ok: false, error: 'מספר ח״פ או עוסק מורשה צריך להכיל בדיוק 9 ספרות.' };
  if (invoiceEmail && !EMAIL_RE.test(invoiceEmail)) return { ok: false, error: 'כתובת הדוא״ל למשלוח חשבונית אינה תקינה.' };
  if (accountantEmail && !EMAIL_RE.test(accountantEmail)) return { ok: false, error: 'כתובת הדוא״ל של משרד רואה החשבון אינה תקינה.' };

  await db.business.update({
    where: { id: ctx.business.id },
    data: { companyNo: companyNo || null, invoiceEmail: invoiceEmail || null, accountantEmail: accountantEmail || null },
  });
  revalidatePath('/biz/billing');
  return { ok: true, message: 'הפרטים נשמרו' };
}

/** Opens Stripe Checkout to save a card (and start the subscription when a branch is already live). */
export async function startCheckout(): Promise<ActionResult> {
  const ctx = await guard();
  if (!ctx) return { ok: false, error: FORBIDDEN };
  try {
    const r = await checkoutUrl(ctx.business.id);
    return r.ok ? { ok: true, url: r.url } : r;
  } catch (e) {
    console.error('[billing] checkout failed', e);
    return { ok: false, error: 'לא הצלחנו לפתוח את עמוד התשלום. נסו שוב בעוד רגע.' };
  }
}

/** Opens Stripe's billing portal: update the card, download invoices, cancel at the end of the period. */
export async function openPortal(): Promise<ActionResult> {
  const ctx = await guard();
  if (!ctx) return { ok: false, error: FORBIDDEN };
  try {
    const r = await portalUrl(ctx.business.id);
    return r.ok ? { ok: true, url: r.url } : r;
  } catch (e) {
    console.error('[billing] portal failed', e);
    return { ok: false, error: 'לא הצלחנו לפתוח את ניהול התשלום. נסו שוב בעוד רגע.' };
  }
}
