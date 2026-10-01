'use server';

import type { ReviewStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import { profileHref } from '@/lib/server/public';

// Review moderation: publish, reject (never shown) or remove (was public, now hidden), each an
// append-only decision with a reason, and the profile page refreshed. Reports from the contact form
// move between new, in progress and closed.

type Result = { ok: true } | { ok: false; error: string };

const ReviewInput = z.object({ id: z.string().uuid(), action: z.enum(['publish', 'reject', 'remove']), reason: z.string().trim().max(500).optional() });
const NEXT: Record<'publish' | 'reject' | 'remove', ReviewStatus> = { publish: 'published', reject: 'rejected', remove: 'removed' };

export async function moderateReviewAction(input: z.input<typeof ReviewInput>): Promise<Result> {
  const user = await areaUserOrNull('moderation', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = ReviewInput.safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  const r = await db.review.findUnique({ where: { id: p.data.id }, select: { id: true, status: true, branch: { select: { regionSlug: true, slug: true, businessId: true, categories: { select: { categorySlug: true, isPrimary: true } } } } } });
  if (!r) return { ok: false, error: 'ביקורת לא נמצאה' };
  if ((p.data.action === 'reject' || p.data.action === 'remove') && !p.data.reason) return { ok: false, error: 'דחייה או הסרה דורשות סיבה' };
  const status = NEXT[p.data.action];
  if (r.status === status) return { ok: true };
  await db.$transaction([
    db.review.update({ where: { id: r.id }, data: { status } }),
    db.decision.create({ data: { actorId: user.id, actorRole: user.opsRole ?? 'moderator', subjectType: 'review', subjectId: r.id, action: p.data.action, reason: p.data.reason || null } }),
    db.auditLog.create({ data: { actorId: user.id, action: 'review_moderate', subjectType: 'review', subjectId: r.id, businessId: r.branch.businessId, meta: { from: r.status, to: status, note: p.data.reason || null } } }),
  ]);
  revalidatePath(profileHref(r.branch));
  revalidatePath('/ops/moderation');
  revalidatePath('/ops');
  return { ok: true };
}

const ReportInput = z.object({ id: z.string().uuid(), status: z.enum(['new', 'in_progress', 'closed']), note: z.string().trim().max(300).optional() });

export async function setReportStatusAction(input: z.input<typeof ReportInput>): Promise<Result> {
  const user = await areaUserOrNull('moderation', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = ReportInput.safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  const m = await db.contactMessage.findUnique({ where: { id: p.data.id }, select: { id: true, ref: true, status: true } });
  if (!m) return { ok: false, error: 'פנייה לא נמצאה' };
  await db.$transaction([
    db.contactMessage.update({ where: { id: m.id }, data: { status: p.data.status } }),
    db.auditLog.create({ data: { actorId: user.id, action: 'contact_status', subjectType: 'contact_message', subjectId: m.id, meta: { ref: m.ref, from: m.status, to: p.data.status, note: p.data.note || null } } }),
  ]);
  revalidatePath('/ops/moderation');
  return { ok: true };
}
