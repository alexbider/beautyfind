import 'server-only';
import type { User } from '@prisma/client';
import { profileHref } from '../category';
import { storage } from '../vendors/storage';
import { db } from './db';

// Permanent delete of a business from the admin. Only the master admin (the ops role, "מנהל־על") may
// do it, checked here on every call whatever screen or tool called it. It cannot be undone.
//
// What goes: the business, its branches (profiles, treatments, reviews, photos, hours), staff, invites,
// the subscription row, bookings, consultation requests, the waitlist, leads, uploaded files, the
// license verification requests, scheduled messages and used-up gift cards.
// What stays: money and legal records. Payments, invoices and receipts, refunds, disputes, ended
// sponsored campaigns and closed marketing orders keep their rows (with the business id, which no
// longer resolves). The audit log and the decision log keep a snapshot of what was deleted.
// The Google import record is marked rejected so the next import does not create the business again.
//
// Refused while money or clients are still in play: a live subscription, a running or pending sponsored
// placement, an open marketing order, gift cards with value left, or upcoming bookings.

type Actor = Pick<User, 'id' | 'opsRole'> | null | undefined;

/** The master admin: the ops staff role. Fixed in code, not taken from the editable role permissions. */
export const isMasterAdmin = (u: Actor): boolean => u?.opsRole === 'ops';

export const MIN_REASON = 5;

const LIVE_SUBSCRIPTION = new Set(['active', 'past_due']);
const CLOSED_ORDER = new Set(['completed', 'cancelled']);
const SPENT_GIFT = new Set(['redeemed', 'refunded', 'expired']);
const UPCOMING_BOOKING = ['pending_payment', 'confirmed', 'checked_in', 'in_treatment'] as const;

export interface BlockerInput {
  subscription: { status: string } | null;
  campaigns: Array<{ ref: string; status: string; endedAt: Date | null }>;
  marketingOrders: Array<{ ref?: string | null; status: string }>;
  giftCards?: Array<{ status: string }>;
  upcomingBookings?: number;
}

/** Why a business cannot be deleted right now, in Hebrew for the dialog. Empty means it can. */
export function deleteBlockers(x: BlockerInput): string[] {
  const out: string[] = [];
  if (x.subscription && LIVE_SUBSCRIPTION.has(x.subscription.status)) {
    out.push(x.subscription.status === 'past_due' ? 'יש מנוי בחוב פתוח. צריך לבטל את המנוי בהנהלת החשבונות לפני מחיקה.' : 'יש מנוי פעיל. צריך לבטל את המנוי בהנהלת החשבונות לפני מחיקה.');
  }
  const ads = x.campaigns.filter(c => !c.endedAt && (c.status === 'approved' || c.status === 'pending_review'));
  if (ads.length) out.push(`יש מקום ממומן פעיל או ממתין לאישור (${ads.map(c => c.ref).join(', ')}). צריך לסיים אותו לפני מחיקה.`);
  const orders = x.marketingOrders.filter(o => !CLOSED_ORDER.has(o.status));
  if (orders.length) out.push(`יש הזמנת שירותי שיווק פתוחה (${orders.map(o => o.ref || o.status).join(', ')}). צריך לסגור או לבטל אותה לפני מחיקה.`);
  const gifts = (x.giftCards ?? []).filter(g => !SPENT_GIFT.has(g.status));
  if (gifts.length) out.push(`יש ${gifts.length === 1 ? 'שובר מתנה אחד' : `${gifts.length} שוברי מתנה`} שעוד לא מומשו. צריך לממש או להחזיר אותם לפני מחיקה.`);
  if (x.upcomingBookings) out.push(`יש ${x.upcomingBookings === 1 ? 'תור עתידי אחד' : `${x.upcomingBookings} תורים עתידיים`}. צריך לבטל אותם וליידע את הלקוחות לפני מחיקה.`);
  return out;
}

/** What the delete dialog needs to know about a business. */
export async function deleteCheck(businessId: string): Promise<{ blockers: string[] } | null> {
  const b = await db.business.findUnique({ where: { id: businessId }, select: { id: true, subscription: { select: { status: true } }, giftCards: { select: { status: true } } } });
  if (!b) return null;
  const [campaigns, marketingOrders, upcomingBookings] = await Promise.all([
    db.campaign.findMany({ where: { businessId }, select: { ref: true, status: true, endedAt: true } }),
    db.marketingOrder.findMany({ where: { businessId }, select: { ref: true, status: true } }),
    db.booking.count({ where: { branch: { businessId }, status: { in: [...UPCOMING_BOOKING] }, startsAt: { gte: new Date() } } }),
  ]);
  return { blockers: deleteBlockers({ subscription: b.subscription, campaigns, marketingOrders, giftCards: b.giftCards, upcomingBookings }) };
}

export type DeleteResult =
  | { ok: true; status: 200; paths: string[]; regions: string[] }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string; blockers?: string[] };

const FORBIDDEN = { ok: false, status: 403, error: 'אין הרשאה. מחיקת עסק שמורה למנהל־על.' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The name the admin types to confirm: the first branch's name, else the legal name (as on the business card). */
export function displayName(b: { legalName: string | null; branches: Array<{ name: string }> }): string {
  return b.branches[0]?.name ?? b.legalName ?? 'עסק ללא שם';
}

/**
 * Deletes a business permanently. `confirmName` must equal the business's display name exactly (the
 * dialog asks the admin to type it). Returns the public paths that changed, for the caller to refresh.
 */
export async function deleteBusiness(actor: Actor, input: { id: string; reason: string; confirmName: string }): Promise<DeleteResult> {
  if (!isMasterAdmin(actor)) return FORBIDDEN;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < MIN_REASON || reason.length > 500) return { ok: false, status: 400, error: `צריך לכתוב סיבה של ${MIN_REASON} תווים לפחות.` };
  if (!UUID.test(String(input.id))) return { ok: false, status: 404, error: 'העסק לא נמצא' };
  const b = await db.business.findUnique({
    where: { id: input.id },
    include: {
      owner: { select: { id: true, email: true } },
      subscription: true,
      branches: { select: { id: true, name: true, slug: true, regionSlug: true, cityName: true, categories: { select: { categorySlug: true, isPrimary: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!b) return { ok: false, status: 404, error: 'העסק לא נמצא' };
  const name = displayName(b);
  if (input.confirmName !== name) return { ok: false, status: 400, error: 'השם שהוקלד לא תואם לשם העסק.' };
  const check = await deleteCheck(b.id);
  if (check?.blockers.length) return { ok: false, status: 409, error: 'אי אפשר למחוק את העסק כרגע.', blockers: check.blockers };

  const branchIds = b.branches.map(x => x.id);
  const paths = b.branches.map(x => profileHref(x));
  const media = await db.mediaFile.findMany({ where: { businessId: b.id }, select: { key: true } });
  const s = b.subscription;
  const snapshot = {
    reason, name, legalName: b.legalName, companyNo: b.companyNo, type: b.type, status: b.status, chainKey: b.chainKey, createdAt: b.createdAt.toISOString(),
    owner: b.owner ? { id: b.owner.id, email: b.owner.email } : null,
    branches: b.branches.map(x => ({ id: x.id, name: x.name, city: x.cityName, path: profileHref(x) })),
    subscription: s ? { plan: s.plan, status: s.status, cycle: s.cycle, pricePerBranchAgorot: s.pricePerBranchAgorot, stripeCustomerId: s.stripeCustomerId, stripeSubscriptionId: s.stripeSubscriptionId } : null,
    mediaFiles: media.length,
  };

  await db.$transaction(async tx => {
    // The record of the delete first: neither table has a foreign key to the business, so both survive it.
    await tx.decision.create({ data: { actorId: actor!.id, actorRole: 'ops', subjectType: 'business', subjectId: b.id, action: 'business_delete', reason } });
    await tx.auditLog.create({ data: { actorId: actor!.id, action: 'business_delete', subjectType: 'business', subjectId: b.id, businessId: b.id, meta: snapshot } });
    // Rows the database would refuse to cascade (RESTRICT), children first.
    await tx.waitlistEntry.deleteMany({ where: { branchId: { in: branchIds } } });
    await tx.consultRequest.deleteMany({ where: { branchId: { in: branchIds } } });
    await tx.booking.deleteMany({ where: { branchId: { in: branchIds } } }); // payments keep their row, booking link set to null
    const gifts = await tx.giftCard.findMany({ where: { businessId: b.id }, select: { id: true } });
    await tx.giftRedemption.deleteMany({ where: { giftCardId: { in: gifts.map(g => g.id) } } });
    await tx.giftCard.deleteMany({ where: { businessId: b.id } });
    // Business data kept by id only (no foreign key).
    await tx.lead.deleteMany({ where: { businessId: b.id } });
    await tx.verificationRequest.deleteMany({ where: { businessId: b.id } });
    await tx.scheduledMessage.deleteMany({ where: { businessId: b.id } });
    await tx.mediaFile.deleteMany({ where: { businessId: b.id } });
    await tx.fieldObservation.deleteMany({ where: { branchId: { in: branchIds } } });
    await tx.importPlace.updateMany({ where: { branchId: { in: branchIds } }, data: { status: 'rejected', branchId: null, note: 'העסק נמחק מהניהול' } });
    // The business itself: branches, treatments, reviews, staff, invites, the subscription and the rest cascade.
    await tx.business.delete({ where: { id: b.id } });
  }, { timeout: 60_000 });

  // Stored files after the rows are gone; a file that fails to delete is only an orphan, never shown.
  await Promise.all(media.map(m => storage().del(m.key).catch(() => undefined)));
  return { ok: true, status: 200, paths, regions: [...new Set(b.branches.map(x => x.regionSlug))] };
}
