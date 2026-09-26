import 'server-only';
import { toE164 } from '@/lib/format';
import { eligiblePractitioners } from '@/lib/server/availability';
import { isAdvanced } from '@/lib/server/clinic';
import { hmac } from '@/lib/server/crypto';
import { db } from '@/lib/server/db';
import { PUBLIC_WHERE } from '@/lib/server/public';
import { SPANS, isSpan, isTimeRange, type SpanKey, type TimeRange } from '@/components/waitlist/shared';

// Waitlist entries (03-states.md "Waitlist"):
// active → offered → booked · offered → active (pass / expired) · active → expired (duration end) · active → left.
// One active entry per phone + treatment + branch: joining again updates it and keeps its place.

const OPEN: ('active' | 'offered')[] = ['active', 'offered'];

/* ---------- Signed entry id (the leave link) ---------- */

export function entryToken(entryId: string) {
  return `${entryId.replace(/-/g, '')}.${hmac('waitlist-entry:' + entryId).slice(0, 32)}`;
}

export function entryIdFromToken(token: string): string | null {
  const m = /^([0-9a-f]{32})\.([0-9a-f]{32})$/.exec(token);
  if (!m) return null;
  const h = m[1];
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return hmac('waitlist-entry:' + id).slice(0, 32) === m[2] ? id : null;
}

/* ---------- Settings ---------- */

export function holdFromSettings(settings: unknown): number {
  const v = Number((settings as Record<string, unknown> | null)?.waitlist_hold_minutes);
  return Number.isFinite(v) && v >= 5 ? Math.round(v) : 30;
}

/* ---------- Housekeeping ---------- */

/** Entries whose duration ended leave the queue. Cheap; call before reading a queue. */
export async function sweepEntries(branchId?: string) {
  await db.waitlistEntry.updateMany({
    where: { status: 'active', expiresAt: { lte: new Date() }, ...(branchId ? { branchId } : {}) },
    data: { status: 'expired' },
  });
}

/** 1-based place in the queue for this treatment at this branch (join order). */
export async function queuePosition(e: { id: string; branchId: string; treatmentId: string; createdAt: Date }) {
  const ahead = await db.waitlistEntry.count({
    where: { branchId: e.branchId, treatmentId: e.treatmentId, status: { in: OPEN }, expiresAt: { gt: new Date() }, createdAt: { lt: e.createdAt }, id: { not: e.id } },
  });
  return ahead + 1;
}

/* ---------- Join page ---------- */

export type JoinTreatment = { id: string; name: string; price: string; practitioners: { id: string; name: string }[] };

export async function loadJoinPage(slug: string) {
  const branch = await db.branch.findFirst({
    where: { AND: [PUBLIC_WHERE, { slug }] },
    select: {
      id: true, name: true, slug: true, cityName: true, regionSlug: true, phone: true, whatsapp: true, businessId: true,
      business: { select: { settings: true } },
      treatments: {
        where: { isPublished: true, isMedical: false, onlineBookable: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, priceAgorot: true, priceType: true, practitionerIds: true },
      },
    },
  });
  if (!branch) return null;
  const advanced = await isAdvanced(branch.businessId);
  // Non-medical treatments: the same eligible staff as the booking engine, narrowed per treatment.
  const staff = advanced ? await eligiblePractitioners(branch.id, { practitionerIds: [], isMedical: false }) : [];
  const treatments: JoinTreatment[] = branch.treatments.map(t => ({
    id: t.id,
    name: t.name,
    price: t.priceAgorot == null ? 'המחיר לא פורסם' : priceText(t.priceAgorot, t.priceType),
    practitioners: staff.filter(s => !t.practitionerIds.length || t.practitionerIds.includes(s.id)).map(s => ({ id: s.id, name: s.displayName })),
  }));
  return { branch, advanced, holdMinutes: holdFromSettings(branch.business.settings), treatments };
}

function priceText(agorot: number, type: string) {
  const n = '₪' + Math.round(agorot / 100).toLocaleString('en-US');
  return type === 'fixed' ? n : `החל מ־${n}`;
}

/* ---------- Join ---------- */

export type JoinInput = {
  branchId: string;
  treatmentId: string;
  days: number[];
  timeRanges: string[];
  span: string;
  practitionerId: string | null;
  name: string;
  phone: string;
};

export type JoinError = 'invalid' | 'prefs' | 'name' | 'phone' | 'not_found' | 'plan';
export type JoinResult =
  | { ok: true; entryId: string; token: string; position: number; expiresAt: Date; updated: boolean }
  | { ok: false; error: JoinError };

export const nameOk = (v: string) => v.trim().length >= 2 && v.trim().length <= 80;

export async function joinWaitlist(input: JoinInput, userId: string | null): Promise<JoinResult> {
  const days = [...new Set(input.days)].filter(d => Number.isInteger(d) && d >= 0 && d <= 5).sort((a, b) => a - b);
  const ranges = [...new Set(input.timeRanges)].filter(isTimeRange) as TimeRange[];
  if (!days.length || !ranges.length) return { ok: false, error: 'prefs' };
  if (!isSpan(input.span)) return { ok: false, error: 'invalid' };
  if (!nameOk(input.name)) return { ok: false, error: 'name' };
  const phone = toE164(input.phone);
  if (!phone) return { ok: false, error: 'phone' };

  const t = await db.treatment.findFirst({
    where: { id: input.treatmentId, branchId: input.branchId, isPublished: true, isMedical: false, onlineBookable: true, branch: PUBLIC_WHERE },
    select: { id: true, practitionerIds: true, branch: { select: { businessId: true } } },
  });
  if (!t) return { ok: false, error: 'not_found' };
  if (!(await isAdvanced(t.branch.businessId))) return { ok: false, error: 'plan' };
  if (input.practitionerId) {
    const staff = await eligiblePractitioners(input.branchId, { practitionerIds: t.practitionerIds, isMedical: false });
    if (!staff.some(s => s.id === input.practitionerId)) return { ok: false, error: 'invalid' };
  }

  const span = SPANS.find(s => s.key === (input.span as SpanKey))!;
  const expiresAt = new Date(Date.now() + span.days * 86_400_000);
  const data = { days, timeRanges: ranges, practitionerId: input.practitionerId, clientName: input.name.trim(), expiresAt };

  await sweepEntries(input.branchId);
  // Serialise joins per phone + treatment so a double submit can't create two entries.
  const { entry, updated } = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'wl:' + phone + ':' + t.id}))`;
    const existing = await tx.waitlistEntry.findFirst({
      where: { branchId: input.branchId, treatmentId: t.id, clientPhone: phone, status: { in: OPEN } },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) {
      const e = await tx.waitlistEntry.update({ where: { id: existing.id }, data: { ...data, clientUserId: existing.clientUserId ?? userId } });
      return { entry: e, updated: true };
    }
    const e = await tx.waitlistEntry.create({
      data: { ...data, branchId: input.branchId, treatmentId: t.id, clientPhone: phone, clientUserId: userId, status: 'active' },
    });
    return { entry: e, updated: false };
  });

  return { ok: true, entryId: entry.id, token: entryToken(entry.id), position: await queuePosition(entry), expiresAt: entry.expiresAt, updated };
}

/* ---------- Leave ---------- */

export async function loadEntryForLeave(token: string) {
  const id = entryIdFromToken(token);
  if (!id) return null;
  const e = await db.waitlistEntry.findUnique({
    where: { id },
    select: { id: true, status: true, clientName: true, treatmentId: true, branch: { select: { name: true, cityName: true, slug: true } } },
  });
  if (!e) return null;
  const t = await db.treatment.findUnique({ where: { id: e.treatmentId }, select: { name: true } });
  return { ...e, treatmentName: t?.name ?? null };
}

/**
 * Leaves the list. An open offer held for this person is released and moves on to the next match.
 * Idempotent: leaving twice is fine.
 */
export async function leaveWaitlist(token: string): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'closed' }> {
  const id = entryIdFromToken(token);
  if (!id) return { ok: false, error: 'not_found' };
  const e = await db.waitlistEntry.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!e) return { ok: false, error: 'not_found' };
  if (e.status === 'left') return { ok: true };
  if (e.status === 'booked') return { ok: false, error: 'closed' };
  await db.waitlistEntry.update({ where: { id }, data: { status: 'left' } });
  const open = await db.waitlistOffer.findMany({ where: { entryId: id, status: 'sent' } });
  if (open.length) {
    const { releaseOffer } = await import('../w/offers');
    for (const o of open) await releaseOffer(o.id, 'passed');
  }
  return { ok: true };
}
