import 'server-only';
import type { Plan, SubscriptionStatus } from '@prisma/client';
import type { Area } from '../permissions';
import { db } from './db';

// Who may write in the business backend. A business can change data only while its subscription is paid:
// `active`, or `past_due` while Stripe retries a failed renewal. A subscription that was never paid
// (`incomplete`), hidden for debt or cancelled, or a business with no subscription at all, can only look at
// the dashboard and its plans, and pay. Billing itself (plan, card, checkout) always stays open.
// Plans: basic (149 ILS) runs the listing; advanced (249 ILS) adds the CRM, the clinic system and payments.

export const WRITABLE_STATUSES: readonly SubscriptionStatus[] = ['active', 'past_due'];

export type Sub = { plan: Plan; status: SubscriptionStatus } | null | undefined;

export const canWrite = (sub: Sub) => !!sub && WRITABLE_STATUSES.includes(sub.status);
export const hasAdvanced = (sub: Sub) => canWrite(sub) && sub!.plan === 'advanced';

/** Why a write is refused, in Hebrew for the owner; null when it is allowed. */
export function writeBlockReason(sub: Sub, need: 'any' | 'advanced' = 'any'): string | null {
  if (!canWrite(sub)) return 'המנוי עדיין לא פעיל. כדי לערוך, השלימו את התשלום בעמוד החיוב.';
  if (need === 'advanced' && sub!.plan !== 'advanced') return 'האפשרות הזו זמינה במסלול המתקדם.';
  return null;
}

/** Dashboard areas that belong to the advanced plan (249 ILS): the CRM. */
export const ADVANCED_AREAS: ReadonlySet<Area> = new Set<Area>(['leads']);

/** Why an edit in a dashboard area is refused. Billing never is: it is how an owner pays. */
export function areaWriteBlock(area: Area, sub: Sub): string | null {
  if (area === 'billing') return null;
  return writeBlockReason(sub, ADVANCED_AREAS.has(area) ? 'advanced' : 'any');
}

export class WriteBlockedError extends Error {
  constructor(readonly reason: string) { super(`forbidden: ${reason}`); }
}

export async function subscriptionOf(businessId: string): Promise<Sub> {
  return db.subscription.findUnique({ where: { businessId }, select: { plan: true, status: true } });
}

/** Throws WriteBlockedError unless the business may write (and, with `advanced`, is on the advanced plan). */
export async function assertWritable(businessId: string, need: 'any' | 'advanced' = 'any'): Promise<void> {
  const reason = writeBlockReason(await subscriptionOf(businessId), need);
  if (reason) throw new WriteBlockedError(reason);
}

/**
 * For actions a signed-in user can take outside the dashboard (marketing orders): blocked when the user owns or
 * works at a business whose subscription is not paid. People with no business are not affected.
 */
export async function userWriteBlock(userId: string): Promise<string | null> {
  const members = await db.staffMember.findMany({ where: { userId, status: 'active' }, select: { business: { select: { subscription: { select: { plan: true, status: true } } } } } });
  if (!members.length) return null;
  return members.some(m => canWrite(m.business.subscription)) ? null : writeBlockReason(null);
}
