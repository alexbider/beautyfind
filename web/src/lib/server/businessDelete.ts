import 'server-only';
import type { BusinessStatus, User } from '@prisma/client';
import { profileHref } from '../category';
import { db } from './db';

// Deleting and restoring a business from the admin. Only the master admin (the ops role, "מנהל־על")
// may do either, checked here on every call whatever screen or tool called it. Delete is soft: the
// business gets deleted_at and the hidden status, so it leaves every public page, the sitemap and
// search (PUBLIC_WHERE), and its profile URLs answer 404. Nothing under it is removed: branches,
// bookings, reviews, payments, invoices and the subscription row all stay, so a restore is exact and
// billing history is never touched. A delete is refused while money is still moving: an active or
// past-due subscription, a sponsored placement that runs or waits for approval, or an open marketing
// order. Every delete and restore writes an audit row with the actor and a reason.

type Actor = Pick<User, 'id' | 'opsRole'> | null | undefined;

/** The master admin: the ops staff role. Fixed in code, not taken from the editable role permissions. */
export const isMasterAdmin = (u: Actor): boolean => u?.opsRole === 'ops';

export const MIN_REASON = 5;

/** Subscription states that still bill (or are trying to): the delete waits until it is cancelled. */
const LIVE_SUBSCRIPTION = new Set(['active', 'past_due']);
/** Marketing orders still in progress. completed and cancelled are closed. */
const CLOSED_ORDER = new Set(['completed', 'cancelled']);

export interface BlockerInput {
  subscription: { status: string } | null;
  campaigns: Array<{ ref: string; status: string; endedAt: Date | null }>;
  marketingOrders: Array<{ ref?: string | null; status: string }>;
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
  return out;
}

/** What the delete dialog needs to know about a business. */
export async function deleteCheck(businessId: string): Promise<{ blockers: string[]; paths: string[] } | null> {
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      subscription: { select: { status: true } },
      branches: { select: { slug: true, regionSlug: true, categories: { select: { categorySlug: true, isPrimary: true } } } },
    },
  });
  if (!b) return null;
  const [campaigns, marketingOrders] = await Promise.all([
    db.campaign.findMany({ where: { businessId }, select: { ref: true, status: true, endedAt: true } }),
    db.marketingOrder.findMany({ where: { businessId }, select: { ref: true, status: true } }),
  ]);
  return { blockers: deleteBlockers({ subscription: b.subscription, campaigns, marketingOrders }), paths: b.branches.map(br => profileHref(br)) };
}

export type DeleteResult =
  | { ok: true; status: 200; paths: string[]; regions: string[] }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string; blockers?: string[] };

const FORBIDDEN = { ok: false, status: 403, error: 'אין הרשאה. מחיקה ושחזור של עסק שמורים למנהל־על.' } as const;

function cleanReason(reason: unknown): string | null {
  const r = typeof reason === 'string' ? reason.trim() : '';
  return r.length >= MIN_REASON && r.length <= 500 ? r : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Soft-deletes a business. `confirmName` must equal the business's display name exactly (the dialog
 * asks the admin to type it). Returns the public paths that changed, for the caller to refresh.
 */
export async function deleteBusiness(actor: Actor, input: { id: string; reason: string; confirmName: string }): Promise<DeleteResult> {
  if (!isMasterAdmin(actor)) return FORBIDDEN;
  const reason = cleanReason(input.reason);
  if (!reason) return { ok: false, status: 400, error: `צריך לכתוב סיבה של ${MIN_REASON} תווים לפחות.` };
  if (!UUID.test(String(input.id))) return { ok: false, status: 404, error: 'העסק לא נמצא' };
  const b = await db.business.findUnique({ where: { id: input.id }, select: { id: true, status: true, legalName: true, deletedAt: true, branches: { select: { name: true, slug: true, regionSlug: true, categories: { select: { categorySlug: true, isPrimary: true } } }, orderBy: { createdAt: 'asc' } } } });
  if (!b) return { ok: false, status: 404, error: 'העסק לא נמצא' };
  if (b.deletedAt) return { ok: false, status: 409, error: 'העסק כבר נמחק.' };
  if (input.confirmName !== displayName(b)) return { ok: false, status: 400, error: 'השם שהוקלד לא תואם לשם העסק.' };
  const check = await deleteCheck(b.id);
  if (check?.blockers.length) return { ok: false, status: 409, error: 'אי אפשר למחוק את העסק כרגע.', blockers: check.blockers };
  const now = new Date();
  const paths = b.branches.map(br => profileHref(br));
  await db.$transaction([
    db.business.update({ where: { id: b.id }, data: { status: 'hidden', deletedAt: now, deletedById: actor!.id, deletedFromStatus: b.status, deletedReason: reason } }),
    db.decision.create({ data: { actorId: actor!.id, actorRole: 'ops', subjectType: 'business', subjectId: b.id, action: 'business_delete', reason } }),
    db.auditLog.create({ data: { actorId: actor!.id, action: 'business_delete', subjectType: 'business', subjectId: b.id, businessId: b.id, createdAt: now, meta: { reason, fromStatus: b.status, name: displayName(b), paths } } }),
  ]);
  return { ok: true, status: 200, paths, regions: [...new Set(b.branches.map(br => br.regionSlug))] };
}

/** Restores a soft-deleted business to the status it had before the delete. */
export async function restoreBusiness(actor: Actor, input: { id: string; reason: string }): Promise<DeleteResult> {
  if (!isMasterAdmin(actor)) return FORBIDDEN;
  const reason = cleanReason(input.reason);
  if (!reason) return { ok: false, status: 400, error: `צריך לכתוב סיבה של ${MIN_REASON} תווים לפחות.` };
  if (!UUID.test(String(input.id))) return { ok: false, status: 404, error: 'העסק לא נמצא' };
  const b = await db.business.findUnique({ where: { id: input.id }, select: { id: true, status: true, deletedAt: true, deletedFromStatus: true, branches: { select: { slug: true, regionSlug: true, categories: { select: { categorySlug: true, isPrimary: true } } } } } });
  if (!b) return { ok: false, status: 404, error: 'העסק לא נמצא' };
  if (!b.deletedAt) return { ok: false, status: 409, error: 'העסק לא מחוק.' };
  const to: BusinessStatus = b.deletedFromStatus ?? 'hidden';
  const now = new Date();
  const paths = b.branches.map(br => profileHref(br));
  await db.$transaction([
    db.business.update({ where: { id: b.id }, data: { status: to, deletedAt: null, deletedById: null, deletedFromStatus: null, deletedReason: null } }),
    db.decision.create({ data: { actorId: actor!.id, actorRole: 'ops', subjectType: 'business', subjectId: b.id, action: 'business_restore', reason } }),
    db.auditLog.create({ data: { actorId: actor!.id, action: 'business_restore', subjectType: 'business', subjectId: b.id, businessId: b.id, createdAt: now, meta: { reason, toStatus: to, deletedAt: b.deletedAt.toISOString(), paths } } }),
  ]);
  return { ok: true, status: 200, paths, regions: [...new Set(b.branches.map(br => br.regionSlug))] };
}

/** The name the admin types to confirm: the first branch's name, else the legal name (as on the business card). */
export function displayName(b: { legalName: string | null; branches: Array<{ name: string }> }): string {
  return b.branches[0]?.name ?? b.legalName ?? 'עסק ללא שם';
}
