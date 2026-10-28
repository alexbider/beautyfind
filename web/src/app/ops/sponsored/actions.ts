'use server';

import type { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/access';
import { db } from '@/lib/server/db';
import { activateCampaignSafe, cancelCampaign, requestCampaign, reviewChecks } from '@/lib/server/sponsored';
import { pathOfPageKey } from '@/lib/sponsored';
import { SPONSORED_LINE_MAX } from '@/lib/sponsoredChecks';

// A sponsored placement is approved or rejected here, with the automatic checks recomputed at the moment of
// the decision (a page that filled up meanwhile cannot be approved). Approval starts billing at once: the
// monthly Stripe subscription on the business's card (src/lib/server/sponsored), or a wait for the owner to
// save a card. A manual order lets staff enter a placement a business asked for by phone.

type Result = { ok: true; ref?: string; message?: string } | { ok: false; error: string };

const refresh = (pageKey?: string) => {
  for (const p of ['/ops/sponsored', '/ops', '/biz/sponsored']) revalidatePath(p);
  if (pageKey) revalidatePath(pathOfPageKey(pageKey));
};

const ReviewInput = z.object({ id: z.string().uuid(), decision: z.enum(['approve', 'reject']), note: z.string().trim().max(600).optional() });

const STATE_TEXT = { billing: 'אושר והחיוב החודשי הופעל', free_month: 'אושר; החודש הראשון חינם והחיוב יתחיל אחריו', needs_card: 'אושר; העסק צריך לשמור כרטיס כדי שהמקום יעלה', manual: 'אושר; Stripe לא מחובר, יש לתאם תשלום ידנית' } as const;

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
    db.campaign.update({ where: { id: c.id }, data: { status, checks: r.checks as unknown as Prisma.InputJsonValue, reviewNote: p.data.note || null, reviewedById: user.id, reviewedAt: new Date(), holdUntil: null, ...(status === 'rejected' ? { endedAt: new Date() } : {}) } }),
    db.decision.create({ data: { actorId: user.id, actorRole: user.opsRole ?? 'ops', subjectType: 'campaign', subjectId: c.id, action: status === 'approved' ? 'approve' : 'reject', reason: p.data.note || null } }),
    db.auditLog.create({ data: { actorId: user.id, action: 'campaign_review', subjectType: 'campaign', subjectId: c.id, businessId: c.businessId, meta: { ref: c.ref, decision: status, note: p.data.note || null } } }),
  ]);
  let message: string | undefined;
  if (status === 'approved') {
    const a = await activateCampaignSafe(c.id);
    message = a.ok ? STATE_TEXT[a.state] : a.error;
  }
  refresh(c.pageKey);
  return { ok: true, message };
}

const OrderInput = z.object({
  branchId: z.string().uuid(),
  pageKey: z.string().min(4).max(120),
  line: z.string().trim().min(3).max(SPONSORED_LINE_MAX),
  featuredTreatment: z.string().trim().max(80).optional(),
  startsAt: z.string().optional(),
});

export async function createCampaignAction(input: z.input<typeof OrderInput>): Promise<Result> {
  const user = await areaUserOrNull('sponsored', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = OrderInput.safeParse(input);
  if (!p.success) return { ok: false, error: `קלט לא תקין: שורה של 3 עד ${SPONSORED_LINE_MAX} תווים` };
  const branch = await db.branch.findUnique({ where: { id: p.data.branchId }, select: { businessId: true } });
  if (!branch) return { ok: false, error: 'סניף לא נמצא' };
  let startsAt: Date | null = null;
  if (p.data.startsAt) {
    const d = new Date(`${p.data.startsAt}T00:00:00+03:00`);
    if (Number.isNaN(d.getTime())) return { ok: false, error: 'תאריך לא תקין' };
    startsAt = d;
  }
  const r = await requestCampaign({ businessId: branch.businessId, branchId: p.data.branchId, pageKey: p.data.pageKey, line: p.data.line, featuredTreatment: p.data.featuredTreatment, startsAt }, { userId: user.id, via: 'ops' });
  if (!r.ok) return r;
  refresh();
  return { ok: true, ref: r.ref, message: r.free ? 'החודש הראשון חינם (מבצע ההשקה)' : undefined };
}

export async function cancelCampaignAction(id: string): Promise<Result> {
  const user = await areaUserOrNull('sponsored', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'קלט לא תקין' };
  const r = await cancelCampaign(id, { userId: user.id });
  if (!r.ok) return r;
  const c = await db.campaign.findUnique({ where: { id }, select: { pageKey: true } });
  refresh(c?.pageKey);
  return { ok: true, message: r.message };
}
