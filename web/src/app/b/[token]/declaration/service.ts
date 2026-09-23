import 'server-only';
import type { BookingStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  LIMITS, MAX_SIGNATURE_BYTES, MIN_INK_POINTS, QUESTIONNAIRE_VERSION, QUESTIONS, nameOk,
  type DeclType, type SealedDeclaration,
} from '@/components/declaration/questions';
import { hhmm, ilDate } from '@/lib/time';
import { messaging } from '@/lib/vendors/messaging';
import { db } from '@/lib/server/db';
import { saveUpload } from '@/lib/server/media';
import { open, seal } from '@/lib/server/secure';
import { siteUrl } from '@/lib/server/site';
import { checkSignaturePng } from './png';

// Health declaration (03-states.md "Health declaration"): draft → signed → (flagged) → acknowledged,
// signed → expired (12 months), signed → superseded (the client updates the answers).

/** Bookings a declaration can still be signed for or linked to. */
export const SIGNABLE: BookingStatus[] = ['pending_payment', 'confirmed', 'checked_in'];
const GONE: BookingStatus[] = ['cancelled_client', 'cancelled_clinic', 'abandoned'];
const VALID_MONTHS = 12;

export async function loadDeclarationBooking(bookingId: string) {
  const b = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      treatment: true,
      practitioner: { include: { license: true, user: { select: { phone: true } } } },
      declaration: true,
      branch: {
        include: {
          business: { select: { id: true, ownerUserId: true, staff: { where: { isOwner: true }, select: { userId: true } } } },
          medicalResponsible: { include: { license: true, user: { select: { phone: true } } } },
        },
      },
    },
  });
  if (!b || !b.requiresDeclaration || GONE.includes(b.status)) return null;
  return b;
}
export type DeclarationBooking = NonNullable<Awaited<ReturnType<typeof loadDeclarationBooking>>>;

/** Medical questionnaire for medical treatments and consults, cosmetic otherwise. */
export const declTypeFor = (b: Pick<DeclarationBooking, 'kind' | 'treatment'>): DeclType =>
  b.treatment ? (b.treatment.isMedical ? 'medical' : 'cosmetic') : b.kind === 'consult' ? 'medical' : 'cosmetic';

export const isValidDeclaration = (d: { supersededById: string | null; validUntil: Date } | null | undefined, now = new Date()) =>
  !!d && !d.supersededById && d.validUntil > now;

/** Same client at the same business: same user account, or the same phone for guests. */
function sameClientWhere(b: DeclarationBooking, type: DeclType): Prisma.HealthDeclarationWhereInput {
  const businessId = b.branch.businessId;
  const or: Prisma.HealthDeclarationWhereInput[] = [{ bookings: { some: { clientPhone: b.clientPhone, branch: { businessId } } } }];
  if (b.clientUserId) or.push({ clientUserId: b.clientUserId, bookings: { some: { branch: { businessId } } } });
  return { type, supersededById: null, OR: or };
}

/** A valid declaration of this client that this booking could reuse (not the one already linked). */
export async function findReusable(b: DeclarationBooking) {
  const type = declTypeFor(b);
  return db.healthDeclaration.findFirst({
    where: { ...sameClientWhere(b, type), validUntil: { gt: new Date() }, ...(b.declarationId ? { id: { not: b.declarationId } } : {}) },
    orderBy: { signedAt: 'desc' },
    select: { id: true, signedAt: true, validUntil: true, flagged: true },
  });
}

/** Counts "yes" answers for the client's own success screen (the token holder is the client). */
export function yesCount(answersEnc: string) {
  try {
    return open<SealedDeclaration>(answersEnc).answers.filter(a => a.yes).length;
  } catch {
    return 0;
  }
}

// ---------- Submit ----------

const Input = z.object({
  answers: z.record(z.string(), z.object({ yes: z.boolean(), detail: z.string().max(LIMITS.detail) })),
  meds: z.string().max(LIMITS.meds),
  noMeds: z.boolean(),
  name: z.string().max(LIMITS.name),
  birthDate: z.string().max(10).optional(),
  idLast4: z.string().max(4).optional(),
  attest: z.literal(true),
  mode: z.enum(['drawn', 'typed']),
  ink: z.number().int().min(0).max(100000),
  typedConsent: z.boolean(),
});
export type DeclarationInput = z.input<typeof Input>;

export type SubmitResult =
  | { ok: true; signedAt: string; yes: number }
  | { ok: false; error: string };

const ERR = {
  gone: 'התור הזה כבר לא פתוח לחתימה. אפשר לפנות לקליניקה.',
  invalid: 'חלק מהפרטים אינם תקינים. בדקי את הטופס ונסי שוב.',
  answers: 'יש לענות על כל שאלות השאלון.',
  meds: 'רשמי תרופות קבועות, או סמני ״אין תרופות קבועות״',
  name: 'כתבי שם פרטי ושם משפחה',
  sig: 'חסרה חתימה',
  sigBig: 'קובץ החתימה גדול מדי. נקי את החתימה ונסי שוב.',
  typed: 'יש לאשר שהקלדת השם מהווה חתימה',
  birth: 'תאריך הלידה אינו תקין',
  id: 'יש להקליד 4 ספרות בדיוק',
  server: 'השליחה נכשלה. נסי שוב בעוד רגע.',
} as const;

function validBirthDate(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1) return false;
  const age = (Date.now() - d.getTime()) / (365.25 * 86_400_000);
  return age > 0 && age < 120;
}

/**
 * Validates, seals and stores a signed declaration, then links it to the booking.
 * Earlier declarations of this client at this business (same type) are superseded, and open
 * bookings that pointed at them move to the new one.
 */
export async function submitDeclaration(bookingId: string, raw: unknown, png: Buffer): Promise<SubmitResult> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: ERR.invalid };
  const inp = parsed.data;

  const b = await loadDeclarationBooking(bookingId);
  if (!b || !SIGNABLE.includes(b.status)) return { ok: false, error: ERR.gone };
  const type = declTypeFor(b);
  const qs = QUESTIONS[type];

  // Every question answered, and nothing else.
  const keys = Object.keys(inp.answers);
  if (keys.length !== qs.length || !qs.every(q => q.key in inp.answers)) return { ok: false, error: ERR.answers };
  const meds = inp.meds.trim();
  if (!inp.noMeds && meds.length < 2) return { ok: false, error: ERR.meds };
  const name = inp.name.trim().replace(/\s+/g, ' ');
  if (!nameOk(name)) return { ok: false, error: ERR.name };
  if (inp.birthDate && !validBirthDate(inp.birthDate)) return { ok: false, error: ERR.birth };
  if (inp.idLast4 && !/^\d{4}$/.test(inp.idLast4)) return { ok: false, error: ERR.id };
  if (inp.mode === 'drawn' && inp.ink < MIN_INK_POINTS) return { ok: false, error: ERR.sig };
  if (inp.mode === 'typed' && !inp.typedConsent) return { ok: false, error: ERR.typed };
  const pngCheck = checkSignaturePng(png, MAX_SIGNATURE_BYTES);
  if (!pngCheck.ok) return { ok: false, error: pngCheck.error === 'too_big' ? ERR.sigBig : ERR.sig };

  const answers = qs.map(q => {
    const a = inp.answers[q.key];
    return { key: q.key, yes: a.yes, detail: a.yes ? a.detail.trim() : '' };
  });
  const yes = answers.filter(a => a.yes).length;
  const sealed: SealedDeclaration = {
    answers,
    medications: inp.noMeds ? '' : meds,
    noMedications: inp.noMeds,
    ...(inp.birthDate ? { birthDate: inp.birthDate } : {}),
    ...(inp.idLast4 ? { idLast4: inp.idLast4 } : {}),
    signatureMode: inp.mode,
  };

  // The PNG is private. Guests have no account, so the business owner owns the file record.
  const ownerId = b.clientUserId ?? b.branch.business.ownerUserId ?? b.branch.business.staff.find(s => s.userId)?.userId;
  if (!ownerId) return { ok: false, error: ERR.server };
  const file = new File([new Uint8Array(png)], 'signature.png', { type: 'image/png' });
  const up = await saveUpload(file, { ownerId, businessId: b.branch.businessId, isPrivate: true, alt: 'חתימה על הצהרת בריאות' });
  if (!up.ok) return { ok: false, error: ERR.sig };

  const signedAt = new Date();
  const validUntil = new Date(signedAt);
  validUntil.setMonth(validUntil.getMonth() + VALID_MONTHS);

  try {
    await db.$transaction(async tx => {
      const decl = await tx.healthDeclaration.create({
        data: {
          clientUserId: b.clientUserId, type, questionnaireVersion: QUESTIONNAIRE_VERSION,
          answersEnc: seal(sealed), flagged: yes > 0, signedName: name, signatureKey: up.id, signedAt, validUntil,
        },
      });
      // The newest signed answers are the truth: they supersede this client's earlier declarations here.
      const replaced = await tx.healthDeclaration.findMany({ where: { ...sameClientWhere(b, type), id: { not: decl.id } }, select: { id: true } });
      if (replaced.length) {
        const ids = replaced.map(r => r.id);
        await tx.healthDeclaration.updateMany({ where: { id: { in: ids }, supersededById: null }, data: { supersededById: decl.id } });
        await tx.booking.updateMany({ where: { declarationId: { in: ids }, status: { in: SIGNABLE } }, data: { declarationId: decl.id } });
      }
      const linked = await tx.booking.updateMany({ where: { id: b.id, status: { in: SIGNABLE } }, data: { declarationId: decl.id } });
      if (linked.count !== 1) throw new Error('booking_closed');
    });
    if (yes > 0) await notifyFlagged(b).catch(e => console.error('[declaration] M4 failed', e));
  } catch (e) {
    await db.mediaFile.delete({ where: { id: up.id } }).catch(() => {});
    if (e instanceof Error && e.message === 'booking_closed') return { ok: false, error: ERR.gone };
    console.error('[declaration] submit failed', e);
    return { ok: false, error: ERR.server };
  }
  return { ok: true, signedAt: signedAt.toISOString(), yes };
}

/** Links an existing valid declaration of the same client to this booking. */
export async function reuseDeclaration(bookingId: string, declarationId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const b = await loadDeclarationBooking(bookingId);
  if (!b || !SIGNABLE.includes(b.status)) return { ok: false, error: ERR.gone };
  const d = await findReusable(b);
  if (!d || d.id !== declarationId) return { ok: false, error: 'ההצהרה הקודמת כבר לא בתוקף. יש למלא הצהרה חדשה.' };
  const linked = await db.booking.updateMany({ where: { id: b.id, status: { in: SIGNABLE } }, data: { declarationId: d.id } });
  if (linked.count !== 1) return { ok: false, error: ERR.gone };
  if (d.flagged) await notifyFlagged(b).catch(e => console.error('[declaration] M4 failed', e));
  return { ok: true };
}

/** M4 to the treating practitioner and the branch's doctor: flagged declaration. No health details in the message. */
async function notifyFlagged(b: DeclarationBooking) {
  const phones = new Set([b.practitioner?.user?.phone, b.branch.medicalResponsible?.user?.phone].filter((p): p is string => !!p));
  for (const to of phones) {
    await messaging().send({
      channel: 'whatsapp', to, template: 'M4_clinic_declaration_flagged', kind: 'service',
      vars: { ref: b.ref, date: ilDate(b.startsAt), time: hhmm(b.startsAt), link: `${siteUrl()}/clinic/booking/${b.id}` },
    });
  }
}
