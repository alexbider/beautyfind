import 'server-only';
import { db } from './db';

// Waitlist (03-states.md): when a slot frees up, offer it to the first active entry (join order)
// that matches the day, the time range and the practitioner preference. One open offer per slot.
// The matching and offer logic lives in app/w/offers.ts (offerSlotToNext); it skips anyone who
// already had this slot and re-checks the slot is free. Loaded lazily: offers imports booking.

export async function offerFreedSlot(slot: { branchId: string; treatmentId: string | null; practitionerId: string | null; startsAt: Date; durationMin: number }) {
  if (!slot.treatmentId) return null;
  const { offerSlotToNext } = await import('@/app/w/offers');
  return offerSlotToNext({ branchId: slot.branchId, treatmentId: slot.treatmentId, practitionerId: slot.practitionerId, startsAt: slot.startsAt });
}

/**
 * A waitlist booking that was never paid: the client goes back to the list in the same place and
 * the slot moves on to the next match.
 */
export async function reopenAbandonedWaitlistBookings(bookingIds: string[]) {
  if (!bookingIds.length) return;
  const offers = await db.waitlistOffer.findMany({ where: { bookingId: { in: bookingIds }, status: 'accepted' }, include: { entry: true } });
  for (const o of offers) {
    await db.waitlistEntry.updateMany({ where: { id: o.entryId, status: 'booked', expiresAt: { gt: new Date() } }, data: { status: 'active' } });
    await offerFreedSlot({ branchId: o.entry.branchId, treatmentId: o.entry.treatmentId, practitionerId: o.practitionerId, startsAt: o.slotStartsAt, durationMin: 0 }).catch(e =>
      console.error('[waitlist] re-offer after abandoned booking failed', e),
    );
  }
}
