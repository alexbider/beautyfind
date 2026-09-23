import 'server-only';
import { addDays, hhmm, ilDateKey, ilParts } from '@/lib/time';
import { fromE164 } from '@/lib/format';
import { availability, eligiblePractitioners, isSlotFree } from '@/lib/server/availability';
import { db } from '@/lib/server/db';
import { DAY_SHORT, entryMatches, pad2, prefText, shortName, since } from '@/components/waitlist/shared';
import type { QueueData } from '@/components/waitlist/ClinicQueue';
import { holdFromSettings, sweepEntries } from '../../waitlist/entries';
import { sweepOffers } from '../../w/offers';

// Clinic waitlist queue (Waitlist design, view=clinic): entries by treatment in join order,
// open offers with their hold timer, recently freed slots, and a picker to offer any free slot.

const PICK_DAYS = 10;
const FREED_LOOKBACK_DAYS = 14;

export const slotText = (at: Date) => {
  const p = ilParts(at);
  return { day: `יום ${DAY_SHORT[p.dow]}`, date: `${pad2(p.d)}/${pad2(p.m)}`, time: hhmm(at) };
};

type Branch = { id: string; name: string };

/** Branches this member works at (owners and unassigned staff see every branch). */
export function accessibleBranches(ctx: { member: { isOwner: boolean; branchIds: string[] }; business: { branches: (Branch & { status: string })[] } }) {
  const all = ctx.business.branches;
  if (ctx.member.isOwner || ctx.member.branchIds.length === 0) return all;
  return all.filter(b => ctx.member.branchIds.includes(b.id));
}

export async function loadQueue(branchId: string, settings: unknown): Promise<QueueData> {
  await sweepEntries(branchId);
  await sweepOffers(branchId);
  const now = new Date();

  const [entries, openOffers] = await Promise.all([
    db.waitlistEntry.findMany({
      where: { branchId, status: { in: ['active', 'offered'] }, expiresAt: { gt: now } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    }),
    db.waitlistOffer.findMany({
      where: { status: 'sent', holdUntil: { gt: now }, entry: { branchId } },
      include: { entry: { select: { id: true, clientName: true, treatmentId: true } } },
      orderBy: { holdUntil: 'asc' },
    }),
  ]);

  const tIds = [...new Set(entries.map(e => e.treatmentId))];
  const [treatments, staff] = await Promise.all([
    tIds.length ? db.treatment.findMany({ where: { id: { in: tIds } }, select: { id: true, name: true, durationMin: true, practitionerIds: true, isMedical: true } }) : [],
    db.staffMember.findMany({ where: { branchIds: { has: branchId } }, select: { id: true, displayName: true } }),
  ]);
  const tName = new Map(treatments.map(t => [t.id, t.name]));
  const sName = new Map(staff.map(s => [s.id, s.displayName]));

  // Recently cancelled bookings whose time is still ahead and still free: the design's "התפנה תור" banner.
  const cancelled = !tIds.length ? [] : await db.booking.findMany({
    where: {
      branchId, status: { in: ['cancelled_client', 'cancelled_clinic'] }, treatmentId: { in: tIds },
      startsAt: { gt: new Date(now.getTime() + 60 * 60_000) }, updatedAt: { gt: new Date(now.getTime() - FREED_LOOKBACK_DAYS * 86_400_000) },
    },
    orderBy: { startsAt: 'asc' },
    take: 12,
    select: { id: true, startsAt: true, treatmentId: true, practitionerId: true, durationMin: true, clientName: true },
  });
  const freed: QueueData['freed'] = [];
  const seen = new Set<string>();
  for (const b of cancelled) {
    const key = b.startsAt.toISOString() + (b.practitionerId ?? '');
    if (seen.has(key) || freed.length >= 3) continue;
    seen.add(key);
    const offers = await db.waitlistOffer.findMany({ where: { slotStartsAt: b.startsAt, entry: { branchId } }, include: { entry: { select: { id: true, clientName: true } } } });
    if (offers.some(o => o.status === 'accepted')) continue;
    const open = offers.find(o => o.status === 'sent' && o.holdUntil > now) ?? null;
    if (!open && b.practitionerId && !(await isSlotFree({ branchId, practitionerId: b.practitionerId, startsAt: b.startsAt, durationMin: b.durationMin }))) continue;
    const had = new Set(offers.map(o => o.entryId));
    const p = ilParts(b.startsAt);
    const matchIds = entries
      .filter(e => e.status === 'active' && e.treatmentId === b.treatmentId && !had.has(e.id) && entryMatches(e, { dow: p.dow, hh: p.hh, practitionerId: b.practitionerId }))
      .map(e => e.id);
    freed.push({
      key,
      treatmentId: b.treatmentId!,
      practitionerId: b.practitionerId,
      startsAt: b.startsAt.toISOString(),
      ...slotText(b.startsAt),
      practitioner: b.practitionerId ? (sName.get(b.practitionerId) ?? null) : null,
      treatment: tName.get(b.treatmentId!) ?? '',
      cancelledBy: shortName(b.clientName),
      matchIds,
      sentTo: open ? open.entry.clientName : null,
    });
  }

  // Free slots for the manual offer picker, per treatment that has someone waiting.
  const today = ilDateKey(now);
  const picker: QueueData['picker'] = [];
  for (const t of treatments) {
    const people = await eligiblePractitioners(branchId, t);
    if (!people.length) continue;
    const days = await availability({ branchId, durationMin: t.durationMin ?? 60, practitionerIds: people.map(p => p.id), fromDate: today, days: PICK_DAYS, now });
    picker.push({
      treatmentId: t.id,
      practitioners: people.map(p => ({ id: p.id, name: p.displayName })),
      days: days
        .filter(d => d.dow <= 5 && d.slots.length)
        .map(d => ({
          date: d.date,
          day: d.date === today ? 'היום' : d.date === addDays(today, 1) ? 'מחר' : `יום ${DAY_SHORT[d.dow]}`,
          dateText: `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}`,
          dow: d.dow,
          slots: d.slots.map(s => ({ startsAt: s.startsAt, time: s.time, hh: Number(s.time.slice(0, 2)), practitionerIds: s.practitionerIds })),
        })),
    });
  }

  // Place in line per treatment (join order).
  const place = new Map<string, number>();
  const counter = new Map<string, number>();
  for (const e of entries) {
    const n = (counter.get(e.treatmentId) ?? 0) + 1;
    counter.set(e.treatmentId, n);
    place.set(e.id, n);
  }

  return {
    holdMinutes: holdFromSettings(settings),
    serverNow: now.getTime(),
    treatments: tIds.map(id => ({ id, name: tName.get(id) ?? 'טיפול', count: counter.get(id) ?? 0 })).sort((a, b) => b.count - a.count),
    entries: entries.map(e => ({
      id: e.id,
      n: place.get(e.id) ?? 0,
      name: e.clientName,
      phone: fromE164(e.clientPhone),
      phoneE164: e.clientPhone,
      treatmentId: e.treatmentId,
      treatment: tName.get(e.treatmentId) ?? 'טיפול',
      pref: prefText(e, e.practitionerId ? (sName.get(e.practitionerId) ?? 'מטפלת מסוימת') : null),
      days: e.days,
      timeRanges: e.timeRanges,
      practitionerId: e.practitionerId,
      since: since((now.getTime() - e.createdAt.getTime()) / 86_400_000),
      status: e.status === 'offered' ? 'offered' : 'active',
    })),
    offers: openOffers.map(o => ({
      id: o.id,
      name: o.entry.clientName,
      treatment: tName.get(o.entry.treatmentId) ?? '',
      practitioner: o.practitionerId ? (sName.get(o.practitionerId) ?? null) : null,
      ...slotText(o.slotStartsAt),
      holdUntil: o.holdUntil.getTime(),
    })),
    freed,
    picker,
  };
}
