'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { importerOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import {
  approvePlace, createRun, dispatchWorker, editPlace, enrichSelected, markDuplicate, mergePlace, reconcileTask, rejectPlace, restorePlace, retryIncomplete,
  getSettings, saveSettings, setRunStatus, type CreateRunInput, type OpResult,
} from '@/lib/server/importOps';
import { googleLookup, type GoogleLookup } from '@/lib/server/googleDisplay';
import { copyPendingImages } from '@/lib/server/importEnhance';
import type { ImportSettings } from '@/lib/import/settings';

const refresh = () => {
  revalidatePath('/ops/import');
  revalidatePath('/ops/import/review');
};
const refreshPaths = refresh;

export type StartResult = { ok: true; runId: string; dispatched: boolean; reason?: string } | { ok: false; error: string };

export async function startRunAction(input: CreateRunInput): Promise<StartResult> {
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

export async function saveSettingsAction(values: Partial<ImportSettings>): Promise<{ ok: boolean; settings?: ImportSettings }> {
  const user = await importerOrNull();
  if (!user) return { ok: false };
  const settings = await saveSettings(user, values);
  refresh();
  return { ok: true, settings };
}

export async function reconcileAction(taskId: string, billed: boolean, retry: boolean): Promise<{ ok: boolean; dispatched?: boolean }> {
  const user = await importerOrNull();
  if (!user || !z.uuid().safeParse(taskId).success) return { ok: false };
  const r = await reconcileTask(user, taskId, billed, retry);
  if (!r.ok) return { ok: false };
  const t = retry ? await db.importTask.findUnique({ where: { id: taskId }, select: { runId: true } }) : null;
  const d = t ? await dispatchWorker(t.runId) : undefined;
  refresh();
  return { ok: true, dispatched: d?.dispatched };
}

export async function enrichSelectedAction(ids: string[]): Promise<{ ok: boolean; count: number; dispatched?: boolean }> {
  const user = await importerOrNull();
  const list = z.array(z.uuid()).max(200).safeParse(ids);
  if (!user || !list.success) return { ok: false, count: 0 };
  const r = await enrichSelected(user, list.data);
  let dispatched: boolean | undefined;
  for (const id of r.runIds) dispatched = (await dispatchWorker(id)).dispatched;
  refresh();
  return { ok: true, count: r.count, dispatched };
}

export async function googleLookupAction(placeId: string, feature: 'verify' | 'rating' | 'photo'): Promise<GoogleLookup> {
  const user = await importerOrNull();
  if (!user) return { ok: false, error: 'forbidden' };
  if (!['verify', 'rating', 'photo'].includes(feature)) return { ok: false, error: 'invalid' };
  return googleLookup(user, placeId, feature);
}

export async function runControlAction(runId: string, action: 'pause' | 'resume' | 'cancel' | 'kick' | 'retry'): Promise<{ ok: boolean; dispatched?: boolean; reason?: string; count?: number }> {
  const user = await importerOrNull();
  if (!user || !z.uuid().safeParse(runId).success) return { ok: false };
  let count: number | undefined;
  if (action === 'retry') count = await retryIncomplete(runId);
  else if (action !== 'kick') await setRunStatus(runId, action);
  const d = action === 'resume' || action === 'kick' || (action === 'retry' && count) ? await dispatchWorker(runId) : undefined;
  refresh();
  return { ok: true, count, ...d };
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
      logoUrl: z.string().url().max(2000).nullable().optional(),
      photoUrls: z.array(z.string().url().max(2000)).max(20).optional(),
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

/** Publishes every "ready" record in a run, up to 40 per click (each one copies its images) so a request never runs too long. */
export async function publishEligibleAction(runId: string): Promise<{ ok: boolean; approved: number; left: number }> {
  const user = await importerOrNull();
  if (!user || !z.uuid().safeParse(runId).success) return { ok: false, approved: 0, left: 0 };
  const ready = await db.importPlace.findMany({ where: { runId, status: 'ready' }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: 40 });
  let approved = 0;
  for (const { id } of ready) if ((await approvePlace(user, id)).ok) approved++;
  const left = await db.importPlace.count({ where: { runId, status: 'ready' } });
  await db.auditLog.create({ data: { actorId: user.id, action: 'import_publish_run', subjectType: 'import_run', subjectId: runId, meta: { approved, left } } });
  refresh();
  return { ok: true, approved, left };
}

/** Starts an enhance run for the chosen approved records' listings (website re-read; provider refresh optional). */
export async function enhanceApprovedAction(ids: string[], refresh: boolean): Promise<{ ok: boolean; count: number; dispatched?: boolean }> {
  const user = await importerOrNull();
  const list = z.array(z.uuid()).max(500).safeParse(ids);
  if (!user || !list.success) return { ok: false, count: 0 };
  const places = await db.importPlace.findMany({ where: { id: { in: list.data }, status: { in: ['approved', 'merged'] }, branchId: { not: null } }, select: { branchId: true } });
  const branchIds = [...new Set(places.map(p => p.branchId!))];
  if (!branchIds.length) return { ok: true, count: 0 };
  try {
    const run = await createRun(user, { label: `העשרת ${branchIds.length} עסקים שנבחרו`, provider: 'enhance', scope: { branchIds, refresh }, recordLimit: branchIds.length, budgetUsd: refresh ? 0.5 : 0 });
    const d = await dispatchWorker(run.id);
    refreshPaths();
    return { ok: true, count: branchIds.length, dispatched: d.dispatched };
  } catch {
    return { ok: false, count: 0 };
  }
}

/** Copies waiting logos and photos for published listings, a small batch per call (the page calls it until none are left). */
export async function copyPendingImagesAction(): Promise<{ ok: boolean; done: number; logos: number; covers: number; left: number }> {
  const user = await importerOrNull();
  if (!user) return { ok: false, done: 0, logos: 0, covers: 0, left: 0 };
  const r = await copyPendingImages(await getSettings(), user.id);
  if (r.done) await db.auditLog.create({ data: { actorId: user.id, action: 'import_copy_images', subjectType: 'branch', subjectId: user.id, meta: r } });
  refresh();
  return { ok: true, ...r };
}
