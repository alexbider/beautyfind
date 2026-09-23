import 'server-only';
import { hhmm, ilDate, ilParts } from '@/lib/time';
import { messaging } from '@/lib/vendors/messaging';
import { eligiblePractitioners, isSlotFree } from '@/lib/server/availability';
import { bookingToken, createBooking } from '@/lib/server/booking';
import { randomToken, sha256 } from '@/lib/server/crypto';
import { db } from '@/lib/server/db';
import { siteUrl } from '@/lib/server/site';
import { entryMatches } from '@/components/waitlist/shared';
import { entryToken, holdFromSettings, sweepEntries } from '../waitlist/entries';

// Waitlist offers (03-states.md): sent → accepted | passed | expired. Offers go in join order to the
// first entry matching day, time range and practitioner; one open offer per slot at a time.
//
// The first offer for a freed slot comes from lib/server/waitlist.ts (cancel / reschedule). When an
// offer is passed, expires, or the clinic offers a slot by hand, `offerSlotToNext` below picks the
// next match. It mirrors offerFreedSlot but skips everyone who already had an offer for this slot
// (otherwise the person who just passed would be first in line again) and re-checks that the slot
// is still free.

export type SlotRef = { branchId: string; treatmentId: string; practitionerId: string | null; startsAt: Date };

async function slotStillFree(slot: SlotRef) {
  const t = await db.treatment.findUnique({ where: { id: slot.treatmentId }, select: { durationMin: true, practitionerIds: true, isMedical: true } });
  if (!t) return false;
  const durationMin = t.durationMin ?? 60;
  const ids = slot.practitionerId ? [slot.practitionerId] : (await eligiblePractitioners(slot.branchId, t)).map(p => p.id);
  for (const id of ids) {
    if (await isSlotFree({ branchId: slot.branchId, practitionerId: id, startsAt: slot.startsAt, durationMin })) return true;
  }
  return false;
}

/** Offers a free slot to the first matching entry that hasn't had it yet. Returns the offer id, or null. */
export async function offerSlotToNext(slot: SlotRef): Promise<string | null> {
  if (slot.startsAt.getTime() <= Date.now()) return null;
  const p = ilParts(slot.startsAt);
  if (p.dow > 5) return null;
  await sweepEntries(slot.branchId);
  if (!(await slotStillFree(slot))) return null;

  const branch = await db.branch.findUnique({ where: { id: slot.branchId }, select: { business: { select: { settings: true } } } });
  const hold = holdFromSettings(branch?.business.settings);
  const token = randomToken(24);

  const made = await db.$transaction(async tx => {
    // One open offer per slot: serialise on the slot, then check inside the lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'wl-slot:' + slot.branchId + ':' + slot.startsAt.toISOString()}))`;
    const open = await tx.waitlistOffer.findFirst({
      where: { slotStartsAt: slot.startsAt, status: 'sent', holdUntil: { gt: new Date() }, entry: { branchId: slot.branchId } },
    });
    if (open) return null;
    const entries = await tx.waitlistEntry.findMany({
      where: {
        branchId: slot.branchId, treatmentId: slot.treatmentId, status: 'active', expiresAt: { gt: new Date() }, days: { has: p.dow },
        offers: { none: { slotStartsAt: slot.startsAt } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const match = entries.find(e => entryMatches(e, { dow: p.dow, hh: p.hh, practitionerId: slot.practitionerId }));
    if (!match) return null;
    const offer = await tx.waitlistOffer.create({
      data: { entryId: match.id, slotStartsAt: slot.startsAt, practitionerId: slot.practitionerId, tokenHash: sha256(token), holdUntil: new Date(Date.now() + hold * 60_000) },
    });
    await tx.waitlistEntry.update({ where: { id: match.id }, data: { status: 'offered' } });
    return { offer, match };
  });
  if (!made) return null;

  await messaging().send({
    channel: 'whatsapp', to: made.match.clientPhone, template: 'M7_waitlist_offer',
    vars: { name: made.match.clientName, date: ilDate(slot.startsAt), time: hhmm(slot.startsAt), minutes: String(hold), link: `${siteUrl()}/w/${token}` },
    kind: 'service',
  });
  return made.offer.id;
}

/**
 * Closes an open offer as passed or expired: the entry goes back to active (keeping its place) and the
 * slot moves on to the next match. Only the call that actually moves the offer out of `sent` does this.
 */
export async function releaseOffer(offerId: string, as: 'passed' | 'expired') {
  const moved = await db.waitlistOffer.updateMany({
    where: { id: offerId, status: 'sent', ...(as === 'expired' ? { holdUntil: { lte: new Date() } } : {}) },
    data: { status: as },
  });
  if (!moved.count) return false;
  const o = await db.waitlistOffer.findUnique({ where: { id: offerId }, include: { entry: true } });
  if (!o) return true;
  await db.waitlistEntry.updateMany({ where: { id: o.entryId, status: 'offered' }, data: { status: 'active' } });
  await offerSlotToNext({ branchId: o.entry.branchId, treatmentId: o.entry.treatmentId, practitionerId: o.practitionerId, startsAt: o.slotStartsAt }).catch(e =>
    console.error('[waitlist] re-offer failed', e),
  );
  return true;
}

/** Expires every offer whose hold has passed (optionally for one branch). There is no scheduler yet, so pages call this. */
export async function sweepOffers(branchId?: string) {
  const due = await db.waitlistOffer.findMany({
    where: { status: 'sent', holdUntil: { lte: new Date() }, ...(branchId ? { entry: { branchId } } : {}) },
    select: { id: true },
    orderBy: { holdUntil: 'asc' },
    take: 50,
  });
  for (const o of due) await releaseOffer(o.id, 'expired');
}

/* ---------- Offer page ---------- */

export type OfferState = 'open' | 'accepted' | 'passed' | 'expired';

const byToken = (token: string) => db.waitlistOffer.findUnique({ where: { tokenHash: sha256(token) }, include: { entry: true } });

export async function loadOffer(token: string) {
  let o = await byToken(token);
  if (!o) return null;
  if (o.status === 'sent' && o.holdUntil.getTime() <= Date.now()) {
    await releaseOffer(o.id, 'expired');
    o = (await byToken(token))!;
  }
  const [treatment, practitioner, branch] = await Promise.all([
    db.treatment.findUnique({ where: { id: o.entry.treatmentId }, select: { name: true } }),
    o.practitionerId ? db.staffMember.findUnique({ where: { id: o.practitionerId }, select: { displayName: true } }) : null,
    db.branch.findUnique({ where: { id: o.entry.branchId }, select: { name: true, cityName: true } }),
  ]);
  return {
    state: (o.status === 'sent' ? 'open' : o.status) as OfferState,
    slotStartsAt: o.slotStartsAt,
    holdUntil: o.holdUntil,
    treatmentName: treatment?.name ?? '',
    practitionerName: practitioner?.displayName ?? null,
    branchName: branch?.name ?? '',
    cityName: branch?.cityName ?? '',
    bookingPath: o.bookingId ? `/b/${bookingToken(o.bookingId)}` : null,
    leaveToken: o.entry.status === 'active' || o.entry.status === 'offered' ? entryToken(o.entry.id) : null,
  };
}

export type AcceptResult =
  | { ok: true; url: string }
  | { ok: false; error: 'not_found' | 'expired' | 'closed' | 'gone' | 'payments' };

/** Accept: books the slot (source waitlist). A deposit sends the client to checkout. */
export async function acceptOfferCore(token: string): Promise<AcceptResult> {
  const o = await byToken(token);
  if (!o) return { ok: false, error: 'not_found' };
  if (o.status === 'sent' && o.holdUntil.getTime() <= Date.now()) {
    await releaseOffer(o.id, 'expired');
    return { ok: false, error: 'expired' };
  }
  if (o.status === 'accepted' && o.bookingId) return { ok: true, url: `/b/${bookingToken(o.bookingId)}` };
  if (o.status !== 'sent') return { ok: false, error: o.status === 'expired' ? 'expired' : 'closed' };

  // Claim the offer first so a double tap can't book twice.
  const claimed = await db.waitlistOffer.updateMany({ where: { id: o.id, status: 'sent', holdUntil: { gt: new Date() } }, data: { status: 'accepted' } });
  if (!claimed.count) return { ok: false, error: 'closed' };

  const res = await createBooking({
    branchId: o.entry.branchId,
    treatmentId: o.entry.treatmentId,
    practitionerId: o.practitionerId,
    startsAt: o.slotStartsAt,
    client: { name: o.entry.clientName, phone: o.entry.clientPhone, userId: o.entry.clientUserId },
    marketingOptIn: false,
    source: 'waitlist',
  });
  if (!res.ok) {
    if (res.error === 'payments_unavailable') {
      // The clinic's payment setup is broken; keep the hold so the client can call and still take it.
      await db.waitlistOffer.update({ where: { id: o.id }, data: { status: 'sent' } });
      return { ok: false, error: 'payments' };
    }
    // Taken meanwhile (or no longer bookable): this offer is gone, the person stays on the list.
    await db.waitlistOffer.update({ where: { id: o.id }, data: { status: 'expired' } });
    await db.waitlistEntry.updateMany({ where: { id: o.entryId, status: 'offered' }, data: { status: 'active' } });
    return { ok: false, error: 'gone' };
  }
  await db.waitlistOffer.update({ where: { id: o.id }, data: { bookingId: res.bookingId } });
  await db.waitlistEntry.update({ where: { id: o.entryId }, data: { status: 'booked' } });
  return { ok: true, url: res.checkoutUrl ?? `/b/${res.token}` };
}

/** Pass: the person stays on the list in the same place; the slot goes to the next match. */
export async function passOfferCore(token: string): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'expired' | 'closed' }> {
  const o = await byToken(token);
  if (!o) return { ok: false, error: 'not_found' };
  if (o.status === 'passed') return { ok: true };
  if (o.status === 'sent' && o.holdUntil.getTime() <= Date.now()) {
    await releaseOffer(o.id, 'expired');
    return { ok: false, error: 'expired' };
  }
  if (o.status !== 'sent') return { ok: false, error: o.status === 'expired' ? 'expired' : 'closed' };
  return (await releaseOffer(o.id, 'passed')) ? { ok: true } : { ok: false, error: 'closed' };
}
