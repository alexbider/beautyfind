import 'server-only';
import type { Booking, BookingSource, DepositPolicy, Prisma, Treatment } from '@prisma/client';
import { hhmm, ilDate } from '../time';
import { messaging } from '../vendors/messaging';
import { eligiblePractitioners, isSlotFree } from './availability';
import { isAdvanced } from './clinic';
import { hmac } from './crypto';
import { db } from './db';
import { refundPayment, startPayment } from './money';
import { nextRef } from './refs';
import { siteUrl } from './site';

// Booking lifecycle (03-states.md "Booking"):
// pending_payment → confirmed → checked_in → in_treatment → completed
//        ↘ abandoned        ↘ cancelled_client / cancelled_clinic / no_show

const HOLD_MIN = 10;
const DEFAULT_REFUND_WINDOW_H = 24;

// ---------- Guest links: /b/:token ----------

/** Signed, non-expiring guest token for a booking. Grants view/reschedule/cancel of that booking only. */
export function bookingToken(bookingId: string) {
  const id = bookingId.replace(/-/g, '');
  return `${id}.${hmac('booking:' + bookingId).slice(0, 32)}`;
}

export function bookingIdFromToken(token: string): string | null {
  const m = /^([0-9a-f]{32})\.([0-9a-f]{32})$/.exec(token);
  if (!m) return null;
  const h = m[1];
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return hmac('booking:' + id).slice(0, 32) === m[2] ? id : null;
}

export const manageUrl = (bookingId: string) => `${siteUrl()}/b/${bookingToken(bookingId)}`;

// ---------- Deposit policy ----------

export interface PolicySnapshot {
  depositEnabled: boolean;
  depositMode: 'fixed' | 'percent';
  depositValue: number;
  depositScope: 'all' | 'medical_only' | 'per_treatment';
  refundWindowHours: number;
  depositAgorot: number; // what this booking pays up front
}

/** Deposit for a treatment under the business's policy. Never a hard-coded amount. */
export function depositFor(policy: DepositPolicy | null, t: Pick<Treatment, 'isMedical' | 'priceAgorot' | 'depositOverrideAgorot'>): number {
  if (!policy?.enabled) return 0;
  if (policy.scope === 'per_treatment') return t.depositOverrideAgorot ?? 0;
  if (policy.scope === 'medical_only' && !t.isMedical) return 0;
  // Prices are before VAT; a percent deposit is taken from the VAT-inclusive price the client pays.
  if (policy.mode === 'percent') return Math.round((t.priceAgorot * 1.18 * policy.value) / 100 / 100) * 100;
  return policy.value;
}

export function snapshotPolicy(policy: DepositPolicy | null, depositAgorot: number): PolicySnapshot {
  return {
    depositEnabled: !!policy?.enabled,
    depositMode: policy?.mode ?? 'fixed',
    depositValue: policy?.value ?? 0,
    depositScope: policy?.scope ?? 'medical_only',
    refundWindowHours: policy?.refundWindowHours ?? DEFAULT_REFUND_WINDOW_H,
    depositAgorot,
  };
}

// ---------- Create ----------

export type CreateBookingResult =
  | { ok: true; bookingId: string; ref: string; token: string; checkoutUrl: string | null }
  | { ok: false; error: 'not_found' | 'medical_needs_consult' | 'slot_taken' | 'no_practitioner' | 'payments_unavailable' };

/**
 * Books a treatment. Holds the slot for 10 minutes when a deposit is due and returns the provider's
 * checkout URL; otherwise confirms immediately. Medical treatments must go through a consult.
 */
export async function createBooking(opts: {
  branchId: string;
  treatmentId: string;
  practitionerId: string | null; // null = anyone free
  startsAt: Date;
  client: { name: string; phone: string; email?: string | null; userId?: string | null };
  marketingOptIn: boolean;
  source?: BookingSource;
  returnPath?: string; // override where the client returns after paying
}): Promise<CreateBookingResult> {
  const treatment = await db.treatment.findFirst({
    where: { id: opts.treatmentId, branchId: opts.branchId, isPublished: true, branch: { status: 'live', business: { status: 'live' } } },
    include: { branch: { include: { business: { include: { depositPolicy: true } } } } },
  });
  if (!treatment) return { ok: false, error: 'not_found' };
  if (treatment.isMedical) return { ok: false, error: 'medical_needs_consult' };
  // Staff booking by phone or walk-in may override the online switches; clients may not.
  const online = (opts.source ?? 'online') === 'online' || opts.source === 'waitlist';
  if (online && (!treatment.branch.onlineBooking || !treatment.onlineBookable)) return { ok: false, error: 'not_found' };

  const duration = treatment.durationMin ?? 60;
  const eligible = await eligiblePractitioners(opts.branchId, treatment);
  const candidates = opts.practitionerId ? eligible.filter(p => p.id === opts.practitionerId) : eligible;
  if (candidates.length === 0) return { ok: false, error: 'no_practitioner' };

  // Deposits are an advanced-plan (clinic system) feature; basic listings book without one.
  const advanced = await isAdvanced(treatment.branch.businessId);
  const policy = advanced ? treatment.branch.business.depositPolicy : null;
  const deposit = depositFor(policy, treatment);
  if (deposit > 0 && !(await db.providerConnection.findFirst({ where: { businessId: treatment.branch.businessId, kind: 'payments', status: 'connected' } }))) {
    // A deposit is configured but no provider is connected: don't take the booking silently without it.
    return { ok: false, error: 'payments_unavailable' };
  }

  const ref = await nextRef('BF');
  const booking = await db.$transaction(async tx => {
    for (const p of candidates) {
      // Serialise bookings per practitioner, then re-check inside the lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.id}))`;
      if (!(await isSlotFree({ branchId: opts.branchId, practitionerId: p.id, startsAt: opts.startsAt, durationMin: duration }))) continue;
      return tx.booking.create({
        data: {
          ref, branchId: opts.branchId, treatmentId: treatment.id, practitionerId: p.id,
          clientUserId: opts.client.userId ?? null, clientName: opts.client.name, clientPhone: opts.client.phone, clientEmail: opts.client.email ?? null,
          kind: 'treatment', startsAt: opts.startsAt, durationMin: duration,
          status: deposit > 0 ? 'pending_payment' : 'confirmed', source: opts.source ?? 'online',
          priceAgorot: treatment.priceAgorot, depositAgorot: deposit,
          policyShown: snapshotPolicy(policy, deposit) as unknown as Prisma.InputJsonValue,
          holdUntil: deposit > 0 ? new Date(Date.now() + HOLD_MIN * 60_000) : null,
          requiresDeclaration: treatment.requiresDeclaration,
          consents: { policyAcceptedAt: new Date().toISOString(), marketingOptIn: opts.marketingOptIn },
        },
      });
    }
    return null;
  });
  if (!booking) return { ok: false, error: 'slot_taken' };

  if (opts.marketingOptIn) await recordMarketingOptIn(opts.client.phone, treatment.branch.businessId, opts.client.userId ?? null);

  const token = bookingToken(booking.id);
  if (deposit > 0) {
    const pay = await startPayment({
      businessId: treatment.branch.businessId, purpose: 'deposit', grossAgorot: deposit,
      description: `מקדמה: ${treatment.name}, ${treatment.branch.name}`,
      customer: { name: opts.client.name, phone: opts.client.phone, email: opts.client.email },
      bookingId: booking.id, returnPath: opts.returnPath ?? `/b/${token}`,
    });
    if (!pay.ok) {
      await db.booking.update({ where: { id: booking.id }, data: { status: 'abandoned', holdUntil: null } });
      return { ok: false, error: 'payments_unavailable' };
    }
    return { ok: true, bookingId: booking.id, ref, token, checkoutUrl: pay.checkoutUrl };
  }
  await sendConfirmation(booking.id);
  return { ok: true, bookingId: booking.id, ref, token, checkoutUrl: null };
}

async function recordMarketingOptIn(phone: string, businessId: string, userId: string | null) {
  await db.messageConsent.upsert({
    where: { contact_scope_channel: { contact: phone, scope: businessId, channel: 'wa' } },
    create: { contact: phone, scope: businessId, channel: 'wa', marketing: true, source: 'booking', userId },
    update: { marketing: true, source: 'booking' },
  });
}

/** Called by the money service when the deposit (or consult fee) is paid. */
export async function confirmPaidBooking(bookingId: string) {
  const moved = await db.booking.updateMany({ where: { id: bookingId, status: { in: ['pending_payment', 'abandoned'] } }, data: { status: 'confirmed', holdUntil: null } });
  if (moved.count) await sendConfirmation(bookingId);
}

/** M1 confirmation (and M3 declaration link when needed). Service messages. */
export async function sendConfirmation(bookingId: string, template: 'M1_booking_confirmed' | 'M1_booking_rescheduled' = 'M1_booking_confirmed') {
  const b = await db.booking.findUnique({ where: { id: bookingId }, include: { branch: true, treatment: true, practitioner: true } });
  if (!b) return;
  const vars = {
    name: b.clientName, business: b.branch.name, treatment: b.treatment?.name ?? 'פגישת ייעוץ',
    date: ilDate(b.startsAt), time: hhmm(b.startsAt), practitioner: b.practitioner?.displayName ?? '', ref: b.ref, link: manageUrl(b.id),
  };
  await messaging().send({ channel: 'whatsapp', to: b.clientPhone, template, vars, kind: 'service' });
  if (b.clientEmail) await messaging().send({ channel: 'email', to: b.clientEmail, template, vars, kind: 'service' });
  if (b.requiresDeclaration && !b.declarationId) {
    await messaging().send({ channel: 'whatsapp', to: b.clientPhone, template: 'M3_declaration_request', vars: { ...vars, link: `${manageUrl(b.id)}/declaration` }, kind: 'service' });
  }
}

// ---------- Cancel / reschedule ----------

export const hoursUntil = (b: Pick<Booking, 'startsAt'>, now = new Date()) => (b.startsAt.getTime() - now.getTime()) / 3_600_000;

export function refundWindowHours(b: Pick<Booking, 'policyShown'>) {
  const p = b.policyShown as unknown as Partial<PolicySnapshot> | null;
  return p?.refundWindowHours ?? DEFAULT_REFUND_WINDOW_H;
}

export type CancelResult = { ok: true; late: boolean; refunded: number } | { ok: false; error: 'not_found' | 'not_cancellable' };

/**
 * Client cancellation: on time → deposit refunded with a credit note; late → deposit kept per the
 * policy shown at booking. Clinic cancellation always refunds in full. Frees the slot for the waitlist.
 */
export async function cancelBooking(opts: { bookingId: string; by: 'client' | 'clinic'; reason: string; actorId?: string | null }): Promise<CancelResult> {
  const b = await db.booking.findUnique({ where: { id: opts.bookingId }, include: { payments: true } });
  if (!b) return { ok: false, error: 'not_found' };
  if (b.status !== 'confirmed' && b.status !== 'pending_payment') return { ok: false, error: 'not_cancellable' };

  const late = opts.by === 'client' && hoursUntil(b) < refundWindowHours(b);
  await db.booking.update({
    where: { id: b.id },
    data: {
      status: opts.by === 'client' ? 'cancelled_client' : 'cancelled_clinic',
      holdUntil: null,
      cancellation: { by: opts.by, at: new Date().toISOString(), reason: opts.reason, late },
    },
  });

  let refunded = 0;
  for (const p of b.payments.filter(x => x.status === 'succeeded')) {
    if (late) {
      await db.payment.update({ where: { id: p.id }, data: { status: 'forfeited' } });
    } else {
      const r = await refundPayment(p.id, p.grossAgorot, opts.by === 'client' ? 'ביטול בזמן' : 'ביטול על ידי העסק');
      if (r.ok) refunded += p.grossAgorot;
    }
  }
  if (opts.by === 'clinic') {
    await messaging().send({ channel: 'whatsapp', to: b.clientPhone, template: 'M12_clinic_cancelled', vars: { ref: b.ref, reason: opts.reason }, kind: 'service' });
  } else if (b.status === 'confirmed') {
    // An abandoned checkout needs no confirmation; a real appointment does.
    const vars = { name: b.clientName, ref: b.ref, date: ilDate(b.startsAt), time: hhmm(b.startsAt), refunded: String(refunded / 100), late: late ? '1' : '0' };
    await messaging().send({ channel: 'whatsapp', to: b.clientPhone, template: 'M13_client_cancelled', vars, kind: 'service' });
    if (b.clientEmail) await messaging().send({ channel: 'email', to: b.clientEmail, template: 'M13_client_cancelled', vars, kind: 'service' });
  }
  // Offer the freed slot to the waitlist (lib/server/waitlist.ts).
  if (b.startsAt.getTime() > Date.now()) {
    const { offerFreedSlot } = await import('./waitlist');
    await offerFreedSlot({ branchId: b.branchId, treatmentId: b.treatmentId, practitionerId: b.practitionerId, startsAt: b.startsAt, durationMin: b.durationMin }).catch(e =>
      console.error('[booking] waitlist offer failed', e),
    );
  }
  return { ok: true, late, refunded };
}

export type RescheduleResult = { ok: true; late: boolean } | { ok: false; error: 'not_found' | 'not_reschedulable' | 'slot_taken' };

/** Same treatment and practitioner; the deposit and declaration carry over. Inside the window counts as late. */
export async function rescheduleBooking(opts: { bookingId: string; startsAt: Date; by: 'client' | 'clinic' }): Promise<RescheduleResult> {
  const b = await db.booking.findUnique({ where: { id: opts.bookingId } });
  if (!b || !b.practitionerId) return { ok: false, error: 'not_found' };
  if (b.status !== 'confirmed') return { ok: false, error: 'not_reschedulable' };
  if (b.startsAt.getTime() === opts.startsAt.getTime()) return { ok: false, error: 'not_reschedulable' };
  const late = opts.by === 'client' && hoursUntil(b) < refundWindowHours(b);
  const oldStart = b.startsAt;
  const ok = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${b.practitionerId!}))`;
    if (!(await isSlotFree({ branchId: b.branchId, practitionerId: b.practitionerId!, startsAt: opts.startsAt, durationMin: b.durationMin, excludeBookingId: b.id }))) return false;
    await tx.booking.update({ where: { id: b.id }, data: { startsAt: opts.startsAt, notes: late ? [b.notes, 'נדחה בתוך חלון הביטול'].filter(Boolean).join(' · ') : b.notes } });
    return true;
  });
  if (!ok) return { ok: false, error: 'slot_taken' };
  await sendConfirmation(b.id, 'M1_booking_rescheduled');
  if (oldStart.getTime() > Date.now()) {
    const { offerFreedSlot } = await import('./waitlist');
    await offerFreedSlot({ branchId: b.branchId, treatmentId: b.treatmentId, practitionerId: b.practitionerId, startsAt: oldStart, durationMin: b.durationMin }).catch(() => {});
  }
  return { ok: true, late };
}

/** Releases expired payment holds. Safe to call often (e.g. before listing availability). */
export async function releaseExpiredHolds() {
  const due = await db.booking.findMany({ where: { status: 'pending_payment', holdUntil: { lt: new Date() } }, select: { id: true } });
  if (!due.length) return;
  const ids = due.map(b => b.id);
  await db.booking.updateMany({ where: { id: { in: ids }, status: 'pending_payment' }, data: { status: 'abandoned' } });
  const { reopenAbandonedWaitlistBookings } = await import('./waitlist');
  await reopenAbandonedWaitlistBookings(ids);
}
