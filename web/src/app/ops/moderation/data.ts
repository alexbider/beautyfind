import 'server-only';
import type { ReviewStatus } from '@prisma/client';
import { db } from '@/lib/server/db';

// Moderation (06-screens.md): reviews before and after publication, and reports (complaints and
// corrections from the contact form). A review is published only after a person reads it; the
// business reply is shown next to it.

export type ReviewFilter = ReviewStatus | 'all';
export const REVIEW_FILTERS: Array<{ key: ReviewFilter; name: string }> = [
  { key: 'submitted', name: 'ממתינות' }, { key: 'published', name: 'פורסמו' }, { key: 'rejected', name: 'נדחו' }, { key: 'removed', name: 'הוסרו' }, { key: 'all', name: 'הכל' },
];
export const REVIEW_STATUS_NAME: Record<ReviewStatus, string> = { submitted: 'ממתינה', published: 'פורסמה', rejected: 'נדחתה', removed: 'הוסרה' };
export const REVIEW_STATUS_TONE: Record<ReviewStatus, 'warn' | 'ok' | 'bad' | 'neutral'> = { submitted: 'warn', published: 'ok', rejected: 'bad', removed: 'neutral' };

export async function listReviews(filter: ReviewFilter) {
  return db.review.findMany({
    where: filter === 'all' ? {} : { status: filter },
    orderBy: { createdAt: 'desc' }, take: 100,
    select: {
      id: true, rating: true, title: true, body: true, authorName: true, treatmentName: true, status: true, businessReply: true, repliedAt: true, createdAt: true, photos: true, photoConsent: true, bookingId: true,
      branch: { select: { id: true, name: true, cityName: true, businessId: true, regionSlug: true, slug: true, categories: { select: { categorySlug: true, isPrimary: true } } } },
    },
  });
}

export async function reviewCounts(): Promise<Record<ReviewFilter, number>> {
  const g = await db.review.groupBy({ by: ['status'], _count: true });
  const by = Object.fromEntries(g.map(x => [x.status, x._count])) as Partial<Record<ReviewStatus, number>>;
  const all = g.reduce((a, x) => a + x._count, 0);
  return { submitted: by.submitted ?? 0, published: by.published ?? 0, rejected: by.rejected ?? 0, removed: by.removed ?? 0, all };
}

export const REPORT_REASON: Record<string, string> = { complaint: 'תלונה', correction: 'תיקון פרטים', general: 'כללי', business: 'עסקים', access: 'עיון במידע', press: 'עיתונות' };

/** Reports about listings: complaints and corrections from /contact, newest first. */
export async function listReports(includeClosed: boolean) {
  return db.contactMessage.findMany({ where: { reason: { in: ['complaint', 'correction'] }, ...(includeClosed ? {} : { status: { not: 'closed' } }) }, orderBy: { createdAt: 'desc' }, take: 100 });
}

export async function decisionsFor(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.decision.findMany({ where: { subjectType: 'review', subjectId: { in: ids } }, orderBy: { createdAt: 'desc' } });
  const actorIds = [...new Set(rows.map(r => r.actorId).filter((x): x is string => !!x))];
  const users = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true, email: true } }) : [];
  return rows.map(r => ({ ...r, who: users.find(u => u.id === r.actorId)?.fullName ?? users.find(u => u.id === r.actorId)?.email ?? r.actorRole }));
}
