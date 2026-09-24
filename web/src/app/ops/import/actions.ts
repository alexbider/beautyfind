'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { importerOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import {
  approvePlace, createRun, dispatchWorker, editPlace, markDuplicate, mergePlace, rejectPlace, restorePlace, setRunStatus, type OpResult,
} from '@/lib/server/importOps';

const refresh = () => {
  revalidatePath('/ops/import');
  revalidatePath('/ops/import/review');
};

export type StartResult = { ok: true; runId: string; dispatched: boolean; reason?: string } | { ok: false; error: string };

export async function startRunAction(input: { label: string; scope: unknown; maxRequests: number; maxExtractions: number | null }): Promise<StartResult> {
  const user = await importerOrNull();
  if (!user) return { ok: false, error: 'forbidden' };
  try {
    const run = await createRun(user, input);
    const d = await dispatchWorker(run.id);
    refresh();
    return { ok: true, runId: run.id, ...d };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'failed' };
  }
}

export async function runControlAction(runId: string, action: 'pause' | 'resume' | 'cancel' | 'kick'): Promise<{ ok: boolean; dispatched?: boolean; reason?: string }> {
  const user = await importerOrNull();
  if (!user || !z.uuid().safeParse(runId).success) return { ok: false };
  if (action !== 'kick') await setRunStatus(runId, action);
  const d = action === 'resume' || action === 'kick' ? await dispatchWorker(runId) : undefined;
  refresh();
  return { ok: true, ...d };
}

const Op = z.discriminatedUnion('op', [
  z.object({ op: z.literal('approve') }),
  z.object({ op: z.literal('merge'), branchId: z.uuid() }),
  z.object({ op: z.literal('reject'), note: z.string().max(300).nullable() }),
  z.object({ op: z.literal('duplicate'), ofId: z.uuid() }),
  z.object({ op: z.literal('restore') }),
  z.object({
    op: z.literal('edit'),
    fields: z.object({
      name: z.string().max(120).optional(),
      phone: z.string().max(30).optional(),
      email: z.string().max(120).optional(),
      website: z.string().max(300).optional(),
      categories: z.array(z.string()).max(14).optional(),
      citySlug: z.string().max(40).nullable().optional(),
    }),
  }),
]);

export async function placeAction(id: string, input: z.input<typeof Op>): Promise<OpResult> {
  const user = await importerOrNull();
  if (!user) return { ok: false, error: 'forbidden' };
  const parsed = Op.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(id).success) return { ok: false, error: 'invalid' };
  const a = parsed.data;
  const r =
    a.op === 'approve' ? await approvePlace(user, id)
    : a.op === 'merge' ? await mergePlace(user, id, a.branchId)
    : a.op === 'reject' ? await rejectPlace(user, id, a.note)
    : a.op === 'duplicate' ? await markDuplicate(user, id, a.ofId)
    : a.op === 'restore' ? await restorePlace(user, id)
    : await editPlace(user, id, a.fields);
  refresh();
  return r;
}

/** Approves the given records that are "ready" (never "needs_review"); stops at the first system error. */
export async function bulkApproveAction(ids: string[]): Promise<{ ok: boolean; approved: number; skipped: number }> {
  const user = await importerOrNull();
  if (!user) return { ok: false, approved: 0, skipped: 0 };
  const list = z.array(z.uuid()).max(100).safeParse(ids);
  if (!list.success) return { ok: false, approved: 0, skipped: 0 };
  const ready = await db.importPlace.findMany({ where: { id: { in: list.data }, status: 'ready' }, select: { id: true } });
  let approved = 0;
  for (const { id } of ready) if ((await approvePlace(user, id)).ok) approved++;
  refresh();
  return { ok: true, approved, skipped: list.data.length - approved };
}
