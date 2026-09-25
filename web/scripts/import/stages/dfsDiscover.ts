// Stage 1: DataForSEO Business Listings discovery.
//
// Tasks are (area x category chunk). Each page is a unit of work with a stable request key:
//   1. check kill switch, run record limit and budget;
//   2. reserve the gross maximum cost for the page (run budget, atomic);
//   3. mark the task "dispatched" with the request key (checkpoint BEFORE the paid call);
//   4. call; commit the provider-reported cost; store items; checkpoint offset/offset_token;
//   5. an unknown outcome (timeout after sending) becomes needs_reconciliation and is never resent
//      automatically.
// The number reported is "matching records in the provider's database", not all businesses in Israel.

import { Prisma, type ImportRun, type RegionSlug } from '@prisma/client';
import { CITIES } from '../../../src/lib/catalog';
import { BudgetExceeded, commit, release, reserve, uncertain, withCaps } from '../../../src/lib/import/budget';
import { buildSearch, dfsCategoriesFor, DFS_MAX_CATEGORIES, DFS_MAX_OFFSET, mapItem, type DfsItem, type MappedListing } from '../../../src/lib/import/dataforseo';
import { CITY_AREA, resolveCity } from '../../../src/lib/import/geo';
import { dfsPageMaxUsd, pricing, toMicros } from '../../../src/lib/import/pricing';
import type { RunScope } from '../../../src/lib/import/rules';
import { expiryFor, mayPublish } from '../../../src/lib/import/sourcePolicy';
import { bump, db, heartbeat, log, setStats, settings, stagedCount, Stop } from '../ctx';
import { dfsSearch } from '../providers/dataforseo';

// Whole country: one circle over Israel, results limited to country code IL by filter.
const ISRAEL_CIRCLE = { lat: 31.45, lng: 35.0, radiusKm: 260 };

interface DfsTaskParams {
  label: string;
  categories: string[];
  lat: number;
  lng: number;
  radiusKm: number;
  offset: number;
  offsetToken?: string;
  page: number;
  fetched: number;
  total?: number;
  retries: number;
  attempt?: number; // bumped only by staff reconciliation, so a resend gets a new request key
  requestKey?: string;
}

export async function seedDfs(run: ImportRun, scope: RunScope) {
  if ((run.stats as { seeded?: boolean }).seeded) return;
  const ids = dfsCategoriesFor(scope.categories);
  if (!ids.length) throw new Error('No DataForSEO categories are mapped for the chosen categories');
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += DFS_MAX_CATEGORIES) chunks.push(ids.slice(i, i + DFS_MAX_CATEGORIES));
  const areas = scope.all
    ? [{ label: 'ישראל', ...ISRAEL_CIRCLE }]
    : scope.cities.map(slug => {
        const a = CITY_AREA[slug];
        const c = CITIES.find(x => x.slug === slug)!;
        return { label: c.name, lat: a[0], lng: a[1], radiusKm: Math.max(1, a[2]) };
      });
  const tasks: Prisma.ImportTaskCreateManyInput[] = [];
  for (const area of areas)
    for (const [ci, cats] of chunks.entries())
      tasks.push({
        runId: run.id,
        key: `dfs:${area.label}:${ci}`,
        kind: 'dfs',
        params: { label: area.label, categories: cats, lat: area.lat, lng: area.lng, radiusKm: area.radiusKm, offset: 0, page: 0, fetched: 0, retries: 0 } satisfies DfsTaskParams as unknown as Prisma.InputJsonValue,
      });
  await db.importTask.createMany({ data: tasks, skipDuplicates: true });
  await setStats(run.id, { seeded: true, seededTasks: tasks.length, dfsCategories: ids });
  log(`seeded ${tasks.length} DataForSEO search tasks (${ids.length} categories)`);
}

/** Stores one listing. Returns new | seen | skipped. Staff-edited fields are never overwritten. */
async function upsertListing(run: ImportRun, m: MappedListing, publishRatings: boolean): Promise<'new' | 'seen' | 'skipped'> {
  if (m.lat == null || m.lng == null) return 'skipped'; // cannot be placed on a region or map
  const now = new Date();
  const where = resolveCity(m.locality, m.lat, m.lng);
  const provider = {
    name: m.name,
    nameNorm: m.nameNorm,
    address: m.address,
    lat: m.lat,
    lng: m.lng,
    types: m.types,
    primaryType: m.primaryType,
    sourceUrl: m.sourceUrl,
    retrievedAt: now,
    sourceUpdatedAt: m.sourceUpdatedAt,
    googleRating: m.rating?.value ?? null,
    googleReviewCount: m.rating?.count ?? null,
    ratingProvider: m.rating ? 'dataforseo' : null,
  };
  const existing = await db.importPlace.findUnique({ where: { placeId: m.sourceKey }, select: { id: true, categories: true, crawl: true, phone: true, website: true, hours: true, status: true } });
  let id: string;
  let result: 'new' | 'seen';
  if (existing) {
    const edited = new Set(((existing.crawl as { editedFields?: string[] } | null)?.editedFields ?? []) as string[]);
    const data: Prisma.ImportPlaceUncheckedUpdateInput = { ...provider, runId: run.id };
    if (edited.has('name')) {
      delete data.name;
      delete data.nameNorm;
    }
    if (!edited.has('categories')) data.categories = [...new Set([...existing.categories, ...m.categories])];
    if (!edited.has('phone') && !existing.phone && m.phone) data.phone = m.phone;
    if (!edited.has('website') && !existing.website && m.website) data.website = m.website;
    if (!existing.hours && m.hours) data.hours = m.hours as unknown as Prisma.InputJsonValue;
    await db.importPlace.update({ where: { id: existing.id }, data });
    id = existing.id;
    result = 'seen';
  } else {
    const created = await db.importPlace.create({
      data: {
        placeId: m.sourceKey,
        provider: 'dataforseo',
        sourceId: m.sourceId,
        runId: run.id,
        ...provider,
        cityName: where.cityName ?? m.locality,
        citySlug: where.citySlug,
        regionSlug: where.regionSlug as RegionSlug,
        phoneRaw: m.phoneRaw,
        phone: m.phone,
        website: m.website,
        siteDomain: m.siteDomain,
        hours: (m.hours ?? undefined) as Prisma.InputJsonValue | undefined,
        categories: m.categories,
        crawl: { claimedOnProvider: m.claimedOnProvider },
      },
    });
    id = created.id;
    result = 'new';
  }
  // Provider observations: what the source said, when, with its publication rule.
  const obs: Prisma.FieldObservationCreateManyInput[] = [];
  const add = (field: string, value: unknown) =>
    value != null && value !== '' &&
    obs.push({
      importPlaceId: id, field, value: value as Prisma.InputJsonValue, provider: 'dataforseo', sourceUrl: m.sourceUrl, retrievedAt: now,
      sourceUpdatedAt: m.sourceUpdatedAt, confidence: 0.7, retention: expiryFor('dataforseo') ? 'until_expiry' : 'permanent', expiresAt: expiryFor('dataforseo'),
      publishable: mayPublish('dataforseo', field, { publishProviderRatings: publishRatings }),
    });
  add('name', m.name);
  add('address', m.address);
  add('phone', m.phoneRaw ? { raw: m.phoneRaw, e164: m.phone } : null);
  add('website', m.website);
  add('hours', m.hours);
  add('categories', m.categories.length ? m.categories : null);
  add('rating', m.rating);
  for (const e of m.emails) add('email', e);
  // The latest provider answer replaces the previous one for this record.
  await db.$transaction([
    db.fieldObservation.deleteMany({ where: { importPlaceId: id, provider: 'dataforseo' } }),
    db.fieldObservation.createMany({ data: obs }),
  ]);
  return result;
}

export async function discoverDfs(run: ImportRun): Promise<boolean> {
  const task = await db.importTask.findFirst({ where: { runId: run.id, kind: 'dfs', status: 'pending' }, orderBy: { createdAt: 'asc' } });
  if (!task) return false;
  await heartbeat(run.id);
  const s = await settings();
  if (s.killSwitch || !s.dataforseoEnabled) throw new Stop(s.killSwitch ? 'kill switch on' : 'DataForSEO disabled in settings');

  const p = task.params as unknown as DfsTaskParams;
  const limitTotal = run.recordLimit ?? s.pilotRecordLimit;
  const staged = await stagedCount(run.id);
  if (staged >= limitTotal) {
    await db.importTask.updateMany({ where: { runId: run.id, kind: 'dfs', status: 'pending' }, data: { status: 'done', error: 'record_limit' } });
    await setStats(run.id, { recordLimitReached: true });
    log(`record limit ${limitTotal} reached`);
    return false;
  }
  // Never ask for more than the run still needs; a page is at most the configured size (<= 1,000).
  const limit = Math.max(1, Math.min(s.dfsPageSize, limitTotal - staged));
  // One key per paid attempt: page, staff resend count and automatic retry count.
  const requestKey = `dfs:${task.id}:${p.page}:${p.attempt ?? 0}:${p.retries}`;
  const estimate = toMicros(dfsPageMaxUsd(limit, pricing()));

  let state: 'reserved' | 'exists';
  try {
    state = await reserve(db, withCaps({ runId: run.id, provider: 'dataforseo', endpoint: 'business_listings/search/live', requestKey, estimateMicros: estimate, meta: { page: p.page, limit } }));
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      await setStats(run.id, { budgetHit: true });
      log('run budget reached before the next DataForSEO page; stopping discovery');
      return false;
    }
    throw e;
  }
  if (state === 'exists') {
    // This page was already sent once (crash or restart mid-call): do not resend it blindly.
    const prior = await db.spendEntry.findUnique({ where: { requestKey } });
    await db.importTask.update({ where: { id: task.id }, data: { status: 'needs_reconciliation', error: `page ${p.page} already ${prior?.status}`, params: { ...p, requestKey } as unknown as Prisma.InputJsonValue } });
    await bump(run.id, { needsReconciliation: 1 });
    return true;
  }

  // Checkpoint before the paid call.
  await db.importTask.update({ where: { id: task.id }, data: { status: 'dispatched', params: { ...p, requestKey } as unknown as Prisma.InputJsonValue } });
  const body = buildSearch({ categories: p.categories, lat: p.lat, lng: p.lng, radiusKm: p.radiusKm, limit, offset: p.offset, offsetToken: p.offsetToken, tag: requestKey });
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
    log(`page ${p.page} of ${p.label}: no answer (${res.message}); marked for reconciliation`);
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
      await db.importTask.update({ where: { id: task.id }, data: { status: 'pending', params: { ...p, retries: p.retries + 1, page: p.page } as unknown as Prisma.InputJsonValue, error: res.message } });
      await new Promise(r => setTimeout(r, 5000 * 2 ** p.retries));
      return true;
    }
    await db.importTask.update({ where: { id: task.id }, data: { status: 'failed', error: `${res.code}: ${res.message}` } });
    await bump(run.id, { tasksFailed: 1 });
    return true;
  }

  // Success.
  await commit(db, requestKey, res.costUsd != null ? toMicros(res.costUsd) : null, estimate);
  const result = res.task.result?.[0];
  const items = (result?.items ?? []) as DfsItem[];
  let fresh = 0;
  let seen = 0;
  let skipped = 0;
  for (const it of items) {
    const m = mapItem(it);
    if (!m) {
      skipped++;
      continue;
    }
    const r = await upsertListing(run, m, s.publishProviderRatings);
    if (r === 'new') fresh++;
    else if (r === 'seen') seen++;
    else skipped++;
    if (fresh && (await stagedCount(run.id)) >= limitTotal) break;
  }
  const count = items.length;
  const next: DfsTaskParams = {
    ...p,
    page: p.page + 1,
    retries: 0,
    fetched: p.fetched + count,
    total: result?.total_count ?? p.total,
    offset: p.offset + count,
    offsetToken: result?.offset_token ?? undefined,
    requestKey: undefined,
  };
  const more = count >= limit && (next.offsetToken || next.offset < DFS_MAX_OFFSET) && (next.total == null || next.fetched < next.total);
  await db.importTask.update({ where: { id: task.id }, data: { status: more ? 'pending' : 'done', found: next.fetched, params: next as unknown as Prisma.InputJsonValue, error: null } });
  await bump(run.id, { dfsPages: 1, placesSeen: count, placesNew: fresh, placesRepeat: seen, placesSkipped: skipped });
  await setStats(run.id, { [`dfsTotal:${p.label}`]: result?.total_count ?? null });
  log(`${p.label}: page ${p.page} ${count} items (${fresh} new, ${seen} seen, ${skipped} skipped), provider matches ${result?.total_count ?? '?'}`);
  return true;
}
