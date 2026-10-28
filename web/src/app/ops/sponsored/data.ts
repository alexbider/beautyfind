import 'server-only';
import type { Campaign, CampaignStatus, Prisma } from '@prisma/client';
import { db } from '@/lib/server/db';
import { pageTitle, reviewChecks, statTotals, type StatTotals } from '@/lib/server/sponsored';
import { pathOfPageKey, PLACEMENT_NAME } from '@/lib/sponsored';
import type { CheckResult } from '@/lib/sponsoredChecks';

// Sponsored placements for the admin: the review queue with the automatic checks a reviewer needs (content
// rules, the branch's medical responsible, free slots on the page, open debt), and every placement with its
// state, billing and results.

export const STATUS_NAME: Record<CampaignStatus, string> = { pending_review: 'לבדיקה', approved: 'אושר', rejected: 'נדחה', cancelled: 'הסתיים' };

export type Phase = 'review' | 'needs_card' | 'scheduled' | 'free_month' | 'live' | 'ending' | 'ended' | 'rejected';

export const PHASE: Record<Phase, { name: string; tone: 'warn' | 'ok' | 'bad' | 'neutral' }> = {
  review: { name: 'לבדיקה', tone: 'warn' },
  needs_card: { name: 'אושר · ממתין לכרטיס', tone: 'warn' },
  scheduled: { name: 'אושר · יעלה בקרוב', tone: 'ok' },
  free_month: { name: 'פעיל · חודש חינם', tone: 'ok' },
  live: { name: 'פעיל', tone: 'ok' },
  ending: { name: 'פעיל · לא יתחדש', tone: 'neutral' },
  ended: { name: 'הסתיים', tone: 'neutral' },
  rejected: { name: 'נדחה', tone: 'bad' },
};

export function phaseOf(c: Pick<Campaign, 'status' | 'endedAt' | 'activeUntil' | 'startsAt' | 'cancelAtPeriodEnd' | 'freeMonths' | 'stripeSubscriptionId' | 'paymentId'>, now = new Date()): Phase {
  if (c.status === 'pending_review') return 'review';
  if (c.status === 'rejected') return 'rejected';
  if (c.status === 'cancelled' || c.endedAt) return 'ended';
  if (!c.activeUntil) return c.stripeSubscriptionId ? 'scheduled' : 'needs_card';
  if (c.activeUntil <= now) return 'ended';
  if (c.startsAt > now) return 'scheduled';
  if (c.cancelAtPeriodEnd) return 'ending';
  if (c.freeMonths > 0 && !c.paymentId) return 'free_month';
  return 'live';
}

export interface CampaignView extends Campaign {
  branchName: string;
  page: string;
  path: string;
  placementName: string;
  phase: Phase;
  checks: CheckResult[];
  blocking: boolean;
  taken: number;
  slots: number;
  totals: StatTotals;
}

export type Filter = 'pending' | 'live' | 'all';

export async function listCampaigns(filter: Filter): Promise<CampaignView[]> {
  const now = new Date();
  const where: Prisma.CampaignWhereInput = filter === 'pending' ? { status: 'pending_review' } : filter === 'live' ? { status: 'approved', endedAt: null } : {};
  const rows = await db.campaign.findMany({ where, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 200 });
  const branchIds = [...new Set(rows.map(r => r.branchId))];
  const [branches, totals] = await Promise.all([
    branchIds.length ? db.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }) : [],
    statTotals(rows.map(r => r.id)),
  ]);
  const out: CampaignView[] = [];
  for (const c of rows) {
    const r = c.status === 'pending_review' ? await reviewChecks(c) : { checks: (Array.isArray(c.checks) ? c.checks : []) as unknown as CheckResult[], taken: 0, slots: 0 };
    out.push({
      ...c,
      branchName: branches.find(b => b.id === c.branchId)?.name ?? 'עסק',
      page: pageTitle(c), path: pathOfPageKey(c.pageKey), placementName: PLACEMENT_NAME[c.placement],
      phase: phaseOf(c, now),
      checks: r.checks, blocking: r.checks.some(x => x.result === 'bad'), taken: r.taken, slots: r.slots,
      totals: totals.get(c.id) ?? { impressions: 0, clicks: 0, contacts: 0 },
    });
  }
  return out;
}

/** Live branches, for the manual order form. */
export async function orderableBranches() {
  const rows = await db.branch.findMany({
    where: { status: 'live', business: { status: { in: ['live', 'past_due'] } } },
    select: { id: true, name: true, cityName: true, regionSlug: true, businessId: true, city: { select: { slug: true } }, categories: { select: { categorySlug: true, isPrimary: true } } },
    orderBy: { name: 'asc' },
    take: 3000,
  });
  return rows.map(b => ({ id: b.id, name: b.name, cityName: b.cityName, regionSlug: b.regionSlug, citySlug: b.city?.slug ?? null, categories: b.categories.sort((a, z) => Number(z.isPrimary) - Number(a.isPrimary)).map(c => c.categorySlug) }));
}

export async function counts() {
  const now = new Date();
  const [pending, live, needsCard] = await Promise.all([
    db.campaign.count({ where: { status: 'pending_review' } }),
    db.campaign.count({ where: { status: 'approved', endedAt: null, startsAt: { lte: now }, activeUntil: { gt: now } } }),
    db.campaign.count({ where: { status: 'approved', endedAt: null, activeUntil: null, stripeSubscriptionId: null } }),
  ]);
  return { pending, live, needsCard };
}
