'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { EMAIL_RE, isCompanyNo } from '@/lib/format';
import { isPlanKey, planPrice, type PlanKey } from '@/lib/pricing';
import { requireArea } from '@/lib/server/biz';
import { db } from '@/lib/server/db';

// Billing tab actions. Every action re-checks `billing: edit` on the server.
// Plan rules (08-open-decisions.md A3): upgrades apply now (prorated), downgrades wait for the end of the cycle.

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const RANK: Record<PlanKey, number> = { basic: 0, advanced: 1 };
const FORBIDDEN = 'אין לכם הרשאה לשנות את המנוי. שינויים אפשריים רק דרך המנהל הראשי.';

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

  if (!sub) {
    // TODO(payments): the first charge happens when the first branch goes live.
    await db.subscription.create({
      data: { businessId, plan: target, cycle: 'monthly', pricePerBranchAgorot: planPrice(target, 'monthly') * 100 },
    });
  } else if (target === sub.plan) {
    // Picking the current plan again cancels a scheduled downgrade.
    if (sub.pendingPlan) await db.subscription.update({ where: { businessId }, data: { pendingPlan: null } });
  } else if (RANK[target] > RANK[sub.plan]) {
    // Upgrade: effective immediately.
    // TODO(payments): charge the prorated difference for the rest of the current period on the next invoice.
    await db.subscription.update({
      where: { businessId },
      data: { plan: target, pendingPlan: null, pricePerBranchAgorot: planPrice(target, sub.cycle) * 100 },
    });
  } else {
    // Downgrade: scheduled for currentPeriodEnd. Clinic-system data is kept 90 days after it takes effect.
    await db.subscription.update({ where: { businessId }, data: { pendingPlan: target } });
  }

  revalidatePath('/biz', 'layout');
  return { ok: true };
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
    if (sub.pendingCycle) await db.subscription.update({ where: { businessId }, data: { pendingCycle: null } });
    revalidatePath('/biz/billing');
    return { ok: true };
  }
  if (target === 'monthly') {
    // TODO(billing-job): apply pendingPlan / pendingCycle at currentPeriodEnd.
    await db.subscription.update({ where: { businessId }, data: { pendingCycle: 'monthly' } });
    revalidatePath('/biz/billing');
    return { ok: true };
  }

  // TODO(payments): charge the yearly price minus the unused part of the current month.
  await db.subscription.update({
    where: { businessId },
    data: { cycle: 'yearly', pricePerBranchAgorot: planPrice(sub.plan, 'yearly') * 100 },
  });
  revalidatePath('/biz/billing');
  return { ok: true };
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
