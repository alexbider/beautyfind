'use server';

import type { Prisma, RegionSlug } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/guard';
import { CATEGORIES, REGIONS } from '@/lib/catalog';
import { db } from '@/lib/server/db';
import { platformSettings } from '@/lib/server/platformSettings';
import { nextRef } from '@/lib/server/refs';
import { contentChecks, discountPctFor, nextWeekStart, SPONSORED_LINE_MAX } from '@/lib/sponsoredChecks';
import { reviewChecks } from './data';

// A sponsored placement is approved or rejected here, with the automatic checks recomputed at the
// moment of the decision (a list that filled up meanwhile cannot be approved). Billing: the charge
// is created against the business's platform account only after approval; with no platform
// charging engine connected yet the approval records the amount due, and the accounting screen shows
// it as an open charge. A manual order lets staff enter a placement a business asked for by phone.

type Result = { ok: true; ref?: string } | { ok: false; error: string };

const ReviewInput = z.object({ id: z.string().uuid(), decision: z.enum(['approve', 'reject']), note: z.string().trim().max(600).optional() });

export async function reviewCampaignAction(input: z.input<typeof ReviewInput>): Promise<Result> {
  const user = await areaUserOrNull('sponsored', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = ReviewInput.safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  const c = await db.campaign.findUnique({ where: { id: p.data.id } });
  if (!c) return { ok: false, error: 'לא נמצא' };
  if (c.status !== 'pending_review') return { ok: false, error: 'המקום כבר נבדק' };
  const r = await reviewChecks(c);
  if (p.data.decision === 'approve' && r.checks.some(x => x.result === 'bad')) return { ok: false, error: 'יש ממצאים חוסמים; אפשר לדחות עם הסבר או לבקש תיקון מהעסק' };
  if (p.data.decision === 'reject' && !p.data.note) return { ok: false, error: 'דחייה דורשת הסבר לעסק' };
  const status = p.data.decision === 'approve' ? 'approved' : 'rejected';
  await db.$transaction([
    db.campaign.update({ where: { id: c.id }, data: { status, checks: r.checks as unknown as Prisma.InputJsonValue, reviewNote: p.data.note || null, reviewedById: user.id, reviewedAt: new Date(), holdUntil: null } }),
    db.decision.create({ data: { actorId: user.id, actorRole: user.opsRole ?? 'ops', subjectType: 'campaign', subjectId: c.id, action: status === 'approved' ? 'approve' : 'reject', reason: p.data.note || null } }),
    db.auditLog.create({ data: { actorId: user.id, action: 'campaign_review', subjectType: 'campaign', subjectId: c.id, businessId: c.businessId, meta: { ref: c.ref, decision: status, note: p.data.note || null } } }),
  ]);
  revalidatePath('/ops/sponsored');
  revalidatePath('/ops');
  return { ok: true };
}

const OrderInput = z.object({
  branchId: z.string().uuid(),
  region: z.string(),
  category: z.string(),
  weekStart: z.string().optional(),
  weeks: z.coerce.number().int().min(1).max(12),
  line: z.string().trim().min(3).max(SPONSORED_LINE_MAX),
  featuredTreatment: z.string().trim().max(80).optional(),
});

export async function createCampaignAction(input: z.input<typeof OrderInput>): Promise<Result> {
  const user = await areaUserOrNull('sponsored', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = OrderInput.safeParse(input);
  if (!p.success) return { ok: false, error: `קלט לא תקין: שורה עד ${SPONSORED_LINE_MAX} תווים, 1 עד 12 שבועות` };
  if (!REGIONS.some(r => r.slug === p.data.region)) return { ok: false, error: 'אזור לא מוכר' };
  if (!CATEGORIES.some(c => c.slug === p.data.category)) return { ok: false, error: 'תחום לא מוכר' };
  const branch = await db.branch.findUnique({ where: { id: p.data.branchId }, select: { id: true, businessId: true } });
  if (!branch) return { ok: false, error: 'סניף לא נמצא' };
  const s = await platformSettings();
  let weekStart = nextWeekStart();
  if (p.data.weekStart) {
    const d = new Date(p.data.weekStart);
    if (Number.isNaN(d.getTime())) return { ok: false, error: 'תאריך לא תקין' };
    weekStart = nextWeekStart(d);
  }
  const ref = await nextRef('AD', 2);
  const checks = contentChecks(p.data.line, p.data.featuredTreatment);
  await db.$transaction([
    db.campaign.create({
      data: {
        ref, businessId: branch.businessId, branchId: branch.id, regionSlug: p.data.region as RegionSlug, categorySlug: p.data.category, weekStart, weeks: p.data.weeks,
        line: p.data.line, featuredTreatment: p.data.featuredTreatment || null, weeklyPriceAgorot: s.sponsoredWeeklyNis * 100, discountPct: discountPctFor(p.data.weeks),
        holdUntil: new Date(Date.now() + 24 * 3_600_000), checks: checks as unknown as Prisma.InputJsonValue,
      },
    }),
    db.auditLog.create({ data: { actorId: user.id, action: 'campaign_order', subjectType: 'campaign', subjectId: branch.id, businessId: branch.businessId, meta: { ref, weeks: p.data.weeks, region: p.data.region, category: p.data.category } } }),
  ]);
  revalidatePath('/ops/sponsored');
  return { ok: true, ref };
}
