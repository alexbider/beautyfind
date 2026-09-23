'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireArea } from '@/lib/server/biz';
import { db } from '@/lib/server/db';
import { REPLY_MAX, REPLY_MIN } from '@/components/dashboard/reviews/stats';

export type ReplyResult = { ok: true; reply: string } | { ok: false; error: string };
export type ReportResult = { ok: true } | { ok: false; error: string };

const Id = z.string().uuid();

/** Only published reviews of the dashboard's branch can be answered or reported. */
async function ownReview(reviewId: string) {
  const ctx = await requireArea('reviews', 'edit');
  if (!ctx.branch || !Id.safeParse(reviewId).success) return { ctx, review: null };
  const review = await db.review.findFirst({
    where: { id: reviewId, branchId: ctx.branch.id, status: 'published', branch: { businessId: ctx.business.id } },
    select: { id: true },
  });
  return { ctx, review };
}

/** Writes or replaces the one public business reply. */
export async function saveReply(reviewId: string, text: string): Promise<ReplyResult> {
  if (typeof text !== 'string') return { ok: false, error: 'התגובה אינה תקינה.' };
  const reply = text.trim();
  if (reply.length < REPLY_MIN) return { ok: false, error: `התגובה קצרה מדי. כתבו לפחות ${REPLY_MIN} תווים.` };
  if (reply.length > REPLY_MAX) return { ok: false, error: `עד ${REPLY_MAX} תווים.` };

  const { ctx, review } = await ownReview(reviewId);
  if (!review) return { ok: false, error: 'הביקורת לא נמצאה. רעננו את הדף.' };

  try {
    await db.review.update({
      where: { id: review.id },
      data: { businessReply: reply, repliedAt: new Date(), repliedById: ctx.user.id },
    });
  } catch (e) {
    console.error('[biz/reviews] reply failed', e);
    return { ok: false, error: 'הפרסום נכשל. התגובה עדיין כאן, נסו שוב בעוד רגע.' };
  }
  revalidatePath('/biz', 'layout');
  return { ok: true, reply };
}

/** Reports a review for a rules breach. Recorded as an append-only Decision for moderation. */
export async function reportReview(reviewId: string): Promise<ReportResult> {
  const { ctx, review } = await ownReview(reviewId);
  if (!review) return { ok: false, error: 'הביקורת לא נמצאה. רעננו את הדף.' };

  const where = { subjectType: 'review', subjectId: review.id, action: 'report', actorRole: 'business' };
  try {
    const already = await db.decision.findFirst({ where, select: { id: true } });
    if (!already) await db.decision.create({ data: { ...where, actorId: ctx.user.id } });
  } catch (e) {
    console.error('[biz/reviews] report failed', e);
    return { ok: false, error: 'הדיווח לא נשלח. נסו שוב בעוד רגע.' };
  }
  revalidatePath('/biz/reviews');
  return { ok: true };
}
