import 'server-only';
import type { BookingStatus, ConsultRequest, ConsultStatus, DepositPolicy, Prisma } from '@prisma/client';
import { availability } from '@/lib/server/availability';
import { bookingToken, sendConfirmation, snapshotPolicy, releaseExpiredHolds, cancelBooking } from '@/lib/server/booking';
import { isAdvanced } from '@/lib/server/clinic';
import { db } from '@/lib/server/db';
import { canTakePayments, startPayment } from '@/lib/server/money';
import { PUBLIC_WHERE } from '@/lib/server/public';
import { nextRef } from '@/lib/server/refs';
import { hhmm, ilDateKey } from '@/lib/time';
import { messaging } from '@/lib/vendors/messaging';
import { isSlotFree } from '@/lib/server/availability';
import {
  CONSULT_SLOT_MIN, DECLINES, DEFAULT_CONSULT_FEE, FORMATS, OPEN_STATUSES,
  dayLabel, declineMessage, firstName, proposeMessage,
  type DeclineKey, type FlagKey, type SlotDay, type FormatKey, type PriorKey, type TimeKey,
} from './constants';

// Consult Request service (08-open-decisions.md A2, 03-states.md "Consult request").
//
//   new → awaiting_client → consult_scheduled → closed_treatment_booked
//    ↘          ↘                 ↘ closed_declined (medical | scope | duplicate)
//
// Every state change is a conditional update (WHERE status IN allowed-from), so a transition that
// 03-states.md does not allow, or one that raced another staff member, changes nothing and is rejected.
// Every inbox decision is also an append-only Decision row (subjectType 'consult_request').

const HOLD_MIN = 10;
const RATE_PER_DAY = 3;
const SLOT_DAYS = 14;
const DEAD_BOOKING: BookingStatus[] = ['abandoned', 'cancelled_client', 'cancelled_clinic', 'no_show'];
const LIVE_BOOKING: BookingStatus[] = ['pending_payment', 'confirmed', 'checked_in', 'in_treatment', 'completed'];

const FROM: Record<'ask' | 'schedule' | 'decline' | 'approve', ConsultStatus[]> = {
  ask: ['new', 'awaiting_client'], // awaiting → awaiting is a resend, not a transition
  schedule: ['new', 'awaiting_client'],
  decline: OPEN_STATUSES,
  approve: ['consult_scheduled'],
};

// ---------- Configuration ----------

/** Business.settings.consult_fee in whole shekels (default ₪200), offset against the treatment. */
export function consultFee(settings: unknown): number {
  const v = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).consult_fee : undefined;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_CONSULT_FEE;
}

export interface ConsultDoctor {
  id: string;
  displayName: string;
  licenseNumber: string | null;
  specialty: string | null;
}

/**
 * Doctors with a verified license at the branch: consult availability is their free time.
 * The branch's medical responsible comes first (named on the page).
 */
export async function consultDoctors(branchId: string, medicalResponsibleId: string | null): Promise<ConsultDoctor[]> {
  const staff = await db.staffMember.findMany({
    where: { status: 'active', branchIds: { has: branchId }, profession: 'doctor', license: { status: 'verified' } },
    select: { id: true, displayName: true, license: { select: { number: true, specialty: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const out = staff.map(s => ({ id: s.id, displayName: s.displayName, licenseNumber: s.license?.number ?? null, specialty: s.license?.specialty ?? null }));
  return out.sort((a, b) => Number(b.id === medicalResponsibleId) - Number(a.id === medicalResponsibleId));
}

export type { SlotDay };

/** Real consult slots: any listed doctor free for CONSULT_SLOT_MIN. Days without a slot are dropped. */
export async function consultSlots(branchId: string, doctorIds: string[], days = SLOT_DAYS): Promise<SlotDay[]> {
  if (doctorIds.length === 0) return [];
  await releaseExpiredHolds();
  const avail = await availability({ branchId, durationMin: CONSULT_SLOT_MIN, practitionerIds: doctorIds, days });
  return avail
    .filter(d => d.slots.length > 0)
    .map(d => ({ date: d.date, label: dayLabel(d.date), dow: d.dow, slots: d.slots.map(s => ({ startsAt: s.startsAt, time: s.time })) }));
}

/** "ה׳ 24/09 10:00" for an instant. */
export const slotLabel = (at: Date) => `${dayLabel(ilDateKey(at))} ${hhmm(at)}`;
/** "ליום ה׳ 24/09 בשעה 10:00" (design outcome copy). */
const slotPhrase = (at: Date) => `ליום ${dayLabel(ilDateKey(at))} בשעה ${hhmm(at)}`;

// ---------- Booking the consult ----------

type Tx = Prisma.TransactionClient;

interface ReserveOpts {
  branchId: string;
  businessId: string;
  branchName: string;
  doctorIds: string[];
  startsAt: Date;
  format: FormatKey;
  client: { name: string; phone: string; email?: string | null; userId?: string | null };
  feeAgorot: number;
  payOnline: boolean;
  policy: DepositPolicy | null;
  /** Creates or transitions the ConsultRequest inside the lock. Return its id, or null to abort. */
  attach: (tx: Tx, practitionerId: string) => Promise<string | null>;
}

type ReserveResult = { ok: true; bookingId: string; bookingRef: string; token: string; checkoutUrl: string | null } | { ok: false; error: 'slot_taken' | 'conflict' };

/**
 * Creates the consult Booking (kind consult, source consult, the doctor as practitioner) together with
 * the request change, under the same per-practitioner advisory lock createBooking uses.
 * Fee due + payments connected → pending_payment with a 10-minute hold and a checkout (the money
 * service confirms it when paid). Otherwise confirmed at once with M1; the fee is paid at the clinic.
 */
async function reserveConsult(o: ReserveOpts): Promise<ReserveResult> {
  const durationMin = FORMATS.find(f => f.key === o.format)?.minutes ?? CONSULT_SLOT_MIN;
  const online = o.payOnline && o.feeAgorot > 0;
  const bookingRef = await nextRef('BF');

  let aborted = false;
  const booking = await db.$transaction(async tx => {
    for (const pid of o.doctorIds) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pid}))`;
      if (!(await isSlotFree({ branchId: o.branchId, practitionerId: pid, startsAt: o.startsAt, durationMin: CONSULT_SLOT_MIN }))) continue;
      const requestId = await o.attach(tx, pid);
      if (!requestId) {
        aborted = true;
        return null;
      }
      // A request whose earlier consult was abandoned or cancelled may be booked again: release the old link.
      await tx.booking.updateMany({ where: { consultRequestId: requestId, status: { in: DEAD_BOOKING } }, data: { consultRequestId: null } });
      return tx.booking.create({
        data: {
          ref: bookingRef, branchId: o.branchId, treatmentId: null, practitionerId: pid,
          clientUserId: o.client.userId ?? null, clientName: o.client.name, clientPhone: o.client.phone, clientEmail: o.client.email ?? null,
          kind: 'consult', source: 'consult', startsAt: o.startsAt, durationMin,
          status: online ? 'pending_payment' : 'confirmed',
          priceAgorot: o.feeAgorot, depositAgorot: online ? o.feeAgorot : 0,
          policyShown: { ...snapshotPolicy(o.policy, online ? o.feeAgorot : 0), consultFeeAgorot: o.feeAgorot, feeOffsetAgainstTreatment: true } as unknown as Prisma.InputJsonValue,
          holdUntil: online ? new Date(Date.now() + HOLD_MIN * 60_000) : null,
          requiresDeclaration: false, // the full declaration is asked only if a treatment is booked
          consultRequestId: requestId,
          consents: { policyAcceptedAt: new Date().toISOString(), marketingOptIn: false, shareMedicalWithClinic: true },
          notes: o.format === 'video' ? 'ייעוץ בשיחת וידאו' : null,
        },
      });
    }
    return null;
  });
  if (aborted) return { ok: false, error: 'conflict' };
  if (!booking) return { ok: false, error: 'slot_taken' };

  const token = bookingToken(booking.id);
  if (online) {
    const pay = await startPayment({
      businessId: o.businessId, purpose: 'consult', grossAgorot: o.feeAgorot,
      description: `ייעוץ רפואי, ${o.branchName}`,
      customer: { name: o.client.name, phone: o.client.phone, email: o.client.email },
      bookingId: booking.id, returnPath: `/b/${token}`,
    });
    if (pay.ok) return { ok: true, bookingId: booking.id, bookingRef, token, checkoutUrl: pay.checkoutUrl };
    // The provider failed after the slot was taken. Keep the consult; the fee is paid at the clinic instead.
    console.error('[consult] checkout failed, confirming without online payment', booking.id, pay.error);
    await db.booking.update({ where: { id: booking.id }, data: { status: 'confirmed', holdUntil: null, depositAgorot: 0 } });
  }
  await sendConfirmation(booking.id);
  return { ok: true, bookingId: booking.id, bookingRef, token, checkoutUrl: null };
}

// ---------- Patient: submit ----------

export interface SubmitInput {
  branchId: string;
  treatmentId: string | null;
  client: { name: string; phone: string; email?: string | null; userId?: string | null };
  areas: string[];
  goal: string;
  prior: PriorKey;
  format: FormatKey;
  slot: Date | null;
  preferredTimes: TimeKey[];
  preferredDays: number[];
  flags: FlagKey[];
}

export type SubmitResult =
  | { ok: true; ref: string; status: 'new' | 'consult_scheduled'; slot: string | null; token: string | null; checkoutUrl: string | null }
  | { ok: false; error: 'not_available' | 'slot_taken' | 'rate' };

/** Validated input only (the action validates). With a slot the consult is booked at once. */
export async function submitConsultRequest(i: SubmitInput): Promise<SubmitResult> {
  const branch = await db.branch.findFirst({
    where: { AND: [PUBLIC_WHERE, { id: i.branchId }] },
    include: { business: { include: { depositPolicy: true } } },
  });
  if (!branch || !(await isAdvanced(branch.businessId))) return { ok: false, error: 'not_available' };
  const doctors = await consultDoctors(branch.id, branch.medicalResponsibleId);
  if (doctors.length === 0) return { ok: false, error: 'not_available' };
  const treatmentId = i.treatmentId
    ? (await db.treatment.findFirst({ where: { id: i.treatmentId, branchId: branch.id, isPublished: true }, select: { id: true } }))?.id ?? null
    : null;

  const since = new Date(Date.now() - 86_400_000);
  const recent = await db.consultRequest.count({ where: { branchId: branch.id, clientPhone: i.client.phone, createdAt: { gte: since } } });
  if (recent >= RATE_PER_DAY) return { ok: false, error: 'rate' };

  const feeAgorot = consultFee(branch.business.settings) * 100;
  const ref = await nextRef('R', 3);
  const base = {
    ref, branchId: branch.id, clientUserId: i.client.userId ?? null, clientName: i.client.name, clientPhone: i.client.phone, treatmentId,
    areas: i.areas, goal: i.goal, priorInjections: i.prior, format: i.format,
    consentShareMedical: true, medicalFlags: i.flags, feeAgorot,
  };
  const submitted = (tx: Tx | typeof db, id: string, action: string) =>
    tx.decision.create({ data: { actorId: i.client.userId ?? null, actorRole: 'client', subjectType: 'consult_request', subjectId: id, action } });

  if (!i.slot) {
    const req = await db.consultRequest.create({
      data: { ...base, status: 'new', preferredTimes: i.preferredTimes, preferredDays: i.preferredDays },
    });
    await submitted(db, req.id, 'submit');
    return { ok: true, ref, status: 'new', slot: null, token: null, checkoutUrl: null };
  }

  const payOnline = feeAgorot > 0 && (await canTakePayments(branch.businessId));
  const slot = i.slot;
  const res = await reserveConsult({
    branchId: branch.id, businessId: branch.businessId, branchName: branch.name,
    doctorIds: doctors.map(d => d.id), startsAt: slot, format: i.format,
    client: i.client, feeAgorot, payOnline, policy: branch.business.depositPolicy,
    attach: async tx => {
      const req = await tx.consultRequest.create({
        data: { ...base, status: 'consult_scheduled', chosenSlot: slot, preferredTimes: [], preferredDays: [], outcomeText: `נקבע ייעוץ ${slotPhrase(slot)} · אישור נשלח בוואטסאפ.` },
      });
      await submitted(tx, req.id, 'submit_scheduled');
      return req.id;
    },
  });
  if (!res.ok) return { ok: false, error: 'slot_taken' };
  return { ok: true, ref, status: 'consult_scheduled', slot: slotLabel(slot), token: res.token, checkoutUrl: res.checkoutUrl };
}

// ---------- Clinic inbox ----------

export interface Actor {
  userId: string;
  businessId: string;
  branchIds: string[]; // branches this member may see
  displayName: string;
  role: string; // preset key, logged as Decision.actorRole
  isPhysician: boolean; // doctor with a verified license
}

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const FAIL_STALE: ActionResult = { ok: false, error: 'הבקשה עודכנה בינתיים. רעננו את העמוד ונסו שוב.' };

async function loadForActor(actor: Actor, id: string) {
  return db.consultRequest.findFirst({
    where: { id, branchId: { in: actor.branchIds }, branch: { businessId: actor.businessId } },
    include: { branch: { include: { business: { include: { depositPolicy: true } } } } },
  });
}

async function decide(tx: Tx | typeof db, actor: Actor, req: Pick<ConsultRequest, 'id'>, action: string, reason?: string | null) {
  await tx.decision.create({
    data: { actorId: actor.userId, actorRole: actor.isPhysician ? 'physician' : actor.role, subjectType: 'consult_request', subjectId: req.id, action, reason: reason ?? null },
  });
}

/** Moves status only when the request is still in an allowed-from state. */
async function transition(tx: Tx, req: ConsultRequest, from: ConsultStatus[], data: Prisma.ConsultRequestUpdateManyMutationInput) {
  if (!from.includes(req.status)) return false;
  const r = await tx.consultRequest.updateMany({ where: { id: req.id, status: req.status, updatedAt: req.updatedAt }, data });
  return r.count === 1;
}

const wa = (to: string, template: string, vars: Record<string, string>) =>
  messaging().send({ channel: 'whatsapp', to, template, vars, kind: 'service' }).catch(e => console.error('[consult] message failed', template, e));

const todayLabel = () => `היום ${hhmm(new Date())}`;

/** M8: ask the client for more details (a photo, meds, history). new → awaiting_client. */
export async function askDetails(actor: Actor, id: string): Promise<ActionResult> {
  const req = await loadForActor(actor, id);
  if (!req) return { ok: false, error: 'הבקשה לא נמצאה.' };
  if (!FROM.ask.includes(req.status)) return { ok: false, error: 'אי אפשר לבקש פרטים בשלב הזה של הבקשה.' };
  const ok = await db.$transaction(async tx => {
    const moved = await transition(tx, req, FROM.ask, { status: 'awaiting_client', outcomeText: `נשלחה בקשה לפרטים נוספים בוואטסאפ, ${todayLabel()}. ממתינה לתשובה.` });
    if (moved) await decide(tx, actor, req, 'ask_details');
    return moved;
  });
  if (!ok) return FAIL_STALE;
  await wa(req.clientPhone, 'M8_consult_details', { name: firstName(req.clientName), business: req.branch.name, ref: req.ref });
  return { ok: true, message: `ההודעה נשלחה ל${firstName(req.clientName)}` };
}

/** Consult slots for the request's branch (the propose picker). */
export async function slotsForRequest(actor: Actor, id: string): Promise<SlotDay[] | null> {
  const req = await loadForActor(actor, id);
  if (!req) return null;
  const doctors = await consultDoctors(req.branchId, req.branch.medicalResponsibleId);
  return consultSlots(req.branchId, doctors.map(d => d.id));
}

/** M9: propose a real free slot. The client confirms in the WhatsApp chat. new → awaiting_client. */
export async function proposeSlot(actor: Actor, id: string, startsAtIso: string): Promise<ActionResult> {
  const req = await loadForActor(actor, id);
  if (!req) return { ok: false, error: 'הבקשה לא נמצאה.' };
  if (!canRebook(req.status, await liveBookingOf(req.id))) return { ok: false, error: 'אי אפשר להציע מועד בשלב הזה של הבקשה.' };
  const startsAt = new Date(startsAtIso);
  if (Number.isNaN(startsAt.getTime())) return { ok: false, error: 'המועד לא תקין.' };
  const doctors = await consultDoctors(req.branchId, req.branch.medicalResponsibleId);
  const doctor = await firstFreeDoctor(req.branchId, doctors, startsAt);
  if (!doctor) return { ok: false, error: 'המועד כבר לא פנוי. בחרי מועד אחר.' };

  const ok = await db.$transaction(async tx => {
    const nextStatus = req.status === 'new' ? 'awaiting_client' : req.status;
    const moved = await transition(tx, req, [...FROM.schedule, 'consult_scheduled'], {
      status: nextStatus, proposedSlot: startsAt, outcomeText: `הוצע ייעוץ ${slotPhrase(startsAt)} (נשלח ${todayLabel()}). ממתין לאישור המטופלת בוואטסאפ.`,
    });
    if (moved) await decide(tx, actor, req, 'propose_slot', startsAt.toISOString());
    return moved;
  });
  if (!ok) return FAIL_STALE;
  const day = dayLabel(ilDateKey(startsAt));
  const time = hhmm(startsAt);
  await wa(req.clientPhone, 'M9_consult_proposal', {
    name: firstName(req.clientName), business: req.branch.name, doctor: doctor.displayName, day, time,
    fee: String(req.feeAgorot / 100), text: proposeMessage({ first: firstName(req.clientName), business: req.branch.name, doctor: doctor.displayName, day, time, fee: req.feeAgorot / 100 }),
  });
  return { ok: true, message: 'ההצעה נשלחה' };
}

/** The client said yes on WhatsApp: book the proposed slot on their behalf. → consult_scheduled (+ M1). */
export async function confirmProposed(actor: Actor, id: string): Promise<ActionResult> {
  const req = await loadForActor(actor, id);
  if (!req) return { ok: false, error: 'הבקשה לא נמצאה.' };
  if (!req.proposedSlot) return { ok: false, error: 'לא הוצע מועד לבקשה הזו.' };
  if (!canRebook(req.status, await liveBookingOf(req.id))) return { ok: false, error: 'לבקשה כבר נקבע ייעוץ.' };
  const slot = req.proposedSlot;
  if (slot.getTime() < Date.now()) return { ok: false, error: 'המועד שהוצע כבר עבר. הציעי מועד חדש.' };
  const doctors = await consultDoctors(req.branchId, req.branch.medicalResponsibleId);
  const from: ConsultStatus[] = [...FROM.schedule, 'consult_scheduled'];

  const res = await reserveConsult({
    branchId: req.branchId, businessId: req.branch.businessId, branchName: req.branch.name,
    doctorIds: doctors.map(d => d.id), startsAt: slot, format: req.format === 'video' ? 'video' : 'clinic',
    client: { name: req.clientName, phone: req.clientPhone, userId: req.clientUserId },
    feeAgorot: req.feeAgorot, payOnline: false, policy: req.branch.business.depositPolicy,
    attach: async tx => {
      const moved = await transition(tx, req, from, { status: 'consult_scheduled', outcomeText: `נקבע ייעוץ ${slotPhrase(slot)} · אישור נשלח בוואטסאפ.` });
      if (!moved) return null;
      await decide(tx, actor, req, 'confirm_slot', slot.toISOString());
      return req.id;
    },
  });
  if (!res.ok) return res.error === 'conflict' ? FAIL_STALE : { ok: false, error: 'המועד כבר לא פנוי. הציעי מועד אחר.' };
  return { ok: true, message: 'הייעוץ נקבע ואישור נשלח' };
}

/** M10. Medical decline is physician-only; scope/duplicate for any booking-rights staff. */
export async function declineRequest(actor: Actor, id: string, reason: DeclineKey): Promise<ActionResult> {
  const d = DECLINES.find(x => x.key === reason);
  if (!d) return { ok: false, error: 'סיבה לא תקינה.' };
  if (d.physicianOnly && !actor.isPhysician) return { ok: false, error: 'סגירה מסיבה רפואית שמורה לרופא/ה.' };
  const req = await loadForActor(actor, id);
  if (!req) return { ok: false, error: 'הבקשה לא נמצאה.' };
  if (!FROM.decline.includes(req.status)) return { ok: false, error: 'הבקשה כבר סגורה.' };

  const ok = await db.$transaction(async tx => {
    const moved = await transition(tx, req, FROM.decline, {
      status: 'closed_declined', declineReason: reason, decidedById: actor.userId,
      outcomeText: `נסגרה: ${d.name}. ההחלטה נרשמה ביומן הפעולות ואינה ניתנת לעריכה.`,
    });
    if (moved) await decide(tx, actor, req, `decline_${reason}`, d.name);
    return moved;
  });
  if (!ok) return FAIL_STALE;

  // A scheduled consult that is declined is cancelled by the clinic (fee refunded in full).
  const live = await db.booking.findFirst({ where: { consultRequestId: req.id, status: { in: ['pending_payment', 'confirmed'] } }, select: { id: true } });
  if (live) await cancelBooking({ bookingId: live.id, by: 'clinic', reason: 'הבקשה לייעוץ נסגרה', actorId: actor.userId });

  const text = declineMessage(reason, { first: firstName(req.clientName), doctor: actor.displayName });
  await wa(req.clientPhone, 'M10_consult_declined', { name: firstName(req.clientName), business: req.branch.name, reason, text });
  return { ok: true, message: 'התשובה נשלחה' };
}

/** Physician approves treatment after the consult. consult_scheduled → closed_treatment_booked. */
export async function approveTreatment(actor: Actor, id: string, note: string): Promise<ActionResult> {
  if (!actor.isPhysician) return { ok: false, error: 'אישור טיפול שמור לרופא/ה.' };
  const req = await loadForActor(actor, id);
  if (!req) return { ok: false, error: 'הבקשה לא נמצאה.' };
  if (!FROM.approve.includes(req.status)) return { ok: false, error: 'אפשר לאשר טיפול רק אחרי שנקבע ייעוץ.' };
  const clean = note.trim().slice(0, 500);
  const fee = req.feeAgorot / 100;
  const ok = await db.$transaction(async tx => {
    const moved = await transition(tx, req, FROM.approve, {
      status: 'closed_treatment_booked', decidedById: actor.userId,
      outcomeText: `${actor.displayName} אישר/ה טיפול${clean ? `: ${clean.replace(/[.!?]$/, '')}.` : '.'}${fee > 0 ? ` דמי הייעוץ, ₪${fee}, מתקזזים מהטיפול.` : ''}`,
    });
    if (moved) await decide(tx, actor, req, 'approve_treatment', clean || null);
    return moved;
  });
  // TODO(clinic-booking): create the treatment Booking here (C2 steps 1–3) with the consult fee as credit,
  // once the clinic booking screen exposes a create-booking service. Until then staff book it from the calendar.
  if (!ok) return FAIL_STALE;
  return { ok: true, message: 'הטיפול אושר' };
}

// ---------- helpers ----------

async function liveBookingOf(requestId: string) {
  return db.booking.findFirst({ where: { consultRequestId: requestId, status: { in: LIVE_BOOKING } }, select: { id: true } });
}

/** Open and without a live consult booking (a scheduled consult whose booking lapsed may be rebooked). */
function canRebook(status: ConsultStatus, live: { id: string } | null) {
  if (status === 'new' || status === 'awaiting_client') return !live;
  if (status === 'consult_scheduled') return !live;
  return false;
}

async function firstFreeDoctor(branchId: string, doctors: ConsultDoctor[], startsAt: Date) {
  for (const d of doctors) {
    if (await isSlotFree({ branchId, practitionerId: d.id, startsAt, durationMin: CONSULT_SLOT_MIN })) return d;
  }
  return null;
}

// ---------- Actor from the clinic context ----------

/** Branches this member sees, and whether they may take physician-only decisions (doctor, verified license). */
export async function consultActor(c: {
  user: { id: string };
  business: { id: string; branches: Array<{ id: string }> };
  member: { id: string; isOwner: boolean; displayName: string; branchIds: string[] };
  role: string;
  isDoctor: boolean;
}): Promise<Actor> {
  const all = c.business.branches.map(b => b.id);
  const branchIds = c.member.isOwner ? all : all.filter(id => c.member.branchIds.includes(id));
  const lic = c.isDoctor ? await db.staffMember.findUnique({ where: { id: c.member.id }, select: { license: { select: { status: true } } } }) : null;
  return {
    userId: c.user.id,
    businessId: c.business.id,
    branchIds,
    displayName: c.member.displayName,
    role: c.role,
    isPhysician: c.isDoctor && lic?.license?.status === 'verified',
  };
}
