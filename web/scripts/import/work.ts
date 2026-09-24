// Directory import worker. Picks up a queued run from /ops/import and takes it through
// discover -> enrich -> extract -> check. Safe to stop at any point and start again: every step
// reads its state from the database, and a lease stops two workers from working the same run.
//
//   npm run import:work                      next queued run
//   npm run import:work -- --run <id>        a specific run
//   npm run import:work -- --max-minutes 30  stop after 30 minutes (resume later)
//
// Needs DATABASE_URL, GOOGLE_MAPS_API_KEY and ANTHROPIC_API_KEY. See docs/import.md.

import { appendFileSync } from 'node:fs';
import { promises as dns } from 'node:dns';
import { hostname } from 'node:os';
import { Prisma, PrismaClient, type ImportPlace, type ImportRun, type RegionSlug } from '@prisma/client';
import { CITIES } from '../../src/lib/catalog';
import { categoriesFromGoogle, NEARBY_TYPES, OFF_TOPIC_TYPES, TEXT_QUERIES } from '../../src/lib/import/categories';
import { cleanEmail, emailDomain, pickEmail } from '../../src/lib/import/email';
import { boxSideKm, boxTouchesIsrael, cityBox, ISRAEL_BOX, resolveCity, splitBox, tileBox, boxKey, type Box } from '../../src/lib/import/geo';
import { DUPLICATE_AT, isStrong, MatchPool, POSSIBLE_MATCH_AT, type PoolItem } from '../../src/lib/import/match';
import { normalizeIlPhone } from '../../src/lib/import/phone';
import { hoursFromGoogle, qualify, RunScope } from '../../src/lib/import/rules';
import { closeBrowser, crawlSite, crawlSocial } from './crawl';
import { searchBusiness } from './search';
import { extract } from './extract';
import { locality, PlacesError, searchNearby, searchText, supportedTypes, type GPlace, type Spend } from './places';

const db = new PrismaClient();
const WORKER = `${hostname()}-${process.pid}`;
const LEASE_MS = 10 * 60_000;
const CITY_CELL_KM = 2;
const COUNTRY_CELL_KM = 6;
const MIN_CELL_KM = 0.15;
const TEXT_PAGES = 3;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const deadline = Date.now() + Number(arg('max-minutes') ?? 330) * 60_000;
const timeLeft = () => Date.now() < deadline;
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

class BudgetExhausted extends Error {}
class Stop extends Error {}

// ---------- helpers ----------

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

type Stats = Record<string, unknown> & { counters?: Record<string, number> };

async function bump(runId: string, patch: Record<string, number>) {
  // Counters live in stats.counters; read-modify-write is fine with one worker per run (lease).
  const run = await db.importRun.findUniqueOrThrow({ where: { id: runId }, select: { stats: true } });
  const stats = (run.stats ?? {}) as Stats;
  const counters = { ...(stats.counters ?? {}) };
  for (const [k, v] of Object.entries(patch)) counters[k] = (counters[k] ?? 0) + v;
  await db.importRun.update({ where: { id: runId }, data: { stats: { ...stats, counters } as Prisma.InputJsonValue } });
}

async function setStats(runId: string, patch: Record<string, unknown>) {
  const run = await db.importRun.findUniqueOrThrow({ where: { id: runId }, select: { stats: true } });
  await db.importRun.update({ where: { id: runId }, data: { stats: { ...((run.stats ?? {}) as object), ...patch } as Prisma.InputJsonValue } });
}

/** Renews the lease and stops when staff paused or canceled the run from the admin. */
async function heartbeat(runId: string) {
  const r = await db.importRun.updateMany({
    where: { id: runId, lockedBy: WORKER, status: 'running' },
    data: { lockedUntil: new Date(Date.now() + LEASE_MS) },
  });
  if (!r.count) throw new Stop('run paused, canceled or taken over');
  if (!timeLeft()) throw new Stop('time budget used');
}

function spender(runId: string): Spend {
  return async () => {
    const n = await db.$executeRaw`UPDATE import_runs SET requests_used = requests_used + 1 WHERE id = ${runId}::uuid AND requests_used < max_requests`;
    if (!n) throw new BudgetExhausted();
  };
}

const mxCache = new Map<string, Promise<boolean | null>>();
/** true: domain accepts mail, false: it cannot, null: DNS did not answer (not held against the record). */
function hasMx(domain: string): Promise<boolean | null> {
  if (!mxCache.has(domain)) {
    const check = async (): Promise<boolean | null> => {
      try {
        const mx = await dns.resolveMx(domain);
        return mx.some(r => r.exchange && r.exchange !== '.');
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENODATA') {
          try {
            return (await dns.resolve4(domain)).length > 0; // implicit MX (RFC 5321)
          } catch {
            return false;
          }
        }
        if (code === 'ENOTFOUND' || code === 'NXDOMAIN') return false;
        return null;
      }
    };
    mxCache.set(domain, Promise.race([check(), new Promise<null>(r => setTimeout(() => r(null), 8000))]));
  }
  return mxCache.get(domain)!;
}

const BEAUTY_TYPES = new Set([...NEARBY_TYPES, 'doctor', 'medical_clinic', 'dentist', 'dental_clinic', 'plastic_surgeon', 'health']);

// ---------- discover ----------

async function seed(run: ImportRun, scope: RunScope, spend: Spend) {
  const stats = run.stats as Stats;
  if (stats.seeded) return;
  const tasks: Prisma.ImportTaskCreateManyInput[] = [];
  if (scope.nearby) {
    const types = await supportedTypes(NEARBY_TYPES, spend);
    await setStats(run.id, { types });
    log(`place types ok: ${types.ok.join(', ')}${types.dropped.length ? ` | dropped: ${types.dropped.join(', ')}` : ''}`);
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
  log(`seeded ${tasks.length} search tasks`);
}

async function upsertPlace(runId: string, g: GPlace, hint: string | null): Promise<'new' | 'seen' | 'skipped'> {
  if (!g.id || !g.location || !g.displayName?.text) return 'skipped';
  const name = g.displayName.text.trim();
  const types = g.types ?? [];
  const beautySignal = types.some(t => BEAUTY_TYPES.has(t)) || categoriesFromGoogle(types, name).length > 0;
  const cats = categoriesFromGoogle(types, name, hint && beautySignal ? { category: hint } : null);
  const where = resolveCity(locality(g), g.location.latitude, g.location.longitude);
  const google = {
    name,
    primaryType: g.primaryType ?? null,
    types,
    address: g.formattedAddress ?? '',
    lat: g.location.latitude,
    lng: g.location.longitude,
    googleRating: g.rating ?? null,
    googleReviewCount: g.userRatingCount ?? null,
    googleMapsUri: g.googleMapsUri ?? null,
    businessStatus: g.businessStatus ?? null,
  };
  const existing = await db.importPlace.findUnique({ where: { placeId: g.id }, select: { id: true, categories: true } });
  if (existing) {
    // Refresh what Google owns; never touch what staff edited or the pipeline derived.
    await db.importPlace.update({
      where: { id: existing.id },
      data: { ...google, runId, categories: [...new Set([...existing.categories, ...cats])] },
    });
    return 'seen';
  }
  const phoneRaw = g.internationalPhoneNumber ?? g.nationalPhoneNumber ?? null;
  await db.importPlace.create({
    data: {
      placeId: g.id,
      runId,
      ...google,
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

async function discover(run: ImportRun, spend: Spend): Promise<boolean> {
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
          if ((await upsertPlace(run.id, g, null)) === 'new') fresh++;
        }
        // A full page means the cell may hold more: split it and search the quarters.
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
            if ((await upsertPlace(run.id, g, p.category ?? null)) === 'new') fresh++;
          }
          if (!r.next) break;
          token = r.next;
          await new Promise(res => setTimeout(res, 1500)); // page tokens need a moment to become valid
        }
      }
      await db.importTask.update({ where: { id: t.id }, data: { status: 'done', found } });
      await bump(run.id, { tasksDone: 1, placesSeen: found, placesNew: fresh });
    } catch (e) {
      if (e instanceof BudgetExhausted) {
        await setStats(run.id, { budgetHit: true });
        log('Google request budget used, moving on with what was found');
        await db.importTask.updateMany({ where: { runId: run.id, status: 'pending' }, data: { status: 'failed', error: 'budget' } });
        return false;
      }
      if (e instanceof Stop) throw e;
      const msg = e instanceof Error ? e.message.slice(0, 300) : 'failed';
      await db.importTask.update({ where: { id: t.id }, data: { status: 'failed', error: msg } });
      await bump(run.id, { tasksFailed: 1 });
      // A bad key or a disabled API fails every call: stop the run instead of burning the budget.
      if (e instanceof PlacesError && (e.status === 401 || e.status === 403)) throw new Error(`Google Places rejected the key: ${msg}`);
      log('task failed', t.key, msg);
    }
  }
  return true;
}

// ---------- enrich ----------

type Src = 'site' | 'social' | 'search';

async function enrichOne(p: ImportPlace) {
  const crawl0 = (p.crawl ?? {}) as Record<string, unknown>;
  if (crawl0.offTopic && !p.categories.length) {
    await db.importPlace.update({ where: { id: p.id }, data: { status: 'enriched', enrichedAt: new Date(), crawl: { ...crawl0, skipped: 'off_topic' } } });
    return;
  }
  // 1. The business's own website.
  const c = await crawlSite(p.website);
  const found: Record<Src, string[]> = { site: c.emails, social: [], search: [] };
  const phones = [...c.phones];
  let facebook = c.facebook ?? p.facebook;
  let instagram = c.instagram ?? p.instagram;
  const sources: Record<string, string> = {};
  let extraText = '';

  // 2. Its public Facebook and Instagram pages, when the site gave no email.
  const readSocial = async () => {
    for (const [key, url] of [['facebook', facebook], ['instagram', instagram]] as const) {
      if (!url || sources[key] || found.site.length || found.social.length) continue;
      const r = await crawlSocial(url);
      sources[key] = r.status;
      found.social.push(...r.emails);
      phones.push(...r.phones);
      if (r.text) extraText += `\n\n## ${url}\n${r.text}`;
    }
  };
  await readSocial();

  // 3. A web search, still without an email: finds the email or the social pages.
  if (!found.site.length && !found.social.length) {
    const s = await searchBusiness({ name: p.name, city: p.cityName, website: p.website });
    sources.search = s.status;
    found.search.push(...s.emails);
    if (!facebook && s.facebook) facebook = s.facebook;
    if (!instagram && s.instagram) instagram = s.instagram;
    if (s.facebook || s.instagram) await readSocial();
  }

  const emails = [...new Set([...p.emails, ...found.site, ...found.social, ...found.search])];
  // Own-site addresses first, then the social page, then search results.
  let pick: { email: string; tier: 'own' | 'free' | 'other'; src: Src } | null = null;
  for (const src of ['site', 'social', 'search'] as const) {
    const got = pickEmail(found[src], p.website);
    if (got) {
      pick = { ...got, src };
      break;
    }
  }
  if (!pick && p.email) pick = { ...(pickEmail([p.email], p.website) ?? { email: p.email, tier: 'other' as const }), src: (p.emailSource as Src) ?? 'site' };
  const manual = p.emailSource === 'manual';
  const mx = !manual && pick ? await hasMx(emailDomain(pick.email)) : p.emailMx;
  const sitePhone = phones.find(Boolean) ?? null;
  const text = [c.text, extraText.trim()].filter(Boolean).join('\n\n');

  await db.importPlace.update({
    where: { id: p.id },
    data: {
      status: 'enriched',
      enrichedAt: new Date(),
      emails,
      email: manual ? p.email : pick?.email ?? null,
      emailSource: manual ? 'manual' : pick?.src ?? null,
      emailMx: manual ? p.emailMx : mx,
      phone: p.phone ?? sitePhone,
      whatsapp: c.whatsapp ?? p.whatsapp,
      instagram,
      facebook,
      crawl: {
        ...crawl0,
        pages: c.pages,
        skipped: c.skipped ?? null,
        rendered: c.pages.filter(x => x.via === 'browser').length,
        sources,
        emailTier: pick?.tier ?? null,
        sitePhones: [...new Set(phones)],
        text,
        extractError: null,
      },
    },
  });
}

async function enrich(run: ImportRun): Promise<boolean> {
  const places = await db.importPlace.findMany({ where: { runId: run.id, status: 'found' }, take: 16 });
  if (!places.length) return false;
  await heartbeat(run.id);
  await pool(places, 6, async p => {
    try {
      await enrichOne(p);
    } catch (e) {
      // One broken site must not stop the run: keep the Google data and move on.
      const msg = e instanceof Error ? e.message.slice(0, 200) : 'enrich_failed';
      await db.importPlace.update({ where: { id: p.id }, data: { status: 'enriched', enrichedAt: new Date(), crawl: { ...((p.crawl ?? {}) as object), skipped: 'unreachable', enrichError: msg } } });
    }
  });
  await bump(run.id, { enriched: places.length });
  return true;
}

// ---------- extract ----------

let transientStreak = 0;

async function extractBatch(run: ImportRun): Promise<boolean> {
  const places = await db.importPlace.findMany({ where: { runId: run.id, status: 'enriched' }, orderBy: { enrichedAt: 'asc' }, take: 6 });
  if (!places.length) return false;
  await heartbeat(run.id);
  let fatal: string | null = null;
  await pool(places, 2, async p => {
    if (fatal) return;
    const crawl = (p.crawl ?? {}) as Record<string, unknown>;
    const text = typeof crawl.text === 'string' ? crawl.text : '';
    const done = (data: Prisma.ImportPlaceUpdateInput) =>
      db.importPlace.update({ where: { id: p.id }, data: { status: 'extracted', extractedAt: new Date(), ...data } });

    if (text.length < 200) return void (await done({}));
    const fresh = await db.importRun.findUniqueOrThrow({ where: { id: run.id }, select: { maxExtractions: true, extractionsUsed: true } });
    if (fresh.maxExtractions != null && fresh.extractionsUsed >= fresh.maxExtractions) {
      return void (await done({ crawl: { ...crawl, extractSkipped: 'budget' } }));
    }
    const r = await extract({ name: p.name, address: p.address, types: p.types, text });
    if (!r.ok) {
      if (r.fatal) {
        fatal = r.error;
        return;
      }
      if (r.transient) {
        // Busy or rate limited: leave the record for the next pass instead of marking it failed.
        transientStreak++;
        await db.importPlace.update({ where: { id: p.id }, data: { enrichedAt: new Date() } });
        return;
      }
      await db.importRun.update({ where: { id: run.id }, data: { extractionsUsed: { increment: 1 } } });
      await bump(run.id, { extractFailed: 1 });
      await setStats(run.id, { lastExtractError: r.error });
      return void (await done({ crawl: { ...crawl, extractError: r.error } }));
    }
    transientStreak = 0;
    await db.importRun.update({ where: { id: run.id }, data: { extractionsUsed: { increment: 1 } } });
    const d = r.data;
    // Keep only addresses Claude saw that also pass our own checks and appear in what we collected.
    const known = new Set(p.emails);
    const extraEmails = d.emails.map(e => cleanEmail(e)).filter((e): e is string => !!e && known.has(e));
    const emails = [...new Set([...p.emails, ...extraEmails])];
    await done({
      categories: d.categories.length ? d.categories : p.categories,
      businessType: d.businessType,
      description: d.description?.replace(/\s*—\s*/g, ', ') ?? null,
      treatments: d.treatments as unknown as Prisma.InputJsonValue,
      emails,
      crawl: { ...crawl, notBeauty: !d.isBeautyBusiness, tokens: [r.inputTokens, r.outputTokens] },
    });
    await bump(run.id, { extracted: 1, tokensIn: r.inputTokens, tokensOut: r.outputTokens });
  });
  // Every call fails the same way (bad key, no credit, unknown model): stop and say why.
  if (fatal) throw new Error(`Claude: ${fatal}`);
  if (transientStreak >= 6) {
    log('Claude is rate limiting, waiting a minute');
    await setStats(run.id, { lastExtractError: 'rate_limited (waiting)' });
    await new Promise(r => setTimeout(r, 60_000));
    transientStreak = 0;
  }
  return true;
}

// ---------- check (dedupe, match, qualify) ----------

const OPEN: ImportPlace['status'][] = ['extracted', 'ready', 'needs_review', 'incomplete', 'duplicate', 'closed'];

async function check(run: ImportRun) {
  await heartbeat(run.id);
  // Whole import, not just this run, so a business found by two runs is still one record.
  const places = await db.importPlace.findMany({
    where: { status: { in: [...OPEN, 'approved', 'merged'] } },
    orderBy: { createdAt: 'asc' },
  });
  const branches = await db.branch.findMany({
    select: { id: true, name: true, lat: true, lng: true, phone: true, email: true, websiteUrl: true, googlePlaceId: true },
  });

  const branchPool = new MatchPool();
  for (const b of branches) branchPool.add({ id: b.id, kind: 'branch', name: b.name, lat: b.lat, lng: b.lng, phone: b.phone, email: b.email, website: b.websiteUrl, googlePlaceId: b.googlePlaceId });

  const importPool = new MatchPool();
  const dupIds = new Set<string>();
  const updates: Array<{ id: string; data: Prisma.ImportPlaceUpdateInput }> = [];
  const asItem = (p: ImportPlace): PoolItem => ({ id: p.id, kind: 'import', name: p.name, lat: p.lat, lng: p.lng, phone: p.phone, email: p.email, website: p.website, googlePlaceId: p.placeId });

  for (const p of places) {
    const item = asItem(p);
    const final = p.status === 'approved' || p.status === 'merged' || (p.status === 'duplicate' && p.reviewedById);
    if (final) {
      if (p.status === 'duplicate') dupIds.add(p.id);
      else importPool.add(item);
      continue;
    }

    const twin = importPool.best(item, p.id);
    if (twin && twin.score >= DUPLICATE_AT && isStrong(twin.reasons)) {
      dupIds.add(p.id);
      updates.push({ id: p.id, data: { status: 'duplicate', dupOfId: twin.item.id, reasons: twin.reasons, matchReasons: twin.reasons } });
      continue;
    }
    importPool.add(item);

    const existing = branchPool.best({ ...item }, undefined);
    const crawl = (p.crawl ?? {}) as Record<string, unknown>;
    if (existing && existing.reasons.includes('same_place_id')) {
      // Already a listing made from this very place: nothing to review.
      updates.push({ id: p.id, data: { status: 'merged', branchId: existing.item.id, matchBranchId: existing.item.id, matchScore: 1, matchReasons: existing.reasons } });
      continue;
    }
    const possible = !!existing && existing.score >= POSSIBLE_MATCH_AT;
    const maybeTwin = twin && twin.score >= POSSIBLE_MATCH_AT ? twin : null;
    const tier = p.emailSource === 'manual' ? 'own' : ((crawl.emailTier as 'own' | 'free' | 'other' | null | undefined) ?? pickEmail(p.email ? [p.email] : [], p.website)?.tier ?? null);
    const q = qualify({
      name: p.name,
      phone: p.phone,
      email: p.email,
      emailMx: p.emailMx,
      emailTier: tier,
      categories: p.categories,
      businessStatus: p.businessStatus,
      citySlug: p.citySlug,
      notBeauty: crawl.notBeauty === true || crawl.skipped === 'off_topic',
      extractionFailed: typeof crawl.extractError === 'string',
      emailFromSearch: p.emailSource === 'search',
      possibleExisting: possible,
      possibleDuplicate: !!maybeTwin,
      sharedPhone: false,
    });
    updates.push({
      id: p.id,
      data: {
        status: q.status,
        reasons: q.reasons,
        dupOfId: maybeTwin?.item.id ?? null, // a suggestion while the status is not "duplicate"
        matchBranchId: possible ? existing!.item.id : null,
        matchScore: possible ? existing!.score : null,
        matchReasons: possible ? existing!.reasons : [],
      },
    });
  }

  // Same phone as a different business (not a duplicate): a person should look.
  const phonePool = new MatchPool();
  for (const p of places) if (!dupIds.has(p.id) && p.status !== 'closed') phonePool.add(asItem(p));
  for (const b of branches) phonePool.add({ id: b.id, kind: 'branch', name: b.name, lat: b.lat, lng: b.lng, phone: b.phone, email: null, website: null });
  const byId = new Map(places.map(p => [p.id, p]));
  for (const u of updates) {
    const status = u.data.status as string;
    if (status !== 'ready' && status !== 'needs_review') continue;
    const p = byId.get(u.id)!;
    const skip = new Set<string>([...(p.matchBranchId ? [p.matchBranchId] : []), ...((u.data.matchBranchId as string | null) ? [u.data.matchBranchId as string] : [])]);
    if (phonePool.sharesPhone(asItem(p), p.id, skip)) {
      const reasons = [...((u.data.reasons as string[]) ?? []), 'shared_phone'];
      u.data = { ...u.data, status: 'needs_review', reasons };
    }
  }

  for (let i = 0; i < updates.length; i += 200) {
    await db.$transaction(updates.slice(i, i + 200).map(u => db.importPlace.update({ where: { id: u.id }, data: u.data })));
  }

  // Keep Google ratings on listings made from imports fresh.
  const linked = places.filter(p => p.branchId && (p.status === 'approved' || p.status === 'merged'));
  for (const p of linked) {
    await db.branch.updateMany({
      where: { id: p.branchId!, googlePlaceId: p.placeId },
      data: { googleRating: p.googleRating, googleReviewCount: p.googleReviewCount, googlePlaceUrl: p.googleMapsUri, googleSyncedAt: new Date() },
    });
  }

  const counts = await db.importPlace.groupBy({ by: ['status'], where: { runId: run.id }, _count: true });
  await setStats(run.id, { byStatus: Object.fromEntries(counts.map(c => [c.status, c._count])) });
  log(`checked ${updates.length} records`);
}

// ---------- run loop ----------

async function claim(runId?: string): Promise<ImportRun | null> {
  const now = new Date();
  const candidates = await db.importRun.findMany({
    where: {
      ...(runId ? { id: runId } : {}),
      status: { in: ['queued', 'running'] },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }, { lockedBy: WORKER }],
    },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });
  for (const c of candidates) {
    const r = await db.importRun.updateMany({
      where: { id: c.id, status: { in: ['queued', 'running'] }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }, { lockedBy: WORKER }] },
      data: { status: 'running', lockedBy: WORKER, lockedUntil: new Date(Date.now() + LEASE_MS), startedAt: c.startedAt ?? now },
    });
    if (r.count) return db.importRun.findUniqueOrThrow({ where: { id: c.id } });
  }
  return null;
}

async function work(run: ImportRun): Promise<'done' | 'stopped'> {
  const scope = RunScope.parse(run.scope);
  const spend = spender(run.id);
  log(`run ${run.id} "${run.label}"`);
  try {
    await seed(run, scope, spend);
    while (await discover(run, spend));
    while (await enrich(run));
    while (await extractBatch(run));
    await check(run);
    await db.importRun.updateMany({ where: { id: run.id, lockedBy: WORKER }, data: { status: 'done', finishedAt: new Date(), lockedBy: null, lockedUntil: null } });
    log('run done');
    return 'done';
  } catch (e) {
    if (e instanceof Stop) {
      // Paused or out of time: release the lease so the next worker (or a resume) carries on.
      await db.importRun.updateMany({ where: { id: run.id, lockedBy: WORKER }, data: { lockedBy: null, lockedUntil: null } });
      log('stopped:', e.message);
      return 'stopped';
    }
    const msg = e instanceof Error ? e.message.slice(0, 500) : String(e);
    await db.importRun.updateMany({ where: { id: run.id, lockedBy: WORKER }, data: { status: 'failed', error: msg, lockedBy: null, lockedUntil: null } });
    log('run failed:', msg);
    return 'done';
  }
}

async function main() {
  const only = arg('run');
  let more = false;
  while (timeLeft()) {
    const run = await claim(only);
    if (!run) break;
    const r = await work(run);
    if (r === 'stopped') {
      const now = await db.importRun.findUnique({ where: { id: run.id }, select: { status: true } });
      more = now?.status === 'running';
      break;
    }
    if (only) break;
  }
  if (!more) more = (await db.importRun.count({ where: { status: { in: ['queued', 'running'] } } })) > 0 && !timeLeft();
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `more=${more}\n`);
  log(more ? 'work left, another worker should continue' : 'nothing left to do');
}

main()
  .catch(e => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser();
    await db.$disconnect();
  });
