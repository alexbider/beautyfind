'use server';

import { z } from 'zod';
import { EMAIL_RE, toE164 } from '@/lib/format';
import { availability, eligiblePractitioners } from '@/lib/server/availability';
import { createBooking, releaseExpiredHolds } from '@/lib/server/booking';
import { db } from '@/lib/server/db';
import { PUBLIC_WHERE } from '@/lib/server/public';
import { currentUser } from '@/lib/server/session';
import { addDays, ilDateKey } from '@/lib/time';
import { SLOT_WEEKS, isMobileE164, type SlotsResult, type SubmitInput, type SubmitResult } from './shared';

// Server actions for /book/[branch]. Every call re-reads the branch and treatment from the DB:
// only published treatments of live branches of live businesses can be listed or booked.

const BOOKINGS_PER_PHONE_PER_HOUR = 5;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

async function bookableTreatment(branchId: string, treatmentId: string) {
  return db.treatment.findFirst({
    where: { id: treatmentId, branchId, isPublished: true, isMedical: false, branch: { AND: [PUBLIC_WHERE, { onlineBooking: true }] } },
    select: { id: true, branchId: true, durationMin: true, practitionerIds: true, isMedical: true },
  });
}

/** One week of free slots for a treatment (everyone eligible; the client filters by practitioner). */
export async function loadWeek(input: { branchId: string; treatmentId: string; week: number }): Promise<SlotsResult> {
  const week = Number(input?.week);
  if (!uuid.safeParse(input?.branchId).success || !uuid.safeParse(input?.treatmentId).success) return { ok: false };
  if (!Number.isInteger(week) || week < 0 || week >= SLOT_WEEKS) return { ok: false };
  try {
    const t = await bookableTreatment(input.branchId, input.treatmentId);
    if (!t) return { ok: false };
    await releaseExpiredHolds();
    const staff = await eligiblePractitioners(t.branchId, t);
    const days = await availability({
      branchId: t.branchId,
      durationMin: t.durationMin ?? 60,
      practitionerIds: staff.map(s => s.id),
      fromDate: addDays(ilDateKey(new Date()), week * 7),
      days: 7,
    });
    return { ok: true, days: days.map(d => ({ date: d.date, open: d.open, slots: d.slots })) };
  } catch (e) {
    console.error('[book] loadWeek failed', e);
    return { ok: false };
  }
}

const SubmitSchema = z.object({
  branchId: uuid,
  treatmentId: uuid,
  practitionerId: uuid.nullable(),
  startsAt: z.string().datetime(),
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(9).max(20),
  email: z.string().trim().max(120),
  consentHealth: z.literal(true),
  consentPolicy: z.literal(true),
  marketing: z.boolean(),
});

/** Details step submit. Maps straight onto createBooking; the client redirects to checkoutUrl when set. */
export async function submitBooking(input: SubmitInput): Promise<SubmitResult> {
  const parsed = SubmitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const d = parsed.data;
  const phone = toE164(d.phone);
  if (!isMobileE164(phone)) return { ok: false, error: 'invalid' };
  const email = d.email ? d.email.toLowerCase() : null;
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: 'invalid' };

  try {
    const recent = await db.booking.count({ where: { clientPhone: phone!, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
    if (recent >= BOOKINGS_PER_PHONE_PER_HOUR) return { ok: false, error: 'rate_limited' };

    if (!(await bookableTreatment(d.branchId, d.treatmentId))) {
      // Medical treatments go through a consult; anything else missing is gone or not online.
      const medical = await db.treatment.findFirst({ where: { id: d.treatmentId, branchId: d.branchId, isMedical: true }, select: { id: true } });
      return { ok: false, error: medical ? 'medical_needs_consult' : 'not_found' };
    }
    await releaseExpiredHolds();
    const user = await currentUser().catch(() => null);
    const res = await createBooking({
      branchId: d.branchId,
      treatmentId: d.treatmentId,
      practitionerId: d.practitionerId,
      startsAt: new Date(d.startsAt),
      client: { name: d.name, phone: phone!, email, userId: user?.kind === 'client' ? user.id : null },
      marketingOptIn: d.marketing,
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, ref: res.ref, token: res.token, checkoutUrl: res.checkoutUrl };
  } catch (e) {
    console.error('[book] submit failed', e);
    return { ok: false, error: 'failed' };
  }
}
