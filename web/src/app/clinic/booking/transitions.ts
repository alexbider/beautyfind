import 'server-only';
import type { Prisma, Profession } from '@prisma/client';
import { hhmm, ilDate } from '@/lib/time';
import { messaging } from '@/lib/vendors/messaging';
import { cancelBooking, manageUrl } from '@/lib/server/booking';
import { canReadDeclaration, type ClinicLevel, type clinicContext } from '@/lib/server/clinic';
import { db } from '@/lib/server/db';
import { seal } from '@/lib/server/secure';
import { siteUrl } from '@/lib/server/site';

// Clinic-side booking transitions (03-states.md "Booking"). Every transition is a conditional
// update on the current status, so two clicks (or two staff) can never move a booking twice.
// Each one leaves a Decision, which the card's log reads back.

export interface ClinicActor {
  userId: string;
  memberId: string;
  businessId: string;
  isOwner: boolean;
  level: ClinicLevel;
  profession: Profession;
  branchIds: string[];
  roleName: string;
  advanced: boolean;
}

export function actorFrom(ctx: Awaited<ReturnType<typeof clinicContext>>): ClinicActor {
  return {
    userId: ctx.user.id,
    memberId: ctx.member.id,
    businessId: ctx.business.id,
    isOwner: ctx.member.isOwner,
    level: ctx.level,
    profession: ctx.profession,
    branchIds: ctx.member.branchIds,
    roleName: ctx.roleName,
    advanced: ctx.advanced,
  };
}

export const bookingInclude = {
  treatment: true,
  practitioner: { include: { license: true, user: { select: { phone: true } } } },
  declaration: true,
  branch: { include: { medicalResponsible: { include: { license: true } } } },
  payments: { include: { documents: true, refunds: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.BookingInclude;
export type ClinicBooking = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

/** The booking if this staff member may see it: same business, their branches, and their own bookings on `own`. */
export async function loadForActor(bookingId: string, a: ClinicActor): Promise<ClinicBooking | null> {
  if (!/^[0-9a-f-]{36}$/i.test(bookingId) || !a.advanced || a.level === 'none') return null;
  const b = await db.booking.findFirst({ where: { id: bookingId, branch: { businessId: a.businessId } }, include: bookingInclude });
  if (!b) return null;
  if (!a.isOwner && a.branchIds.length && !a.branchIds.includes(b.branchId)) return null;
  if (a.level === 'own' && b.practitionerId !== a.memberId) return null;
  return b;
}

export const readerOf = (a: ClinicActor, b: ClinicBooking) => canReadDeclaration({ member: { id: a.memberId } }, b);
export const isValidDecl = (d: ClinicBooking['declaration'], now = new Date()) => !!d && !d.supersededById && d.validUntil > now;
const performsMedical = (p: Profession) => p === 'doctor' || p === 'nurse';

/** checked_in → in_treatment is for the treating practitioner or the branch's doctor. */
export const canStart = (a: ClinicActor, b: ClinicBooking) =>
  a.level !== 'view' && (b.practitionerId === a.memberId || (a.profession === 'doctor' && b.branch.medicalResponsibleId === a.memberId));
/** The clinical record is written by the practitioner performing the treatment. */
export const canFinish = (a: ClinicActor, b: ClinicBooking) => a.level !== 'view' && b.practitionerId === a.memberId;
/** Acknowledging a flagged declaration: a doctor who may read it. */
export const canAck = (a: ClinicActor, b: ClinicBooking) => a.profession === 'doctor' && readerOf(a, b);

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

const E = {
  missing: 'התור לא נמצא, או שאין לך גישה אליו.',
  moved: 'מצב התור השתנה בינתיים. רעננו את העמוד.',
  manage: 'הפעולה הזו דורשת הרשאת ניהול תורים.',
} as const;

async function decide(tx: Prisma.TransactionClient, a: ClinicActor, subjectType: string, subjectId: string, action: string, reason?: string, supersedesDecisionId?: string) {
  return tx.decision.create({ data: { actorId: a.userId, actorRole: a.roleName, subjectType, subjectId, action, reason, supersedesDecisionId } });
}

// ---------- confirmed → checked_in ----------

export async function checkIn(bookingId: string, a: ClinicActor): Promise<Result> {
  const b = await loadForActor(bookingId, a);
  if (!b) return fail(E.missing);
  if (a.level !== 'manage') return fail(E.manage);
  const moved = await db.$transaction(async tx => {
    const r = await tx.booking.updateMany({ where: { id: b.id, status: 'confirmed' }, data: { status: 'checked_in', checkedInAt: new Date() } });
    if (r.count) await decide(tx, a, 'booking', b.id, 'check_in');
    return r.count;
  });
  if (!moved) return fail(E.moved);
  // M4: tell the practitioner the client has arrived.
  const to = b.practitioner?.user?.phone;
  if (to) {
    await messaging().send({
      channel: 'whatsapp', to, template: 'M4_clinic_checked_in', kind: 'service',
      vars: { ref: b.ref, time: hhmm(b.startsAt), link: `${siteUrl()}/clinic/booking/${b.id}` },
    }).catch(e => console.error('[clinic] M4 failed', e));
  }
  return { ok: true };
}

// ---------- physician acknowledgement ----------

export async function ackDeclaration(bookingId: string, a: ClinicActor): Promise<Result> {
  const b = await loadForActor(bookingId, a);
  if (!b) return fail(E.missing);
  if (!canAck(a, b)) return fail('אישור ממצאים בהצהרה שמור לרופא/ה.');
  const d = b.declaration;
  if (!d || !isValidDecl(d) || !d.flagged) return fail(E.moved);
  const ok = await db.$transaction(async tx => ackIn(tx, a, d.id));
  return ok ? { ok: true } : fail('ההצהרה כבר אושרה.');
}

async function ackIn(tx: Prisma.TransactionClient, a: ClinicActor, declarationId: string) {
  const r = await tx.healthDeclaration.updateMany({
    where: { id: declarationId, flagged: true, physicianAckAt: null, supersededById: null },
    data: { physicianAckById: a.memberId, physicianAckAt: new Date() },
  });
  if (r.count) await decide(tx, a, 'health_declaration', declarationId, 'physician_ack');
  return r.count > 0;
}

// ---------- checked_in → in_treatment ----------

export async function startTreatment(bookingId: string, a: ClinicActor): Promise<Result> {
  const b = await loadForActor(bookingId, a);
  if (!b) return fail(E.missing);
  if (!canStart(a, b)) return fail('תחילת הטיפול שמורה למטפל/ת בתור או לרופא/ה האחראי/ת.');
  if (b.treatment?.isMedical && !performsMedical(a.profession)) return fail('טיפול רפואי מתחיל רק על ידי רופא/ה או אח/ות.');

  return db.$transaction(async tx => {
    // Re-read inside the transaction: the guard must hold for the declaration that is linked now.
    const cur = await tx.booking.findUnique({ where: { id: b.id }, include: { declaration: true } });
    if (!cur || cur.status !== 'checked_in') return fail(E.moved);
    const d = cur.declaration;
    if (cur.requiresDeclaration && !isValidDecl(d)) {
      return fail(`אי אפשר להתחיל ${b.treatment?.isMedical ? 'טיפול בהזרקה' : 'את הטיפול'} בלי הצהרת בריאות חתומה.`);
    }
    if (d && isValidDecl(d) && d.flagged && !d.physicianAckAt) {
      if (!canAck(a, b)) return fail('יש ממצאים בהצהרה. אישור הממצאים שמור לרופא/ה.');
      await ackIn(tx, a, d.id);
    }
    const r = await tx.booking.updateMany({
      where: { id: b.id, status: 'checked_in', declarationId: cur.declarationId },
      data: { status: 'in_treatment', startedAt: new Date() },
    });
    if (!r.count) throw new Error('moved');
    await decide(tx, a, 'booking', b.id, 'start');
    return { ok: true } as const;
  }).catch((e: unknown): Result => {
    if (e instanceof Error && e.message === 'moved') return fail(E.moved);
    throw e;
  });
}

// ---------- in_treatment → completed ----------

export interface ClinicalInput { productBatch: string; units: string; notes: string }

export async function finishTreatment(bookingId: string, a: ClinicActor, input: ClinicalInput): Promise<Result> {
  const b = await loadForActor(bookingId, a);
  if (!b) return fail(E.missing);
  if (!canFinish(a, b)) return fail('רישום קליני וסיום הטיפול שמורים למטפל/ת שמבצע/ת את הטיפול.');
  const medical = !!b.treatment?.isMedical;
  if (medical && !performsMedical(a.profession)) return fail('רישום טיפול רפואי שמור לרופא/ה או לאח/ות.');

  const productBatch = String(input.productBatch ?? '').trim().slice(0, 200);
  const notes = String(input.notes ?? '').trim();
  const unitsRaw = String(input.units ?? '').trim();
  if (medical && productBatch.length < 2) return fail('יש לרשום חומר ואצווה.');
  if (notes.length < 2) return fail('יש לכתוב רישום קליני קצר.');
  if (notes.length > 2000) return fail('הרישום הקליני ארוך מדי.');
  if (unitsRaw && !/^\d{1,4}$/.test(unitsRaw)) return fail('מספר היחידות אינו תקין.');
  const units = unitsRaw ? Number(unitsRaw) : null;

  const moved = await db.$transaction(async tx => {
    const r = await tx.booking.updateMany({
      where: { id: b.id, status: 'in_treatment' },
      data: { status: 'completed', finishedAt: new Date(), clinicalEnc: seal({ productBatch, units, notes, recordedBy: a.memberId }) },
    });
    if (r.count) await decide(tx, a, 'booking', b.id, 'finish');
    return r.count;
  });
  if (!moved) return fail(E.moved);

  // TODO(inventory): deduct productBatch × units from the branch's stock (later phase).
  await messaging().send({
    channel: 'whatsapp', to: b.clientPhone, template: 'M5_aftercare', kind: 'service',
    vars: { name: b.clientName, business: b.branch.name, link: `${manageUrl(b.id)}/aftercare` },
  }).catch(e => console.error('[clinic] M5 failed', e));
  // TODO(scheduler): M6 review request 3 days after finishedAt (05-messages.md).
  return { ok: true };
}

// ---------- confirmed → no_show, and undo within 24h ----------

const UNDO_MS = 24 * 3_600_000;

export async function markNoShow(bookingId: string, a: ClinicActor): Promise<Result> {
  const b = await loadForActor(bookingId, a);
  if (!b) return fail(E.missing);
  if (a.level !== 'manage') return fail(E.manage);
  if (b.startsAt.getTime() > Date.now()) return fail('אפשר לסמן ״לא הגיעה״ רק אחרי שעת התור.');
  const moved = await db.$transaction(async tx => {
    const r = await tx.booking.updateMany({ where: { id: b.id, status: 'confirmed', startsAt: { lte: new Date() } }, data: { status: 'no_show' } });
    if (!r.count) return 0;
    // The deposit is kept per the policy shown at booking.
    await tx.payment.updateMany({ where: { bookingId: b.id, purpose: 'deposit', status: 'succeeded' }, data: { status: 'forfeited' } });
    await decide(tx, a, 'booking', b.id, 'no_show');
    return 1;
  });
  return moved ? { ok: true } : fail(E.moved);
}

/** The no-show decision that can still be undone, if any. */
export async function undoableNoShow(bookingId: string) {
  const d = await db.decision.findFirst({ where: { subjectType: 'booking', subjectId: bookingId, action: 'no_show' }, orderBy: { createdAt: 'desc' } });
  if (!d || Date.now() - d.createdAt.getTime() > UNDO_MS) return null;
  const undone = await db.decision.findFirst({ where: { supersedesDecisionId: d.id } });
  return undone ? null : d;
}

export async function undoNoShow(bookingId: string, a: ClinicActor): Promise<Result> {
  const b = await loadForActor(bookingId, a);
  if (!b) return fail(E.missing);
  if (a.level !== 'manage') return fail(E.manage);
  const d = await undoableNoShow(b.id);
  if (!d) return fail('עברו יותר מ־24 שעות, אי אפשר לבטל את הסימון.');
  const moved = await db.$transaction(async tx => {
    const r = await tx.booking.updateMany({ where: { id: b.id, status: 'no_show' }, data: { status: 'confirmed' } });
    if (!r.count) return 0;
    await tx.payment.updateMany({ where: { bookingId: b.id, purpose: 'deposit', status: 'forfeited' }, data: { status: 'succeeded' } });
    await decide(tx, a, 'booking', b.id, 'undo_no_show', undefined, d.id);
    return 1;
  });
  return moved ? { ok: true } : fail(E.moved);
}

// ---------- declaration link (M3) ----------

export async function resendDeclarationLink(bookingId: string, a: ClinicActor): Promise<Result> {
  const b = await loadForActor(bookingId, a);
  if (!b) return fail(E.missing);
  if (a.level !== 'manage') return fail(E.manage);
  if (!b.requiresDeclaration || isValidDecl(b.declaration)) return fail('ההצהרה כבר חתומה.');
  if (!['pending_payment', 'confirmed', 'checked_in'].includes(b.status)) return fail(E.moved);
  const recent = await db.decision.findFirst({
    where: { subjectType: 'booking', subjectId: b.id, action: 'resend_declaration', createdAt: { gt: new Date(Date.now() - 2 * 60_000) } },
  });
  if (recent) return fail('הקישור נשלח לפני רגע. אפשר לשלוח שוב בעוד שתי דקות.');
  await messaging().send({
    channel: 'whatsapp', to: b.clientPhone, template: 'M3_declaration_request', kind: 'service',
    vars: {
      name: b.clientName, business: b.branch.name, treatment: b.treatment?.name ?? 'פגישת ייעוץ',
      date: ilDate(b.startsAt), time: hhmm(b.startsAt), ref: b.ref, link: `${manageUrl(b.id)}/declaration`,
    },
  });
  await db.decision.create({ data: { actorId: a.userId, actorRole: a.roleName, subjectType: 'booking', subjectId: b.id, action: 'resend_declaration' } });
  return { ok: true };
}

// ---------- confirmed → cancelled_clinic ----------

export async function cancelByClinic(bookingId: string, a: ClinicActor, reasonRaw: string): Promise<Result> {
  const b = await loadForActor(bookingId, a);
  if (!b) return fail(E.missing);
  if (a.level !== 'manage') return fail(E.manage);
  const reason = String(reasonRaw ?? '').trim();
  if (reason.length < 2 || reason.length > 300) return fail('כתבו סיבה קצרה לביטול. היא נשלחת למטופלת.');
  const r = await cancelBooking({ bookingId: b.id, by: 'clinic', reason, actorId: a.userId });
  if (!r.ok) return fail(r.error === 'not_cancellable' ? 'אפשר לבטל רק תור מאושר שעוד לא התחיל.' : E.missing);
  await db.decision.create({ data: { actorId: a.userId, actorRole: a.roleName, subjectType: 'booking', subjectId: b.id, action: 'cancel', reason } });
  return { ok: true };
}
