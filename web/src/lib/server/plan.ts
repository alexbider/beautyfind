import 'server-only';
import { db } from './db';

// Which businesses are on a paid plan, for features that come with the subscription (consultation replies by
// email, the day-before reminder email). Paid = a subscription that is active, or past due while its charge is
// being retried (still a paying customer until it is hidden or cancelled).

export async function isPaidBusiness(businessId: string): Promise<boolean> {
  const s = await db.subscription.findUnique({ where: { businessId }, select: { status: true } });
  return s?.status === 'active' || s?.status === 'past_due';
}

/** The paid businesses among these ids. */
export async function paidBusinessIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.subscription.findMany({ where: { businessId: { in: ids }, status: { in: ['active', 'past_due'] } }, select: { businessId: true } });
  return new Set(rows.map(r => r.businessId));
}

/** Where email for a branch goes: the branch's own address, else the business owner's. */
export async function clinicEmail(branchId: string): Promise<string | null> {
  const b = await db.branch.findUnique({ where: { id: branchId }, select: { email: true, business: { select: { owner: { select: { email: true } } } } } });
  return b?.email?.trim() || b?.business.owner?.email || null;
}
