import 'server-only';
import { hhmm, ilDate, ilParts } from '../time';
import { messaging } from '../vendors/messaging';
import { randomToken, sha256 } from './crypto';
import { db } from './db';
import { siteUrl } from './site';

// Waitlist (03-states.md): when a slot frees up, offer it to the first active entry (join order)
// that matches the day, the time range and the practitioner preference. One open offer per slot.

const RANGES: Record<string, [number, number]> = { morning: [8, 12], noon: [12, 16], evening: [16, 20] };

async function holdMinutes(branchId: string) {
  const b = await db.branch.findUnique({ where: { id: branchId }, select: { business: { select: { settings: true } } } });
  const v = Number((b?.business.settings as Record<string, unknown> | null)?.waitlist_hold_minutes);
  return Number.isFinite(v) && v >= 5 ? v : 30;
}

export async function offerFreedSlot(slot: { branchId: string; treatmentId: string | null; practitionerId: string | null; startsAt: Date; durationMin: number }) {
  if (!slot.treatmentId) return null;
  const open = await db.waitlistOffer.findFirst({ where: { slotStartsAt: slot.startsAt, status: 'sent', holdUntil: { gt: new Date() }, entry: { branchId: slot.branchId } } });
  if (open) return null;
  const p = ilParts(slot.startsAt);
  const entries = await db.waitlistEntry.findMany({
    where: { branchId: slot.branchId, treatmentId: slot.treatmentId, status: 'active', expiresAt: { gt: new Date() }, days: { has: p.dow } },
    orderBy: { createdAt: 'asc' },
  });
  const match = entries.find(e => {
    const inRange = e.timeRanges.some(r => RANGES[r] && p.hh >= RANGES[r][0] && p.hh < RANGES[r][1]);
    const who = !e.practitionerId || e.practitionerId === slot.practitionerId;
    return inRange && who;
  });
  if (!match) return null;
  const token = randomToken(24);
  const hold = await holdMinutes(slot.branchId);
  const offer = await db.waitlistOffer.create({
    data: { entryId: match.id, slotStartsAt: slot.startsAt, practitionerId: slot.practitionerId, tokenHash: sha256(token), holdUntil: new Date(Date.now() + hold * 60_000) },
  });
  await db.waitlistEntry.update({ where: { id: match.id }, data: { status: 'offered' } });
  await messaging().send({
    channel: 'whatsapp', to: match.clientPhone, template: 'M7_waitlist_offer',
    vars: { name: match.clientName, date: ilDate(slot.startsAt), time: hhmm(slot.startsAt), minutes: String(hold), link: `${siteUrl()}/w/${token}` },
    kind: 'service',
  });
  return offer.id;
}
