'use server';

import { availability } from '@/lib/server/availability';
import { bookingIdFromToken, cancelBooking, releaseExpiredHolds, rescheduleBooking } from '@/lib/server/booking';
import { db } from '@/lib/server/db';
import { addDays, ilDateKey } from '@/lib/time';
import { CANCEL_REASONS, type DaySlots } from './shared';

// Server actions for the guest link /b/[token]. The token is the only credential: every action
// re-derives the booking id from it and touches that one booking only.

const ATTEMPTS_PER_HOUR = 6; // cancel + reschedule submissions per booking
const MAX_DAYS_AHEAD = 56;
const CHUNK_DAYS = 14;

export type ManageError = 'not_found' | 'not_allowed' | 'slot_taken' | 'rate_limited' | 'failed';

async function bookingFor(token: string) {
  const id = typeof token === 'string' ? bookingIdFromToken(token) : null;
  if (!id) return null;
  return db.booking.findUnique({
    where: { id },
    select: { id: true, branchId: true, practitionerId: true, durationMin: true, status: true, startsAt: true, branch: { select: { businessId: true } } },
  });
}

/**
 * Throttles guest changes per booking, across instances: each attempt is written to the audit log
 * (no personal data in it) and more than ATTEMPTS_PER_HOUR in an hour are refused.
 */
async function throttle(b: { id: string; branch: { businessId: string } }, action: 'guest_cancel' | 'guest_reschedule') {
  const since = new Date(Date.now() - 3_600_000);
  const n = await db.auditLog.count({ where: { subjectType: 'booking', subjectId: b.id, action: { in: ['guest_cancel', 'guest_reschedule'] }, createdAt: { gte: since } } });
  if (n >= ATTEMPTS_PER_HOUR) return false;
  await db.auditLog.create({ data: { action, subjectType: 'booking', subjectId: b.id, businessId: b.branch.businessId } });
  return true;
}

/** Free slots for the same treatment and practitioner, `CHUNK_DAYS` at a time, starting `offset` days from today. */
export async function loadRescheduleDays(input: { token: string; offset: number }): Promise<{ ok: true; days: DaySlots[] } | { ok: false }> {
  const offset = Number(input?.offset);
  if (!Number.isInteger(offset) || offset < 0 || offset >= MAX_DAYS_AHEAD) return { ok: false };
  try {
    const b = await bookingFor(input.token);
    if (!b || b.status !== 'confirmed' || !b.practitionerId) return { ok: false };
    await releaseExpiredHolds();
    const days = await availability({
      branchId: b.branchId,
      durationMin: b.durationMin,
      practitionerIds: [b.practitionerId],
      practitionerId: b.practitionerId,
      fromDate: addDays(ilDateKey(new Date()), offset),
      days: CHUNK_DAYS,
      excludeBookingId: b.id,
    });
    return { ok: true, days: days.map(d => ({ date: d.date, open: d.open, slots: d.slots.filter(sl => sl.startsAt !== b.startsAt.toISOString()) })) };
  } catch (e) {
    console.error('[manage] loadRescheduleDays failed', e);
    return { ok: false };
  }
}

export async function rescheduleByToken(input: { token: string; startsAt: string }): Promise<{ ok: true; late: boolean } | { ok: false; error: ManageError }> {
  const at = new Date(String(input?.startsAt ?? ''));
  if (Number.isNaN(at.getTime())) return { ok: false, error: 'failed' };
  try {
    const b = await bookingFor(input.token);
    if (!b) return { ok: false, error: 'not_found' };
    if (b.status !== 'confirmed' || !b.practitionerId || b.startsAt.getTime() <= Date.now()) return { ok: false, error: 'not_allowed' };
    if (at.getTime() === b.startsAt.getTime()) return { ok: false, error: 'not_allowed' }; // same time: nothing to move, no new message
    if (!(await throttle(b, 'guest_reschedule'))) return { ok: false, error: 'rate_limited' };
    const res = await rescheduleBooking({ bookingId: b.id, startsAt: at, by: 'client' });
    if (res.ok) return { ok: true, late: res.late };
    return { ok: false, error: res.error === 'slot_taken' ? 'slot_taken' : res.error === 'not_found' ? 'not_found' : 'not_allowed' };
  } catch (e) {
    console.error('[manage] reschedule failed', e);
    return { ok: false, error: 'failed' };
  }
}

const REASONS = new Set<string>(CANCEL_REASONS);

export async function cancelByToken(input: { token: string; reason: string | null }): Promise<{ ok: true; late: boolean; refunded: number } | { ok: false; error: ManageError }> {
  // Only the listed reasons are stored: the guest link is not a free-text channel.
  const reason = input?.reason && REASONS.has(input.reason) ? input.reason : 'לא צוינה סיבה';
  try {
    const b = await bookingFor(input.token);
    if (!b) return { ok: false, error: 'not_found' };
    if ((b.status !== 'confirmed' && b.status !== 'pending_payment') || b.startsAt.getTime() <= Date.now()) return { ok: false, error: 'not_allowed' };
    if (!(await throttle(b, 'guest_cancel'))) return { ok: false, error: 'rate_limited' };
    const res = await cancelBooking({ bookingId: b.id, by: 'client', reason });
    if (res.ok) return { ok: true, late: res.late, refunded: res.refunded };
    return { ok: false, error: res.error === 'not_found' ? 'not_found' : 'not_allowed' };
  } catch (e) {
    console.error('[manage] cancel failed', e);
    return { ok: false, error: 'failed' };
  }
}
