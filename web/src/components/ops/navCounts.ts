import 'server-only';
import { db } from '@/lib/server/db';
import type { Area } from './roles';

export type NavCount = { count: number; tone?: 'bad' | 'warn' | 'ok' };

// The numbers on the sidebar: what is waiting for a person in each area. Cheap counts only; a page
// that fails to count (a table that does not exist yet on an old database) shows no number.

const safe = (p: Promise<number>) => p.catch(() => 0);

export async function navCounts(): Promise<Partial<Record<Area, NavCount>>> {
  const now = new Date();
  const [
    pendingBusinesses, privacy, openDisputes, sponsoredReview, reviews, verification, importReview, pastDue, aiProposed, integrationErrors,
  ] = await Promise.all([
    safe(db.business.count({ where: { status: 'pending' } })),
    safe(db.decision.count({ where: { subjectType: 'user', action: 'delete_request' } }).then(async n => {
      const done = await db.decision.count({ where: { subjectType: 'user', action: { in: ['delete_done', 'delete_rejected'] } } });
      const messages = await db.contactMessage.count({ where: { reason: { in: ['access', 'correction'] }, status: { not: 'closed' } } });
      return Math.max(0, n - done) + messages;
    })),
    safe(db.dispute.count({ where: { status: 'open' } })),
    safe(db.campaign.count({ where: { status: 'pending_review' } })),
    safe(db.review.count({ where: { status: 'submitted' } })),
    safe(db.verificationRequest.count({ where: { status: { in: ['open', 'awaiting_document'] } } })),
    safe(db.importPlace.count({ where: { status: { in: ['ready', 'needs_review'] } } })),
    safe(db.subscription.count({ where: { status: 'past_due' } })),
    safe(db.aiAction.count({ where: { status: 'proposed' } })),
    safe(db.providerConnection.count({ where: { status: 'error', updatedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } } })),
  ]);
  const out: Partial<Record<Area, NavCount>> = {};
  if (pendingBusinesses) out.businesses = { count: pendingBusinesses, tone: 'warn' };
  if (privacy) out.clients = { count: privacy, tone: 'warn' };
  if (openDisputes) out.disputes = { count: openDisputes, tone: 'bad' };
  if (sponsoredReview) out.sponsored = { count: sponsoredReview, tone: 'warn' };
  if (reviews) out.moderation = { count: reviews, tone: 'warn' };
  if (verification) out.verification = { count: verification, tone: 'warn' };
  if (importReview) out.import = { count: importReview, tone: 'warn' };
  if (pastDue) out.accounting = { count: pastDue, tone: 'bad' };
  if (aiProposed) out.ai = { count: aiProposed, tone: 'warn' };
  if (integrationErrors) out.integrations = { count: integrationErrors, tone: 'bad' };
  return out;
}
