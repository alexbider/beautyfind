'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { importerOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import {
  approvePlace, createRun, deleteRun, dispatchWorker, editPlace, enrichSelected, markDuplicate, mergePlace, reconcileTask, recoverRun, rejectPlace, restorePlace, retryIncomplete,
  getSettings, resetImport, saveSettings, setRunStatus, type CreateRunInput, type OpResult, type ResetPreview,
} from '@/lib/server/importOps';
import { estimatePlans, planFor, STEP_ORDER, stepApplies, type StepId } from '@/lib/import/enrichPlan';
import { enrichQueue } from '@/lib/server/enrichQueue';
import { googleLookup, type GoogleLookup } from '@/lib/server/googleDisplay';
import { copyPendingImages } from '@/lib/server/importEnhance';
import { pricing } from '@/lib/import/pricing';
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

export async function runControlAction(runId: string, action: 'pause' | 'resume' | 'cancel' | 'kick' | 'retry' | 'recover', extra: { budgetUsd?: number } = {}): Promise<{ ok: boolean; dispatched?: boolean; reason?: string; count?: number; recovered?: { tasks: number; editorial: number } }> {
  const user = await importerOrNull();
  if (!user || !z.uuid().safeParse(runId).success) return { ok: false };
  let count: number | undefined;
  let recovered: { tasks: number; editorial: number } | undefined;
  if (action === 'retry') count = await retryIncomplete(runId);
  else if (action === 'recover') {
    const budget = typeof extra.budgetUsd === 'number' && Number.isFinite(extra.budgetUsd) ? extra.budgetUsd : undefined;
    const r = await recoverRun(user, runId, { budgetUsd: budget });
    recovered = { tasks: r.tasks, editorial: r.editorial };
  } else if (action !== 'kick') await setRunStatus(runId, action);
  const d = action === 'resume' || action === 'kick' || action === 'recover' || (action === 'retry' && count) ? await dispatchWorker(runId) : undefined;
  refresh();
  return { ok: true, count, recovered, ...d };
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
    // Ceiling: the provider refresh plus the editorial allowance per listing (reserved per call, settled at the reported token cost).
    const s = await getSettings();
    const editorial = s.editorialEnabled ? Math.min(s.editorialBudgetUsd, branchIds.length * pricing().editorial.perProfileUsd) : 0;
    const run = await createRun(user, { label: `העשרת ${branchIds.length} עסקים שנבחרו`, provider: 'enhance', scope: { branchIds, refresh }, recordLimit: branchIds.length, budgetUsd: (refresh ? 0.5 : 0) + editorial });
    const d = await dispatchWorker(run.id);
    refreshPaths();
    return { ok: true, count: branchIds.length, dispatched: d.dispatched };
  } catch {
    return { ok: false, count: 0 };
  }
}

const StepList = z.array(z.enum(['dfs', 'maps', 'facebook', 'instagram', 'site', 'render', 'editorial', 'regenerate', 'images'])).max(9);

export type EnhanceListingsResult = { ok: true; count: number; dispatched?: boolean; runId: string | null; budgetUsd: number; plan: Record<string, number> } | { ok: false; count: 0; error: string };

/**
 * A batch from the enrichment tab: chosen published listings (by branch id) and the steps staff allowed.
 * auto: each step runs only for the listings whose gaps it can fill (the same rule the tab shows);
 * otherwise every allowed step runs for every listing. The run's ceiling is the plan estimate with a
 * margin, so a batch never spends more than what the tab showed.
 */
export async function enhanceListingsAction(branchIds: string[], opts: { steps?: string[]; auto?: boolean; label?: string; focus?: string[]; refresh?: boolean; regenerate?: boolean; rereadSite?: boolean }): Promise<EnhanceListingsResult> {
  const user = await importerOrNull();
  const list = z.array(z.uuid()).min(1).max(1000).safeParse(branchIds);
  if (!user || !list.success) return { ok: false, count: 0, error: 'invalid' };
  return startCompletion(user, list.data, opts);
}

/** One completion batch for a whole group of the report (a city and a category): every published, unclaimed listing in it, automatic plan. */
export async function enhanceGroupAction(group: { region?: string; city?: string; category?: string; label?: string }): Promise<EnhanceListingsResult> {
  const user = await importerOrNull();
  if (!user) return { ok: false, count: 0, error: 'forbidden' };
  const q = await enrichQueue({ region: group.region?.slice(0, 40), city: group.city?.slice(0, 80), category: group.category?.slice(0, 40) });
  const ids = q.rows.map(r => r.branchId).slice(0, 1000);
  if (!ids.length) return { ok: true, count: 0, runId: null, budgetUsd: 0, plan: {} };
  return startCompletion(user, ids, { auto: true, label: group.label ?? `השלמות: ${[group.city, group.category].filter(Boolean).join(', ') || 'קבוצה'}` });
}

async function startCompletion(user: { id: string }, branchIds: string[], opts: { steps?: string[]; auto?: boolean; label?: string; focus?: string[]; refresh?: boolean; regenerate?: boolean; rereadSite?: boolean }): Promise<EnhanceListingsResult> {
  const list = { data: branchIds };
  // Legacy booleans map onto steps; a call without any step means the default set.
  const requested = new Set<StepId>((StepList.safeParse(opts.steps ?? []).data ?? []) as StepId[]);
  if (opts.rereadSite) requested.add('site');
  if (opts.refresh) requested.add('dfs');
  if (opts.regenerate) requested.add('regenerate');
  if (!opts.steps) for (const st of ['site', 'editorial', 'images'] as StepId[]) requested.add(st);
  const steps = STEP_ORDER.filter(st => requested.has(st));
  const auto = opts.auto !== false;
  const q = await enrichQueue({ branchIds: list.data });
  if (!q.rows.length) return { ok: true, count: 0, runId: null, budgetUsd: 0, plan: {} };
  const ids = q.rows.map(r => r.branchId);
  const s = await getSettings();
  const planOpts = { settings: s, apifyConfigured: true, allowed: steps };
  const plans = q.rows.map(r => {
    const plan = auto ? planFor(r.missing, r.signals, planOpts) : steps.filter(st => stepApplies(st, r.signals, planOpts));
    if (auto && requested.has('regenerate') && stepApplies('regenerate', r.signals, planOpts)) plan.push('regenerate');
    return plan;
  });
  const est = estimatePlans(plans, pricing(), { renderPages: s.apifyRenderPages, editorialEnabled: s.editorialEnabled, writer: s.llmProvider });
  const planCounts = Object.fromEntries(Object.entries(est.perStep).filter(([, v]) => v.listings > 0).map(([k, v]) => [k, v.listings]));
  // Ceiling: the estimate plus a quarter, at least the editorial allowance for a few new drafts; never above the per-run caps.
  const editorialCap = s.editorialEnabled ? Math.min(s.editorialBudgetUsd, ids.length * pricing().editorial.perProfileUsd * 1.3) : 0;
  const budgetUsd = Math.min(10_000, Math.max(0.05, est.totalUsd * 1.25 + (planCounts.editorial || planCounts.regenerate ? editorialCap * 0.5 : 0)));
  try {
    const focus = (opts.focus ?? []).slice(0, 30);
    const label = (opts.label ?? '').trim().slice(0, 60) || `העשרה: ${ids.length} עסקים${focus.length ? ` (${focus.join(', ')})` : ''}`;
    const run = await createRun(user, {
      label,
      provider: 'enhance',
      scope: { branchIds: ids, steps, auto, refresh: steps.includes('dfs'), regenerate: steps.includes('regenerate'), rereadSite: steps.includes('site'), focus },
      recordLimit: ids.length,
      budgetUsd,
    });
    const d = await dispatchWorker(run.id);
    refreshPaths();
    revalidatePath('/ops/import/enrich');
    return { ok: true, count: ids.length, dispatched: d.dispatched, runId: run.id, budgetUsd, plan: planCounts };
  } catch (e) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : 'failed' };
  }
}

/** Deletes finished or stopped runs ("batches"). Running runs and discovery runs that still own records are skipped and reported. */
/** Wipes every listing the import created and every trace of earlier runs. Needs the typed word; refused while a worker holds a run. */
export async function resetImportAction(confirm: string): Promise<{ ok: true; preview: ResetPreview } | { ok: false; error: 'forbidden' | 'confirm' | 'running' }> {
  const user = await importerOrNull();
  if (!user) return { ok: false, error: 'forbidden' };
  if (confirm.trim() !== 'מחיקה') return { ok: false, error: 'confirm' };
  const r = await resetImport(user);
  if (!r.ok) return r;
  refreshPaths();
  revalidatePath('/ops/import/enrich');
  revalidatePath('/ops/import/report');
  revalidatePath('/', 'layout'); // the public pages that showed the deleted listings
  return r;
}

export async function deleteRunsAction(runIds: string[]): Promise<{ ok: boolean; deleted: number; skipped: Array<{ id: string; error: string }> }> {
  const user = await importerOrNull();
  const list = z.array(z.uuid()).min(1).max(100).safeParse(runIds);
  if (!user || !list.success) return { ok: false, deleted: 0, skipped: [] };
  let deleted = 0;
  const skipped: Array<{ id: string; error: string }> = [];
  for (const id of list.data) {
    const r = await deleteRun(user, id);
    if (r.ok) deleted++;
    else skipped.push({ id, error: r.error });
  }
  refreshPaths();
  revalidatePath('/ops/import/enrich');
  return { ok: true, deleted, skipped };
}

/** Rewrites the editorial draft of the chosen published records (an enhance run with regenerate), ignoring the evidence cache. */
export async function regenerateEditorialAction(ids: string[]): Promise<{ ok: boolean; count: number; dispatched?: boolean }> {
  const user = await importerOrNull();
  const list = z.array(z.uuid()).max(200).safeParse(ids);
  if (!user || !list.success) return { ok: false, count: 0 };
  const places = await db.importPlace.findMany({ where: { id: { in: list.data }, status: { in: ['approved', 'merged'] }, branchId: { not: null } }, select: { branchId: true } });
  const branchIds = [...new Set(places.map(p => p.branchId!))];
  if (!branchIds.length) return { ok: true, count: 0 };
  try {
    const s = await getSettings();
    const run = await createRun(user, { label: `כתיבה מחדש: ${branchIds.length} עסקים`, provider: 'enhance', scope: { branchIds, refresh: false, regenerate: true }, recordLimit: branchIds.length, budgetUsd: Math.min(s.editorialBudgetUsd, branchIds.length * pricing().editorial.perProfileUsd * 1.3) });
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
