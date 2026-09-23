'use server';

import { db } from '@/lib/server/db';
import { PUBLIC_WHERE } from '@/lib/server/public';
import { cleanIds, clientUser, savedCards, savedIdsOf } from './data';
import type { SavedCard } from './types';

// Saved clinics (SavedClinic). Signed-in clients write to the table; guests keep ids in
// localStorage['bf-saved'] and only use publicSavedCards to render them.

export type SetSavedResult = { ok: true } | { ok: false; reason: 'signed_out' | 'not_found' };

/** Save or unsave one branch for the signed-in client. */
export async function setSavedAction(branchId: string, on: boolean): Promise<SetSavedResult> {
  const user = await clientUser();
  if (!user) return { ok: false, reason: 'signed_out' };
  const [id] = cleanIds([branchId], 1);
  if (!id) return { ok: false, reason: 'not_found' };
  if (!on) {
    await db.savedClinic.deleteMany({ where: { userId: user.id, branchId: id } });
    return { ok: true };
  }
  const branch = await db.branch.findFirst({ where: { AND: [PUBLIC_WHERE, { id }] }, select: { id: true } });
  if (!branch) return { ok: false, reason: 'not_found' };
  await db.savedClinic.upsert({ where: { userId_branchId: { userId: user.id, branchId: id } }, create: { userId: user.id, branchId: id }, update: {} });
  return { ok: true };
}

/**
 * One-time merge of a browser's localStorage list into the signed-in client's SavedClinic rows.
 * Returns every saved id, newest first; the caller clears localStorage when this resolves.
 */
export async function mergeLocalSaved(ids: string[]): Promise<{ ok: boolean; ids: string[] }> {
  const user = await clientUser();
  if (!user) return { ok: false, ids: [] };
  const wanted = cleanIds(ids);
  if (wanted.length) {
    const live = await db.branch.findMany({ where: { AND: [PUBLIC_WHERE, { id: { in: wanted } }] }, select: { id: true } });
    const liveIds = new Set(live.map(b => b.id));
    await db.savedClinic.createMany({
      data: wanted.filter(id => liveIds.has(id)).map(branchId => ({ userId: user.id, branchId })),
      skipDuplicates: true,
    });
  }
  return { ok: true, ids: (await savedIdsOf(user.id)).map(r => r.branchId) };
}

/** Public cards for a list of ids (guests' localStorage list, or ids the page has not loaded yet). */
export async function publicSavedCards(ids: string[]): Promise<SavedCard[]> {
  const clean = cleanIds(ids, 60);
  const user = await clientUser();
  if (!user) return savedCards(clean);
  const rows = await db.savedClinic.findMany({ where: { userId: user.id, branchId: { in: clean } }, select: { branchId: true, savedAt: true } });
  return savedCards(clean, new Map(rows.map(r => [r.branchId, r.savedAt])));
}
