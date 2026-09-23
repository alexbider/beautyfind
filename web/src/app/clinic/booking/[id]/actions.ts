'use server';

import { revalidatePath } from 'next/cache';
import { clinicContext } from '@/lib/server/clinic';
import {
  ackDeclaration, actorFrom, cancelByClinic, checkIn, finishTreatment, markNoShow, resendDeclarationLink, startTreatment, undoNoShow,
  type ClinicalInput, type Result,
} from '../transitions';

// Server actions for the Clinic Booking card. The session and every rule are re-checked in the
// service (lib-style functions in ../transitions.ts); nothing from the client is trusted.

export type BookingOp = 'check_in' | 'start' | 'ack' | 'no_show' | 'undo_no_show' | 'resend';

async function actor() {
  const ctx = await clinicContext('bookings');
  return actorFrom(ctx);
}

function done(id: string, r: Result) {
  if (r.ok) {
    revalidatePath(`/clinic/booking/${id}`);
    revalidatePath('/clinic');
  }
  return r;
}

export async function bookingOp(id: string, op: BookingOp): Promise<Result> {
  if (typeof id !== 'string') return { ok: false, error: 'בקשה לא תקינה.' };
  const a = await actor();
  const fn = { check_in: checkIn, start: startTreatment, ack: ackDeclaration, no_show: markNoShow, undo_no_show: undoNoShow, resend: resendDeclarationLink }[op];
  if (!fn) return { ok: false, error: 'בקשה לא תקינה.' };
  return done(id, await fn(id, a));
}

export async function finishOp(id: string, input: ClinicalInput): Promise<Result> {
  if (typeof id !== 'string' || !input || typeof input !== 'object') return { ok: false, error: 'בקשה לא תקינה.' };
  return done(id, await finishTreatment(id, await actor(), {
    productBatch: String(input.productBatch ?? ''), units: String(input.units ?? ''), notes: String(input.notes ?? ''),
  }));
}

export async function cancelOp(id: string, reason: string): Promise<Result> {
  if (typeof id !== 'string') return { ok: false, error: 'בקשה לא תקינה.' };
  return done(id, await cancelByClinic(id, await actor(), String(reason ?? '')));
}
