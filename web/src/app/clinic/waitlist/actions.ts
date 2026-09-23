'use server';

import { z } from 'zod';
import { requireClinic } from '@/lib/server/clinic';
import { db } from '@/lib/server/db';
import { offerSlotToNext } from '../../w/offers';
import { accessibleBranches } from './data';

// Clinic waitlist actions. Every call re-checks the session, the plan and the waitlist:manage level,
// and that the branch belongs to this member.

export type OfferSlotResult = { ok: true; sentTo: string } | { ok: false; error: 'forbidden' | 'invalid' | 'no_match' };
export type RemoveResult = { ok: true } | { ok: false; error: 'forbidden' | 'invalid' };

async function manage(branchId: string) {
  try {
    const ctx = await requireClinic('waitlist', 'manage');
    return accessibleBranches(ctx).some(b => b.id === branchId) ? ctx : null;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('forbidden')) return null;
    throw e;
  }
}

const offerSchema = z.object({ branchId: z.guid(), treatmentId: z.guid(), practitionerId: z.guid().nullable(), startsAt: z.iso.datetime() });

/** "Offer now": the free slot goes to the first matching entry in join order (M7 with the hold timer). */
export async function offerSlotAction(input: z.infer<typeof offerSchema>): Promise<OfferSlotResult> {
  const p = offerSchema.safeParse(input);
  if (!p.success) return { ok: false, error: 'invalid' };
  if (!(await manage(p.data.branchId))) return { ok: false, error: 'forbidden' };
  const t = await db.treatment.findFirst({ where: { id: p.data.treatmentId, branchId: p.data.branchId }, select: { id: true } });
  if (!t) return { ok: false, error: 'invalid' };
  const id = await offerSlotToNext({ branchId: p.data.branchId, treatmentId: t.id, practitionerId: p.data.practitionerId, startsAt: new Date(p.data.startsAt) });
  if (!id) return { ok: false, error: 'no_match' };
  const o = await db.waitlistOffer.findUnique({ where: { id }, select: { entry: { select: { clientName: true } } } });
  return { ok: true, sentTo: o?.entry.clientName ?? '' };
}

/** Removes someone from the queue (status left). An open offer held for them moves on to the next match. */
export async function removeEntryAction(input: { branchId: string; entryId: string }): Promise<RemoveResult> {
  const p = z.object({ branchId: z.guid(), entryId: z.guid() }).safeParse(input);
  if (!p.success) return { ok: false, error: 'invalid' };
  if (!(await manage(p.data.branchId))) return { ok: false, error: 'forbidden' };
  const e = await db.waitlistEntry.findFirst({ where: { id: p.data.entryId, branchId: p.data.branchId }, select: { id: true } });
  if (!e) return { ok: false, error: 'invalid' };
  const { entryToken, leaveWaitlist } = await import('../../waitlist/entries');
  await leaveWaitlist(entryToken(e.id));
  return { ok: true };
}
