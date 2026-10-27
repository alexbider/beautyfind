import 'server-only';
import { open, seal } from './secure';

// Health answers on a consultation request (the goal in the client's words, previous injections, medical flags)
// are stored sealed with DATA_KEY in medical_enc, like health declarations. Older rows may still hold them in the
// plain columns until the backfill (scripts/seal-consults.ts) has run; reads handle both.

export interface ConsultMedical { goal: string; prior: string; flags: string[] }

/** The fields to store for new answers: sealed blob plus empty plain columns. */
export function sealConsultMedical(m: ConsultMedical) {
  return { medicalEnc: seal(m), goal: '', priorInjections: '', medicalFlags: [] as string[] };
}

/** The answers of one request, from the sealed blob when present. */
export function consultMedical(r: { medicalEnc: string | null; goal: string; priorInjections: string; medicalFlags: string[] }): ConsultMedical {
  if (r.medicalEnc) {
    try {
      const m = open<ConsultMedical>(r.medicalEnc);
      return { goal: m.goal ?? '', prior: m.prior ?? '', flags: Array.isArray(m.flags) ? m.flags : [] };
    } catch (e) {
      console.error('[consult] cannot open sealed answers', e instanceof Error ? e.message : e);
      return { goal: '', prior: '', flags: [] };
    }
  }
  return { goal: r.goal, prior: r.priorInjections, flags: r.medicalFlags };
}
