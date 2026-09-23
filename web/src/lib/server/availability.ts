import 'server-only';
import type { Profession } from '@prisma/client';
import { addDays, dowOf, ilDateKey, ilToUtc, minutesOf, timeOf } from '../time';
import { db } from './db';

// Slot engine. A slot is offered when:
//  - it falls inside the branch's opening hours for that day (Branch.hours, index 0 = Sunday),
//  - the practitioner can perform the treatment (Treatment.practitionerIds, or any eligible staff),
//  - it doesn't overlap the practitioner's bookings, a pending hold, or a busy block
//    (imported from a connected calendar, or blocked manually),
//  - it starts at least LEAD_MIN from now.
// Medical treatments are performed only by a doctor, or a nurse under the branch's doctor.

export const SLOT_STEP_MIN = 30;
const LEAD_MIN = 60;
const HORIZON_DAYS = 60;

const BLOCKING = ['pending_payment', 'confirmed', 'checked_in', 'in_treatment'] as const;

const MEDICAL: Profession[] = ['doctor', 'nurse'];
const COSMETIC: Profession[] = ['doctor', 'nurse', 'cosmetician', 'technician'];

type Hours = Array<{ open: string; close: string; closed: boolean }>;

export interface Slot {
  startsAt: string; // ISO
  time: string; // HH:MM Israel
  practitionerIds: string[]; // who is free at this time
}

export interface DayAvailability {
  date: string; // YYYY-MM-DD (Israel)
  dow: number;
  open: boolean; // the branch is open that day
  slots: Slot[];
}

/** Staff who can perform a treatment at a branch. */
export async function eligiblePractitioners(branchId: string, treatment: { practitionerIds: string[]; isMedical: boolean } | null) {
  const staff = await db.staffMember.findMany({
    where: {
      status: 'active',
      branchIds: { has: branchId },
      profession: { in: treatment?.isMedical ? MEDICAL : COSMETIC },
      ...(treatment?.practitionerIds.length ? { id: { in: treatment.practitionerIds } } : {}),
    },
    select: { id: true, displayName: true, profession: true, license: { select: { status: true } } },
    orderBy: { createdAt: 'asc' },
  });
  // Licensed professions only once their license is verified.
  return staff.filter(s => (s.profession === 'doctor' || s.profession === 'nurse' ? s.license?.status === 'verified' : true));
}

/**
 * Free slots for a treatment (or a consult of `durationMin`) over [fromDate, fromDate + days).
 * `practitionerId` narrows to one person; otherwise a slot lists everyone free at that time.
 */
export async function availability(opts: {
  branchId: string;
  durationMin: number;
  practitionerIds: string[];
  fromDate?: string;
  days?: number;
  practitionerId?: string | null;
  excludeBookingId?: string; // when rescheduling, ignore the booking being moved
  now?: Date;
}): Promise<DayAvailability[]> {
  const now = opts.now ?? new Date();
  const from = opts.fromDate ?? ilDateKey(now);
  const days = Math.min(opts.days ?? 14, HORIZON_DAYS);
  const people = opts.practitionerId ? opts.practitionerIds.filter(id => id === opts.practitionerId) : opts.practitionerIds;

  const branch = await db.branch.findUnique({ where: { id: opts.branchId }, select: { hours: true } });
  const hours = (Array.isArray(branch?.hours) ? branch!.hours : []) as unknown as Hours;

  const rangeStart = ilToUtc(from, '00:00');
  const rangeEnd = ilToUtc(addDays(from, days), '00:00');

  const [bookings, blocks] = await Promise.all([
    db.booking.findMany({
      where: {
        branchId: opts.branchId,
        status: { in: [...BLOCKING] },
        startsAt: { lt: rangeEnd },
        ...(opts.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}),
        // Pending holds only block while they're alive.
        OR: [{ status: { not: 'pending_payment' } }, { holdUntil: { gt: now } }],
      },
      select: { practitionerId: true, startsAt: true, durationMin: true },
    }),
    db.busyBlock.findMany({ where: { branchId: opts.branchId, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } } }),
  ]);

  const busy = (pid: string, start: number, end: number) =>
    bookings.some(b => b.practitionerId === pid && b.startsAt.getTime() < end && b.startsAt.getTime() + b.durationMin * 60_000 > start) ||
    blocks.some(b => (b.practitionerId === null || b.practitionerId === pid) && b.startsAt.getTime() < end && b.endsAt.getTime() > start);

  const out: DayAvailability[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const dow = dowOf(date);
    const h = hours[dow];
    const open = !!h && !h.closed && !!h.open && !!h.close;
    const slots: Slot[] = [];
    if (open) {
      const openM = minutesOf(h.open);
      const closeM = minutesOf(h.close);
      for (let m = openM; m + opts.durationMin <= closeM; m += SLOT_STEP_MIN) {
        const start = ilToUtc(date, timeOf(m));
        if (start.getTime() < now.getTime() + LEAD_MIN * 60_000) continue;
        const end = start.getTime() + opts.durationMin * 60_000;
        const free = people.filter(pid => !busy(pid, start.getTime(), end));
        if (free.length) slots.push({ startsAt: start.toISOString(), time: timeOf(m), practitionerIds: free });
      }
    }
    out.push({ date, dow, open, slots });
  }
  return out;
}

/** Re-checks one slot right before booking (the client may have waited on the page). */
export async function isSlotFree(opts: {
  branchId: string;
  practitionerId: string;
  startsAt: Date;
  durationMin: number;
  excludeBookingId?: string;
}): Promise<boolean> {
  const date = ilDateKey(opts.startsAt);
  const [day] = await availability({
    branchId: opts.branchId,
    durationMin: opts.durationMin,
    practitionerIds: [opts.practitionerId],
    fromDate: date,
    days: 1,
    excludeBookingId: opts.excludeBookingId,
  });
  return !!day?.slots.some(s => s.startsAt === opts.startsAt.toISOString());
}
