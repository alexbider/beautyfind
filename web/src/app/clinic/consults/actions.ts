'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { DECLINES, type SlotDay } from '@/components/consult/constants';
import {
  approveTreatment, askDetails, confirmProposed, consultActor, declineRequest, proposeSlot, slotsForRequest,
  type ActionResult, type Actor,
} from '@/components/consult/service';
import { requireClinic } from '@/lib/server/clinic';

// Every action re-checks the session, the plan and consults:manage. Physician-only decisions
// (medical decline, treatment approval) are re-checked in the service against a verified doctor.

const Id = z.uuid();
const PATH = '/clinic/consults';
const DENIED: ActionResult = { ok: false, error: 'אין לך הרשאה לפעולה הזו. בעלי העסק יכולים לפתוח אותה בהגדרות הצוות.' };
const BROKEN: ActionResult = { ok: false, error: 'הפעולה נכשלה בצד שלנו. נסו שוב בעוד רגע.' };

async function actor(): Promise<Actor | null> {
  try {
    return await consultActor(await requireClinic('consults', 'manage'));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('forbidden')) return null;
    throw e;
  }
}

async function run(id: unknown, fn: (a: Actor, id: string) => Promise<ActionResult>): Promise<ActionResult> {
  const parsed = Id.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'הבקשה לא נמצאה.' };
  const a = await actor();
  if (!a) return DENIED;
  try {
    const res = await fn(a, parsed.data);
    if (res.ok) revalidatePath(PATH);
    return res;
  } catch (e) {
    console.error('[consults] action failed', e);
    return BROKEN;
  }
}

export async function askDetailsAction(id: string) {
  return run(id, askDetails);
}

export async function proposeSlotAction(id: string, startsAt: string) {
  const at = z.iso.datetime().safeParse(startsAt);
  if (!at.success) return { ok: false, error: 'המועד לא תקין.' } satisfies ActionResult;
  return run(id, (a, rid) => proposeSlot(a, rid, at.data));
}

export async function confirmProposedAction(id: string) {
  return run(id, confirmProposed);
}

const Reason = z.enum(DECLINES.map(d => d.key) as ['medical', 'scope', 'duplicate']);

export async function declineAction(id: string, reason: string) {
  const r = Reason.safeParse(reason);
  if (!r.success) return { ok: false, error: 'בחרי סיבה.' } satisfies ActionResult;
  return run(id, (a, rid) => declineRequest(a, rid, r.data));
}

export async function approveTreatmentAction(id: string, note: string) {
  const n = z.string().max(500).safeParse(note);
  if (!n.success) return { ok: false, error: 'ההערה ארוכה מדי.' } satisfies ActionResult;
  return run(id, (a, rid) => approveTreatment(a, rid, n.data));
}

/** Free consult slots for the request's branch (the propose picker). */
export async function proposeSlotsAction(id: string): Promise<{ ok: true; days: SlotDay[] } | { ok: false; error: string }> {
  const parsed = Id.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'הבקשה לא נמצאה.' };
  const a = await actor();
  if (!a) return DENIED as { ok: false; error: string };
  try {
    const days = await slotsForRequest(a, parsed.data);
    return days ? { ok: true, days } : { ok: false, error: 'הבקשה לא נמצאה.' };
  } catch (e) {
    console.error('[consults] slots failed', e);
    return { ok: false, error: 'לא הצלחנו לטעון מועדים. נסו שוב.' };
  }
}
