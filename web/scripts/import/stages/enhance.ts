// "Enhance published listings" runs. For live listings that came from the import and that no owner has
// claimed:
//   1. optionally refresh the provider data (DataForSEO, one request per up to 500 listings, reserved
//      against the run budget like discovery; an unknown outcome waits for reconciliation);
//   2. read each business's website again (cached per domain as usual);
//   3. fill only what the listing is missing (see src/lib/server/importEnhance.ts).

import { Prisma, type ImportRun } from '@prisma/client';
import { BudgetExceeded, commit, release, reserve, uncertain, withCaps } from '../../../src/lib/import/budget';
import { mapItem, type DfsItem } from '../../../src/lib/import/dataforseo';
import { pricing, toMicros } from '../../../src/lib/import/pricing';
import { EnhanceScope } from '../../../src/lib/import/rules';
import { enhanceBranch } from '../../../src/lib/server/importEnhance';
import { bump, db, heartbeat, log, setStats, settings, Stop } from '../ctx';
import { dfsSearch } from '../providers/dataforseo';
import { upsertListing } from './dfsDiscover';
import { enrichOne } from './enrich';

const REFRESH_BATCH = 500;
const ENHANCE_BATCH = 8;

export async function seedEnhance(run: ImportRun) {
  if ((run.stats as { seeded?: boolean }).seeded) return;
  const scope = EnhanceScope.parse(run.scope);
  // Live listings no owner has claimed, that came from the import.
  const open = await db.$queryRaw<Array<{ id: string }>>`
    SELECT b.id FROM branches b JOIN import_places p ON p.branch_id = b.id
    WHERE b.is_claimed = false AND b.status = 'live' AND p.status IN ('approved', 'merged')`;
  const allowed = new Set(open.map(r => r.id));
  const ids = (scope.branchIds ?? [...allowed]).filter(id => allowed.has(id));
  const places = await db.importPlace.findMany({
    where: { status: { in: ['approved', 'merged'] }, branchId: { in: ids } },
    select: { id: true, sourceId: true, provider: true },
    orderBy: { reviewedAt: 'asc' },
    take: run.recordLimit ?? 1000,
  });
  const tasks: Prisma.ImportTaskCreateManyInput[] = [];
  const s = await settings();
  if (scope.refresh && s.dataforseoEnabled) {
    const cids = places.filter(p => p.provider === 'dataforseo' && p.sourceId && /^\d+$/.test(p.sourceId)).map(p => p.sourceId!);
    for (let i = 0; i < cids.length; i += REFRESH_BATCH) tasks.push({ runId: run.id, key: `refresh:${i}`, kind: 'dfs_refresh', params: { cids: cids.slice(i, i + REFRESH_BATCH) } });
  }
  for (let i = 0; i < places.length; i += ENHANCE_BATCH) tasks.push({ runId: run.id, key: `enhance:${i}`, kind: 'enhance', params: { ids: places.slice(i, i + ENHANCE_BATCH).map(p => p.id) } });
  // Refresh tasks first so the website stage and the fill use fresh provider data.
  for (const t of tasks.filter(t => t.kind === 'dfs_refresh')) await db.importTask.create({ data: t });
  await db.importTask.createMany({ data: tasks.filter(t => t.kind === 'enhance'), skipDuplicates: true });
  await setStats(run.id, { seeded: true, listings: places.length, refreshTasks: tasks.filter(t => t.kind === 'dfs_refresh').length });
  log(`enhance: ${places.length} published listings, ${tasks.length} tasks`);
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
  const params = task.params as { cids?: string[]; ids?: string[] };
  if (task.kind === 'dfs_refresh') {
    await refresh(run, task.id, params.cids ?? []);
    return true;
  }
  const s = await settings();
  const actor = await actorFor(run);
  const runBrowser = { used: 0, cap: s.browserMaxPerRun };
  const counts: Record<string, number> = {};
  const failures: string[] = [];
  for (const id of params.ids ?? []) {
    const p = await db.importPlace.findUnique({ where: { id } });
    if (!p?.branchId) continue;
    try {
      await enrichOne(p, runBrowser, { keepStatus: true });
      const fresh = await db.importPlace.findUniqueOrThrow({ where: { id } });
      const r = actor ? await enhanceBranch(p.branchId, fresh, s, actor) : { filled: [], skipped: 'no_actor' };
      for (const f of r.filled) counts[`filled_${f}`] = (counts[`filled_${f}`] ?? 0) + 1;
      counts[r.filled.length ? 'improved' : r.skipped ? `skipped_${r.skipped}` : 'nothing_to_add'] = (counts[r.filled.length ? 'improved' : r.skipped ? `skipped_${r.skipped}` : 'nothing_to_add'] ?? 0) + 1;
      await db.auditLog.create({ data: { actorId: actor, action: 'import_enhance', subjectType: 'branch', subjectId: p.branchId, meta: { runId: run.id, filled: r.filled } } });
    } catch (e) {
      if (e instanceof Stop) throw e;
      counts.failed = (counts.failed ?? 0) + 1;
      const msg = (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, '<url>').replace(/\s+/g, ' ').slice(0, 160);
      failures.push(msg);
      log('enhance failed', id, msg);
    }
  }
  await db.importTask.update({ where: { id: task.id }, data: { status: 'done', found: (params.ids ?? []).length } });
  await bump(run.id, counts);
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
