// Legacy discovery with Google Places (New) grid and text search. Kept for existing runs; new runs use
// DataForSEO. Every call is reserved against the run budget and the kill switch before dispatch.

import { Prisma, type ImportRun, type RegionSlug } from '@prisma/client';
import { CITIES } from '../../../src/lib/catalog';
import { BudgetExceeded, commit, release, reserve, withCaps } from '../../../src/lib/import/budget';
import { categoriesFromGoogle, NEARBY_TYPES, OFF_TOPIC_TYPES, TEXT_QUERIES } from '../../../src/lib/import/categories';
import { boxKey, boxSideKm, boxTouchesIsrael, cityBox, ISRAEL_BOX, resolveCity, splitBox, tileBox, type Box } from '../../../src/lib/import/geo';
import { normName } from '../../../src/lib/import/match';
import { normalizeIlPhone } from '../../../src/lib/import/phone';
import { toMicros } from '../../../src/lib/import/pricing';
import { hoursFromGoogle, type RunScope } from '../../../src/lib/import/rules';
import { bump, db, heartbeat, log, setStats, settings, Stop } from '../ctx';
import { locality, PlacesError, searchNearby, searchText, supportedTypes, type GPlace, type Spend } from '../places';

const CITY_CELL_KM = 2;
const COUNTRY_CELL_KM = 6;
const MIN_CELL_KM = 0.15;
const TEXT_PAGES = 3;
// Nearby/Text Search with phone, website and hours fields bills at the Enterprise tier. Gross estimate.
const SEARCH_CALL_USD = Number(process.env.GOOGLE_SEARCH_CALL_USD ?? 0.04);

class Exhausted extends Error {}
const BEAUTY_TYPES = new Set([...NEARBY_TYPES, 'doctor', 'medical_clinic', 'dentist', 'dental_clinic', 'plastic_surgeon', 'health']);

let seq = 0;
function spender(run: ImportRun): Spend {
  return async () => {
    const s = await settings();
    if (s.killSwitch) throw new Stop('kill switch on');
    const n = await db.$executeRaw`UPDATE import_runs SET requests_used = requests_used + 1 WHERE id = ${run.id}::uuid AND requests_used < max_requests`;
    if (!n) throw new Exhausted();
    // Reserve and commit at the gross estimate (Google does not report per-call cost).
    const key = `gsearch:${run.id}:${Date.now()}:${seq++}`;
    const est = toMicros(SEARCH_CALL_USD);
    try {
      await reserve(db, withCaps({ runId: run.id, provider: 'google', endpoint: 'places:search', sku: 'search_enterprise', requestKey: key, estimateMicros: est }));
    } catch (e) {
      if (e instanceof BudgetExceeded) throw new Exhausted();
      throw e;
    }
    await commit(db, key, null, est).catch(() => release(db, key));
  };
}

export async function seedGoogle(run: ImportRun, scope: RunScope) {
  if ((run.stats as { seeded?: boolean }).seeded) return;
  const spend = spender(run);
  const tasks: Prisma.ImportTaskCreateManyInput[] = [];
  if (scope.nearby) {
    const types = await supportedTypes(NEARBY_TYPES, spend);
    await setStats(run.id, { types });
    const cells: Box[] = [];
    for (const slug of scope.cities) {
      const b = cityBox(slug);
      if (b) cells.push(...tileBox(b, CITY_CELL_KM));
    }
    if (scope.all) cells.push(...tileBox(ISRAEL_BOX, COUNTRY_CELL_KM).filter(boxTouchesIsrael));
    for (const box of cells) tasks.push({ runId: run.id, key: `n:${boxKey(box)}`, kind: 'nearby', params: { box, types: types.ok } });
  }
  if (scope.text) {
    const cities = scope.all ? CITIES.map(c => c.slug) : scope.cities;
    for (const slug of cities) {
      const city = CITIES.find(c => c.slug === slug)!;
      const box = cityBox(slug);
      if (!box) continue;
      for (const cat of scope.categories)
        for (const q of TEXT_QUERIES[cat] ?? [])
          tasks.push({ runId: run.id, key: `t:${slug}:${q}`, kind: 'text', params: { query: `${q} ${city.name.replace('–', ' ')}`, category: cat, box } });
    }
  }
  for (let i = 0; i < tasks.length; i += 1000) await db.importTask.createMany({ data: tasks.slice(i, i + 1000), skipDuplicates: true });
  await setStats(run.id, { seeded: true, seededTasks: tasks.length });
  log(`seeded ${tasks.length} Google search tasks`);
}

async function upsertGoogle(runId: string, g: GPlace, hint: string | null): Promise<'new' | 'seen' | 'skipped'> {
  if (!g.id || !g.location || !g.displayName?.text) return 'skipped';
  const name = g.displayName.text.trim();
  const types = g.types ?? [];
  const beautySignal = types.some(t => BEAUTY_TYPES.has(t)) || categoriesFromGoogle(types, name).length > 0;
  const cats = categoriesFromGoogle(types, name, hint && beautySignal ? { category: hint } : null);
  const where = resolveCity(locality(g), g.location.latitude, g.location.longitude);
  const provider = {
    name,
    nameNorm: normName(name),
    primaryType: g.primaryType ?? null,
    types,
    address: g.formattedAddress ?? '',
    lat: g.location.latitude,
    lng: g.location.longitude,
    googleRating: g.rating ?? null,
    googleReviewCount: g.userRatingCount ?? null,
    ratingProvider: g.rating != null ? 'google' : null,
    googleMapsUri: g.googleMapsUri ?? null,
    businessStatus: g.businessStatus ?? null,
    retrievedAt: new Date(),
  };
  const existing = await db.importPlace.findUnique({ where: { placeId: g.id }, select: { id: true, categories: true, crawl: true } });
  if (existing) {
    const edited = new Set(((existing.crawl as { editedFields?: string[] } | null)?.editedFields ?? []) as string[]);
    const data: Prisma.ImportPlaceUncheckedUpdateInput = { ...provider, runId, categories: edited.has('categories') ? undefined : [...new Set([...existing.categories, ...cats])] };
    if (edited.has('name')) {
      delete data.name;
      delete data.nameNorm;
    }
    await db.importPlace.update({ where: { id: existing.id }, data });
    return 'seen';
  }
  const phoneRaw = g.internationalPhoneNumber ?? g.nationalPhoneNumber ?? null;
  await db.importPlace.create({
    data: {
      placeId: g.id,
      provider: 'google',
      sourceId: g.id,
      sourceUrl: g.googleMapsUri ?? null,
      runId,
      ...provider,
      cityName: where.cityName,
      citySlug: where.citySlug,
      regionSlug: where.regionSlug as RegionSlug,
      phoneRaw,
      phone: normalizeIlPhone(phoneRaw),
      website: g.websiteUri ?? null,
      hours: (hoursFromGoogle(g.regularOpeningHours?.periods) ?? undefined) as Prisma.InputJsonValue | undefined,
      categories: cats,
      crawl: { offTopic: !beautySignal && types.some(t => OFF_TOPIC_TYPES.has(t)) },
    },
  });
  return 'new';
}

export async function discoverGoogle(run: ImportRun): Promise<boolean> {
  const spend = spender(run);
  const tasks = await db.importTask.findMany({ where: { runId: run.id, status: 'pending' }, orderBy: { createdAt: 'asc' }, take: 10 });
  if (!tasks.length) return false;
  for (const t of tasks) {
    await heartbeat(run.id);
    const p = t.params as unknown as { box: Box; types?: string[]; query?: string; category?: string };
    let found = 0;
    let fresh = 0;
    try {
      if (t.kind === 'nearby') {
        const places = await searchNearby(p.box, p.types ?? NEARBY_TYPES, spend);
        for (const g of places) {
          found++;
          if ((await upsertGoogle(run.id, g, null)) === 'new') fresh++;
        }
        if (places.length >= 20) {
          if (boxSideKm(p.box) > MIN_CELL_KM) {
            await db.importTask.createMany({
              data: splitBox(p.box).map(box => ({ runId: run.id, key: `n:${boxKey(box)}`, kind: 'nearby', params: { box, types: p.types } })),
              skipDuplicates: true,
            });
          } else await bump(run.id, { saturatedCells: 1 });
        }
      } else {
        let token: string | undefined;
        for (let page = 0; page < TEXT_PAGES; page++) {
          const r = await searchText(p.query!, p.box, token, spend);
          for (const g of r.places) {
            found++;
            if ((await upsertGoogle(run.id, g, p.category ?? null)) === 'new') fresh++;
          }
          if (!r.next) break;
          token = r.next;
          await new Promise(res => setTimeout(res, 1500));
        }
      }
      await db.importTask.update({ where: { id: t.id }, data: { status: 'done', found } });
      await bump(run.id, { tasksDone: 1, placesSeen: found, placesNew: fresh });
    } catch (e) {
      if (e instanceof Exhausted) {
        await setStats(run.id, { budgetHit: true });
        log('Google budget used, moving on with what was found');
        return false;
      }
      if (e instanceof Stop) throw e;
      const msg = e instanceof Error ? e.message.slice(0, 300) : 'failed';
      await db.importTask.update({ where: { id: t.id }, data: { status: 'failed', error: msg } });
      await bump(run.id, { tasksFailed: 1 });
      if (e instanceof PlacesError && (e.status === 401 || e.status === 403)) throw new Error(`Google Places rejected the key: ${msg}`);
      log('task failed', t.key, msg);
    }
  }
  return true;
}
