// Count run: how many businesses DataForSEO lists per city and category. One request of one record per
// pair (the request fee plus one record), reserved and committed like a discovery page, the provider's
// total_count stored in import_coverage. The new-import screen shows the total next to each city and
// category, and "found of total" once a crawl has run, so a city is not crawled twice for one service.

import { Prisma, type ImportRun } from '@prisma/client';
import { CATEGORIES, CITIES } from '../../../src/lib/catalog';
import { BudgetExceeded, commit, release, reserve, uncertain, withCaps } from '../../../src/lib/import/budget';
import { countRequestUsd, pairsToCount, type CoverageCell } from '../../../src/lib/import/coverageCounts';
import { buildSearch, dfsCategoriesFor, DFS_MAX_CATEGORIES } from '../../../src/lib/import/dataforseo';
import { CITY_AREA } from '../../../src/lib/import/geo';
import { pricing, toMicros } from '../../../src/lib/import/pricing';
import { CountScope } from '../../../src/lib/import/rules';
import { bump, db, heartbeat, log, setStats, settings, Stop } from '../ctx';
import { dfsSearch } from '../providers/dataforseo';

interface CountTaskParams {
  city: string;
  category: string;
  retries: number;
  attempt?: number;
  requestKey?: string;
}

/** Counts older than this are asked again by a count run that does not force a recount. */
export const COUNT_STALE_DAYS = 30;

export async function seedCount(run: ImportRun, scope: CountScope) {
  if ((run.stats as { seeded?: boolean }).seeded) return;
  const cities = scope.all ? CITIES.map(c => c.slug) : scope.cities;
  const categories = scope.categories.length ? scope.categories : CATEGORIES.map(c => c.slug);
  const rows = await db.importCoverage.findMany({ where: { citySlug: { in: cities }, categorySlug: { in: categories } } });
  const cells: CoverageCell[] = rows.map(r => ({ city: r.citySlug, category: r.categorySlug, total: r.providerTotal, checkedAt: r.checkedAt.toISOString(), found: 0, published: 0 }));
  const stale = new Date(Date.now() - COUNT_STALE_DAYS * 86_400_000);
  const pairs = pairsToCount(cells, cities, categories, stale, !!scope.recount).filter(p => CITY_AREA[p.city] && dfsCategoriesFor([p.category]).length);
  const tasks: Prisma.ImportTaskCreateManyInput[] = pairs.map(p => ({
    runId: run.id,
    key: `count:${p.city}:${p.category}`,
    kind: 'count',
    params: { city: p.city, category: p.category, retries: 0 } satisfies CountTaskParams as unknown as Prisma.InputJsonValue,
  }));
  await db.importTask.createMany({ data: tasks, skipDuplicates: true });
  await setStats(run.id, { seeded: true, seededTasks: tasks.length, pairs: cities.length * categories.length, skippedFresh: cities.length * categories.length - tasks.length });
  log(`seeded ${tasks.length} count tasks (${cities.length} cities x ${categories.length} categories, ${cities.length * categories.length - tasks.length} counted recently)`);
}

/** One paid count. Returns false when no task is left or the budget stops the run. */
export async function countStage(run: ImportRun): Promise<boolean> {
  const task = await db.importTask.findFirst({ where: { runId: run.id, kind: 'count', status: 'pending' }, orderBy: { createdAt: 'asc' } });
  if (!task) return false;
  await heartbeat(run.id);
  const s = await settings();
  if (s.killSwitch || !s.dataforseoEnabled) throw new Stop(s.killSwitch ? 'kill switch on' : 'DataForSEO disabled in settings');

  const p = task.params as unknown as CountTaskParams;
  const requestKey = `count:${task.id}:${p.attempt ?? 0}:${p.retries}`;
  const estimate = toMicros(countRequestUsd(pricing()));
  let state: 'reserved' | 'exists';
  try {
    state = await reserve(db, withCaps({ runId: run.id, provider: 'dataforseo', endpoint: 'business_listings/search/live', requestKey, estimateMicros: estimate, meta: { count: true, city: p.city, category: p.category } }));
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      await setStats(run.id, { budgetHit: true });
      log('run budget reached before the next count; stopping');
      return false;
    }
    throw e;
  }
  if (state === 'exists') {
    const prior = await db.spendEntry.findUnique({ where: { requestKey } });
    await db.importTask.update({ where: { id: task.id }, data: { status: 'needs_reconciliation', error: `count already ${prior?.status}`, params: { ...p, requestKey } as unknown as Prisma.InputJsonValue } });
    await bump(run.id, { needsReconciliation: 1 });
    return true;
  }
  await db.importTask.update({ where: { id: task.id }, data: { status: 'dispatched', params: { ...p, requestKey } as unknown as Prisma.InputJsonValue } });

  const area = CITY_AREA[p.city];
  const categories = dfsCategoriesFor([p.category]).slice(0, DFS_MAX_CATEGORIES);
  const body = buildSearch({ categories, lat: area[0], lng: area[1], radiusKm: Math.max(1, area[2]), limit: 1, tag: requestKey });
  const res = await dfsSearch(body);

  if (res.kind === 'not_sent') {
    await release(db, requestKey, res.message);
    await db.importTask.update({ where: { id: task.id }, data: { status: 'pending' } });
    throw new Error(`DataForSEO: ${res.message}`);
  }
  if (res.kind === 'uncertain') {
    await uncertain(db, requestKey, estimate, res.message);
    await db.importTask.update({ where: { id: task.id }, data: { status: 'needs_reconciliation', error: res.message } });
    await bump(run.id, { needsReconciliation: 1 });
    return true;
  }
  if (res.kind === 'error') {
    if (res.costUsd != null) await commit(db, requestKey, toMicros(res.costUsd), estimate);
    else await release(db, requestKey, res.message);
    if (res.fatal) {
      await db.importTask.update({ where: { id: task.id }, data: { status: 'pending', error: res.message } });
      throw new Error(`DataForSEO ${res.code}: ${res.message}`);
    }
    if (res.transient && p.retries < 3) {
      await db.importTask.update({ where: { id: task.id }, data: { status: 'pending', params: { ...p, retries: p.retries + 1 } as unknown as Prisma.InputJsonValue, error: res.message } });
      await new Promise(r => setTimeout(r, 5000 * 2 ** p.retries));
      return true;
    }
    await db.importTask.update({ where: { id: task.id }, data: { status: 'failed', error: `${res.code}: ${res.message}` } });
    await bump(run.id, { tasksFailed: 1 });
    return true;
  }

  await commit(db, requestKey, res.costUsd != null ? toMicros(res.costUsd) : null, estimate);
  const result = res.task.result?.[0];
  const total = typeof result?.total_count === 'number' ? result.total_count : null;
  const now = new Date();
  await db.importCoverage.upsert({
    where: { citySlug_categorySlug: { citySlug: p.city, categorySlug: p.category } },
    create: { citySlug: p.city, categorySlug: p.category, providerTotal: total, checkedAt: now, runId: run.id },
    update: { providerTotal: total, checkedAt: now, runId: run.id },
  });
  await db.importTask.update({ where: { id: task.id }, data: { status: 'done', found: total ?? 0, error: null } });
  await bump(run.id, { counted: 1, businesses: total ?? 0 });
  log(`${p.city} / ${p.category}: ${total ?? '?'} businesses`);
  return true;
}
