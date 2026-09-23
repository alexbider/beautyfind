'use server';

import { z } from 'zod';
import { AREAS, FLAGS, FORMATS, GOAL_MAX, GOAL_MIN, NAME_MAX, PRIOR, TIMES } from '@/components/consult/constants';
import { submitConsultRequest } from '@/components/consult/service';
import { toE164 } from '@/lib/format';
import { currentUser } from '@/lib/server/session';

const keys = <T extends { key: string }>(xs: readonly T[]) => xs.map(x => x.key) as [T['key'], ...T['key'][]];

const Payload = z.object({
  branchId: z.uuid(),
  treatmentId: z.uuid().nullable(),
  name: z.string().trim().min(2).max(NAME_MAX),
  phone: z.string().max(20),
  areas: z.array(z.enum(AREAS)).min(1).max(AREAS.length),
  goal: z.string().trim().min(GOAL_MIN).max(GOAL_MAX),
  prior: z.enum(keys(PRIOR)),
  format: z.enum(keys(FORMATS)),
  slot: z.iso.datetime().nullable(),
  noFit: z.boolean(),
  times: z.array(z.enum(keys(TIMES))).max(TIMES.length),
  days: z.array(z.number().int().min(0).max(6)).max(7),
  flags: z.array(z.enum(keys(FLAGS))).max(FLAGS.length),
  consent: z.literal(true),
});

export type ConsultPayload = z.input<typeof Payload>;

export type ConsultSubmitResult =
  | { ok: true; ref: string; scheduled: boolean; slot: string | null; manageHref: string | null; checkoutUrl: string | null }
  | { ok: false; code: 'invalid' | 'slot_taken' | 'rate' | 'not_available' | 'server'; message: string };

const MSG = {
  invalid: 'חלק מהפרטים חסרים או לא תקינים. בדקי את הטופס ונסי שוב.',
  slot_taken: 'המועד שבחרת נתפס הרגע. בחרי מועד אחר מהרשימה המעודכנת.',
  rate: 'כבר נשלחו מהמספר הזה כמה בקשות היום. הקליניקה תחזור אלייך עליהן.',
  not_available: 'הקליניקה לא מקבלת כרגע בקשות ייעוץ אונליין. אפשר לפנות אליה דרך עמוד הפרופיל.',
  server: 'השליחה נכשלה בצד שלנו. הפרטים נשמרו בטופס, נסי שוב בעוד רגע.',
} as const;

const fail = (code: keyof typeof MSG): ConsultSubmitResult => ({ ok: false, code, message: MSG[code] });

export async function submitConsult(input: ConsultPayload): Promise<ConsultSubmitResult> {
  const parsed = Payload.safeParse(input);
  if (!parsed.success) return fail('invalid');
  const p = parsed.data;

  const phone = toE164(p.phone);
  if (!phone) return fail('invalid');
  // Either a real slot, or "no slot fits" with at least one time range.
  if (p.noFit ? p.times.length === 0 || p.slot !== null : p.slot === null) return fail('invalid');

  try {
    const user = await currentUser();
    const res = await submitConsultRequest({
      branchId: p.branchId,
      treatmentId: p.treatmentId,
      client: { name: p.name, phone, userId: user?.kind === 'client' ? user.id : null, email: user?.kind === 'client' ? user.email : null },
      areas: [...new Set(p.areas)],
      goal: p.goal,
      prior: p.prior,
      format: p.format,
      slot: p.noFit ? null : new Date(p.slot!),
      preferredTimes: p.noFit ? [...new Set(p.times)] : [],
      preferredDays: p.noFit ? [...new Set(p.days)].sort() : [],
      flags: [...new Set(p.flags)],
    });
    if (!res.ok) return fail(res.error);
    return {
      ok: true,
      ref: res.ref,
      scheduled: res.status === 'consult_scheduled',
      slot: res.slot,
      manageHref: res.token ? `/b/${res.token}` : null,
      checkoutUrl: res.checkoutUrl,
    };
  } catch (e) {
    console.error('[consult] submit failed', e);
    return fail('server');
  }
}
