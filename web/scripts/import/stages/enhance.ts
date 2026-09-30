// "Enhance published listings" runs. For live listings that came from the import and that no owner has
// claimed, a run carries a set of steps (src/lib/import/enrichPlan.ts):
//   dfs        refresh the provider data (DataForSEO, one request per up to 500 listings);
//   maps, facebook, instagram          Apify actors (stages/apify.ts);
//   render                             the worker's own browser for unreadable sites (stages/render.ts);
//   site       read the business's website again (the 30-day cache is ignored for those domains);
//   editorial  write the description and FAQs when the evidence changed; regenerate: even when it did not;
//   images     copy the images that were found.
// In automatic mode each step runs only for the listings whose missing template sections it can fill;
// otherwise every step runs for every listing. The fill itself (src/lib/server/importEnhance.ts) only
// adds what a listing is missing.

import { Prisma, type ImportRun } from '@prisma/client';
import { BudgetExceeded, commit, release, reserve, uncertain, withCaps } from '../../../src/lib/import/budget';
import { mapItem, type DfsItem } from '../../../src/lib/import/dataforseo';
import { planFor, scopeSteps, STEP_ORDER, stepApplies, type StepId } from '../../../src/lib/import/enrichPlan';
import { pricing, toMicros } from '../../../src/lib/import/pricing';
import { EnhanceScope } from '../../../src/lib/import/rules';
import { enrichQueue } from '../../../src/lib/server/enrichQueue';
import { enhanceBranch } from '../../../src/lib/server/importEnhance';
import { bump, db, heartbeat, log, setStats, settings, Stop } from '../ctx';
import { apifyConfigured } from '../providers/apify';
import { dfsSearch } from '../providers/dataforseo';
import { seedApifyTasks } from './apify';
import { seedRenderTasks } from './render';
import { seedResearchTasks } from './research';
import { openaiConfigured } from '../providers/openai';
import { upsertListing } from './dfsDiscover';
import { editorialFor } from './editorial';
import { enrichOne } from './enrich';

const REFRESH_BATCH = 500;
const ENHANCE_BATCH = 8;

export async function seedEnhance(run: ImportRun) {
  if ((run.stats as { seeded?: boolean }).seeded) return;
  const scope = EnhanceScope.parse(run.scope);
  const { steps, auto } = scopeSteps(scope);
  // Live listings no owner has claimed, that came from the import.
  const open = await db.$queryRaw<Array<{ id: string }>>`
    SELECT b.id FROM branches b JOIN import_places p ON p.branch_id = b.id
    WHERE b.is_claimed = false AND b.status = 'live' AND p.status IN ('approved', 'merged')`;
  const allowed = new Set(open.map(r => r.id));
  const ids = (scope.branchIds ?? [...allowed]).filter(id => allowed.has(id));
  const places = await db.importPlace.findMany({
    where: { status: { in: ['approved', 'merged'] }, branchId: { in: ids } },
    select: { id: true, branchId: true, sourceId: true, provider: true, placeId: true, website: true, websiteKind: true, siteDomain: true, instagram: true, facebook: true, socials: true, crawl: true, editorial: true },
    orderBy: { reviewedAt: 'asc' },
    take: run.recordLimit ?? 1000,
  });
  const s = await settings();
  const opts = { settings: s, apifyConfigured: apifyConfigured(), openaiConfigured: openaiConfigured(), allowed: [...steps] };

  // The plan per record: automatic from the listing's gaps, or every allowed step that applies.
  const plans = new Map<string, Set<string>>();
  if (auto) {
    const q = await enrichQueue({ branchIds: places.map(p => p.branchId!) });
    const byBranch = new Map(q.rows.map(r => [r.branchId, r]));
    for (const p of places) {
      const row = byBranch.get(p.branchId!);
      const plan = new Set<string>(row ? planFor(row.missing, row.signals, opts) : []);
      if (steps.has('regenerate') && row && stepApplies('regenerate', row.signals, opts)) plan.add('regenerate');
      plans.set(p.id, plan);
    }
  } else {
    const q = await enrichQueue({ branchIds: places.map(p => p.branchId!) });
    const byBranch = new Map(q.rows.map(r => [r.branchId, r]));
    for (const p of places) {
      const row = byBranch.get(p.branchId!);
      plans.set(p.id, new Set(STEP_ORDER.filter(st => steps.has(st) && (!row || stepApplies(st, row.signals, opts)))));
    }
  }
  const planCounts = Object.fromEntries(STEP_ORDER.map(st => [st, [...plans.values()].filter(pl => pl.has(st)).length]));

  // A website read again: the domain's cache expires now (only for the records whose plan says so).
  const domains = [...new Set(places.filter(p => plans.get(p.id)?.has('site')).map(p => p.siteDomain).filter((d): d is string => !!d))];
  if (domains.length) await db.siteFetch.updateMany({ where: { domain: { in: domains } }, data: { nextCheckAt: new Date(0) } });

  const tasks: Prisma.ImportTaskCreateManyInput[] = [];
  if (s.dataforseoEnabled) {
    const cids = places.filter(p => plans.get(p.id)?.has('dfs') && p.provider === 'dataforseo' && p.sourceId && /^\d+$/.test(p.sourceId)).map(p => p.sourceId!);
    for (let i = 0; i < cids.length; i += REFRESH_BATCH) tasks.push({ runId: run.id, key: `refresh:${i}`, kind: 'dfs_refresh', params: { cids: cids.slice(i, i + REFRESH_BATCH) } });
  }
  // Refresh tasks first so the website stage and the fill use fresh provider data.
  for (const t of tasks) await db.importTask.create({ data: t });
  const apify = await seedApifyTasks(run, plans, places);
  const render = await seedRenderTasks(run, plans, places);
  const research = await seedResearchTasks(run, places.filter(p => plans.get(p.id)?.has('research')).map(p => p.id));
  const enhance: Prisma.ImportTaskCreateManyInput[] = [];
  for (let i = 0; i < places.length; i += ENHANCE_BATCH) {
    const slice = places.slice(i, i + ENHANCE_BATCH);
    enhance.push({ runId: run.id, key: `enhance:${i}`, kind: 'enhance', params: { ids: slice.map(p => p.id), steps: Object.fromEntries(slice.map(p => [p.id, [...(plans.get(p.id) ?? [])]])) } as unknown as Prisma.InputJsonValue });
  }
  await db.importTask.createMany({ data: enhance, skipDuplicates: true });
  await setStats(run.id, { seeded: true, listings: places.length, refreshTasks: tasks.length, plan: planCounts, apifyTasks: apify, renderSites: render, researchTasks: research, auto, apifyConfigured: apifyConfigured(), openaiConfigured: openaiConfigured(), stepsAllowed: [...steps] });
  log(`enhance: ${places.length} published listings, plan ${JSON.stringify(planCounts)}`);
}

async function refresh(run: ImportRun, taskId: string, cids: string[]) {
  const s = await settings();
  if (s.killSwitch) throw new Stop('kill switch on');
  const p = pricing().dataforseo.businessListingsSearch;
  const estimate = toMicros(p.perRequestUsd + cids.length * p.perItemUsd);
  const requestKey = `refresh:${taskId}`;
  try {
    const state = await reserve(db, withCaps({ runId: run.id, provider: 'dataforseo', endpoint: 'business_listings/search/live', requestKey, estimateMicros: estimate, meta: { refresh: cids.length } }));
    if (state === 'exists') {
      await db.importTask.update({ where: { id: taskId }, data: { status: 'needs_reconciliation', error: 'already sent', params: { cids, requestKey } } });
      return;
    }
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      await db.importTask.update({ where: { id: taskId }, data: { status: 'done', error: 'budget' } });
      await setStats(run.id, { budgetHit: true });
      return;
    }
    throw e;
  }
  await db.importTask.update({ where: { id: taskId }, data: { status: 'dispatched', params: { cids, requestKey } } });
  const res = await dfsSearch({ filters: [['cid', 'in', cids]], limit: Math.min(1000, cids.length), tag: requestKey } as never);
  if (res.kind === 'not_sent') {
    await release(db, requestKey, res.message);
    await db.importTask.update({ where: { id: taskId }, data: { status: 'failed', error: res.message } });
    return;
  }
  if (res.kind === 'uncertain') {
    await uncertain(db, requestKey, estimate, res.message);
    await db.importTask.update({ where: { id: taskId }, data: { status: 'needs_reconciliation', error: res.message } });
    return;
  }
  if (res.kind === 'error') {
    if (res.costUsd != null) await commit(db, requestKey, toMicros(res.costUsd), estimate);
    else await release(db, requestKey, res.message);
    await db.importTask.update({ where: { id: taskId }, data: { status: 'failed', error: `${res.code}: ${res.message}` } });
    if (res.fatal) throw new Error(`DataForSEO ${res.code}: ${res.message}`);
    return;
  }
  await commit(db, requestKey, res.costUsd != null ? toMicros(res.costUsd) : null, estimate);
  let n = 0;
  for (const it of (res.task.result?.[0]?.items ?? []) as DfsItem[]) {
    const m = mapItem(it);
    if (m && (await upsertListing(run, m, s, { keepRun: true })) !== 'skipped') n++;
  }
  await db.importTask.update({ where: { id: taskId }, data: { status: 'done', found: n } });
  await bump(run.id, { refreshed: n });
  log(`enhance: refreshed ${n} of ${cids.length} listings from DataForSEO`);
}

async function actorFor(run: ImportRun): Promise<string | null> {
  if (run.createdById) return run.createdById;
  return (await db.user.findFirst({ where: { opsRole: 'ops' }, select: { id: true } }))?.id ?? null;
}

export async function enhanceStage(run: ImportRun, kind: 'dfs_refresh' | 'enhance'): Promise<boolean> {
  const task = await db.importTask.findFirst({ where: { runId: run.id, status: 'pending', kind }, orderBy: { createdAt: 'asc' } });
  if (!task) return false;
  await heartbeat(run.id);
  const params = task.params as { cids?: string[]; ids?: string[]; steps?: Record<string, string[]> };
  if (task.kind === 'dfs_refresh') {
    await refresh(run, task.id, params.cids ?? []);
    return true;
  }
  const s = await settings();
  const actor = await actorFor(run);
  const stats = (run.stats ?? {}) as { counters?: Record<string, number> };
  const runBrowser = { used: stats.counters?.browserPages ?? 0, cap: s.browserMaxPerRun };
  const youtubeQuota = { used: stats.counters?.youtubeQuota ?? 0, cap: s.youtubeQuotaPerRun };
  const editorialCounter = { calls: stats.counters?.editorialCalls ?? 0 };
  const editorialBefore = editorialCounter.calls;
  const scope = EnhanceScope.parse(run.scope);
  const legacy = scopeSteps(scope);
  const counts: Record<string, number> = {};
  const failures: string[] = [];
  let editorialFatal: string | null = null;
  for (const id of params.ids ?? []) {
    const p = await db.importPlace.findUnique({ where: { id } });
    if (!p?.branchId) continue;
    // Older runs have no per-record steps: they wrote and copied for everyone.
    const steps = new Set<string>(params.steps?.[id] ?? [...legacy.steps]);
    try {
      // The website read is the one step that must succeed: without a record there is nothing to fill from.
      await enrichOne(p, runBrowser, { keepStatus: true, youtubeQuota, onCost: c => Object.entries(c).forEach(([k, v]) => (counts[k] = (counts[k] ?? 0) + (v ?? 0))) });
      const afterSite = await db.importPlace.findUniqueOrThrow({ where: { id } });
      // The writer can fail (no key, no credit, model refused) without stopping the fill: whatever the
      // sources found still reaches the listing, and the run reports the writer's problem.
      let editorialNote: string | null = null;
      if (steps.has('editorial') || steps.has('regenerate')) {
        try {
          const ed = await editorialFor(afterSite, run, { counter: editorialCounter, force: steps.has('regenerate') });
          counts[`editorial_${ed}`] = (counts[`editorial_${ed}`] ?? 0) + 1;
        } catch (e) {
          if (e instanceof Stop) throw e;
          editorialNote = (e instanceof Error ? e.message : String(e)).slice(0, 160);
          counts.editorial_failed = (counts.editorial_failed ?? 0) + 1;
          if (/no_api_key|auth|no_credit|model_not_found/.test(editorialNote)) editorialFatal = editorialNote;
        }
      }
      const fresh = await db.importPlace.findUniqueOrThrow({ where: { id } });
      const r = actor ? await enhanceBranch(p.branchId, fresh, s, actor, { images: steps.has('images') }) : { filled: [], skipped: 'no_actor' };
      for (const f of r.filled) counts[`filled_${f}`] = (counts[`filled_${f}`] ?? 0) + 1;
      counts[r.filled.length ? 'improved' : r.skipped ? `skipped_${r.skipped}` : 'nothing_to_add'] = (counts[r.filled.length ? 'improved' : r.skipped ? `skipped_${r.skipped}` : 'nothing_to_add'] ?? 0) + 1;
      const crawl = (fresh.crawl ?? {}) as { site?: string; apify?: Record<string, { checked?: string; found?: boolean; status?: string }>; render?: { status?: string } };
      const sources = Object.fromEntries(Object.entries(crawl.apify ?? {}).map(([k, v]) => [k, v?.checked ?? (v?.found === false ? 'not_found' : v?.found ? 'found' : v?.status ?? 'done')]));
      if (crawl.render?.status) sources.render = crawl.render.status;
      await db.auditLog.create({ data: { actorId: actor, action: 'import_enhance', subjectType: 'branch', subjectId: p.branchId, meta: { runId: run.id, filled: r.filled, skipped: r.skipped ?? null, steps: [...steps] as StepId[], site: crawl.site ?? null, sources, editorial: editorialNote } } });
    } catch (e) {
      if (e instanceof Stop) throw e;
      counts.failed = (counts.failed ?? 0) + 1;
      const msg = (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, '<url>').replace(/\s+/g, ' ').slice(0, 160);
      failures.push(msg);
      log('enhance failed', id, msg);
    }
  }
  await db.importTask.update({ where: { id: task.id }, data: { status: 'done', found: (params.ids ?? []).length } });
  await bump(run.id, { ...counts, editorialCalls: editorialCounter.calls - editorialBefore });
  if (editorialFatal) {
    // Shown on the run card with the matching hint (key, credit); the fill itself went on.
    await setStats(run.id, { lastEditorialError: editorialFatal });
    await db.importRun.updateMany({ where: { id: run.id }, data: { error: `הכתיבה לא רצה: ${editorialFatal}` } });
  }
  if (failures.length) {
    const cur = await db.importRun.findUniqueOrThrow({ where: { id: run.id }, select: { stats: true } });
    const prev = ((cur.stats as { failures?: string[] }).failures ?? []) as string[];
    await setStats(run.id, { failures: [...new Set([...prev, ...failures])].slice(0, 10) });
  }
  return true;
}

/** Import records covered by an enhance run (for the Google posts photo step). */
export async function enhancePlaceIds(run: ImportRun): Promise<string[]> {
  const tasks = await db.importTask.findMany({ where: { runId: run.id, kind: 'enhance' }, select: { params: true } });
  return tasks.flatMap(t => ((t.params as { ids?: string[] }).ids ?? []));
}
