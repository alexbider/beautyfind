// Database tests for spend control, interrupted paid requests, staff edits and retention.
// Needs a migrated local Postgres in DATABASE_URL (never a shared or production database); skipped
// otherwise. Paid providers are replaced by a loopback mock: nothing here spends money.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { ImportRun, PrismaClient } from '@prisma/client';
import { startMockDfs, fakeItems, type MockDfs } from '../../scripts/import/sim/fixtures';

const URL_OK = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const skip = URL_OK ? false : 'needs a local DATABASE_URL';

let db: PrismaClient;
let dfs: MockDfs;
type Stages = typeof import('../../scripts/import/stages/dfsDiscover');
type Ctx = typeof import('../../scripts/import/ctx');
type Budget = typeof import('../../src/lib/import/budget');
let stages: Stages;
let ctx: Ctx;
let budget: Budget;
const runs: string[] = [];

async function newRun(over: Partial<ImportRun> = {}): Promise<ImportRun> {
  const r = await db.importRun.create({
    data: {
      label: `test ${Date.now()}`, provider: 'dataforseo', scope: { all: false, cities: ['tel-aviv'], categories: ['nails'], nearby: false, text: false },
      maxRequests: 0, recordLimit: 50, budgetMicros: 1_000_000n, status: 'running', lockedBy: ctx.WORKER, lockedUntil: new Date(Date.now() + 600_000),
      ...(over as object),
    },
  });
  runs.push(r.id);
  return r;
}

describe('import database behaviour', { skip }, () => {
  before(async () => {
    const { items } = fakeItems(30, null);
    dfs = await startMockDfs(items);
    process.env.DATAFORSEO_BASE_URL = dfs.url;
    process.env.DATAFORSEO_LOGIN = 'test';
    process.env.DATAFORSEO_PASSWORD = 'test';
    ctx = await import('../../scripts/import/ctx');
    stages = await import('../../scripts/import/stages/dfsDiscover');
    budget = await import('../../src/lib/import/budget');
    db = ctx.db;
    await db.importSettings.deleteMany({ where: { id: 1 } });
  });
  after(async () => {
    await db.importPlace.deleteMany({ where: { runId: { in: runs } } });
    await db.importCoverage.deleteMany({ where: { runId: { in: runs } } });
    await db.spendEntry.deleteMany({ where: { OR: [{ runId: { in: runs } }, { requestKey: { startsWith: 'test:' } }] } });
    await db.providerBudget.deleteMany({ where: { key: { startsWith: 'test:' } } });
    await db.importRun.deleteMany({ where: { id: { in: runs } } });
    await db.$disconnect();
    await dfs.close();
  });

  it('concurrent reservations never exceed the run budget', async () => {
    const run = await newRun({ budgetMicros: 1000n });
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, (_, i) => budget.reserve(db, { runId: run.id, provider: 'dataforseo', endpoint: 't', requestKey: `test:c:${run.id}:${i}`, estimateMicros: 100n })),
    );
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const refused = results.filter(r => r.status === 'rejected' && r.reason instanceof budget.BudgetExceeded).length;
    assert.equal(ok, 10);
    assert.equal(refused, 6);
    const after = await db.importRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(after.reservedMicros, 1000n);
  });

  it('concurrent reservations never exceed a provider cap', async () => {
    const cap = { key: `test:cap:${Date.now()}`, limitMicros: 500n };
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => budget.reserve(db, budget.withCaps({ runId: null, provider: 'google', endpoint: 't', requestKey: `test:cap:${cap.key}:${i}`, estimateMicros: 100n, caps: [cap] }))),
    );
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 5);
    const row = await db.providerBudget.findUniqueOrThrow({ where: { key: cap.key } });
    assert.equal(row.reservedMicros, 500n);
  });

  it('settling is idempotent and a request key is never billed twice', async () => {
    const run = await newRun({ budgetMicros: 10_000n });
    const key = `test:idem:${run.id}`;
    assert.equal(await budget.reserve(db, { runId: run.id, provider: 'dataforseo', endpoint: 't', requestKey: key, estimateMicros: 1000n }), 'reserved');
    assert.equal(await budget.reserve(db, { runId: run.id, provider: 'dataforseo', endpoint: 't', requestKey: key, estimateMicros: 1000n }), 'exists');
    await budget.commit(db, key, 400n, 1000n);
    await budget.commit(db, key, 400n, 1000n);
    const r = await db.importRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(r.spentMicros, 400n);
    assert.equal(r.reservedMicros, 0n);
  });

  it('a paid page with no answer is marked for reconciliation and not resent', async () => {
    const run = await newRun();
    await stages.seedDfs(run, { all: false, cities: ['tel-aviv'], categories: ['nails'], nearby: false, text: false });
    dfs.setMode('hang');
    const before = dfs.requests.length;
    assert.equal(await stages.discoverDfs(run), true);
    assert.equal(dfs.requests.length, before + 1);
    const task = await db.importTask.findFirstOrThrow({ where: { runId: run.id } });
    assert.equal(task.status, 'needs_reconciliation');
    const spend = await db.spendEntry.findFirstOrThrow({ where: { runId: run.id } });
    assert.equal(spend.status, 'needs_reconciliation');
    const r = await db.importRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(r.spentMicros, spend.estimatedMicros); // counted conservatively
    assert.equal(r.reservedMicros, 0n);
    // The worker moves on; the uncertain page is not sent again.
    dfs.setMode('ok');
    assert.equal(await stages.discoverDfs(run), false);
    assert.equal(dfs.requests.length, before + 1);
  });

  it('a fatal provider error stops the run without spending', async () => {
    const run = await newRun();
    await stages.seedDfs(run, { all: false, cities: ['tel-aviv'], categories: ['nails'], nearby: false, text: false });
    dfs.setMode('fatal');
    await assert.rejects(stages.discoverDfs(run), /40200/);
    dfs.setMode('ok');
    const r = await db.importRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(r.spentMicros, 0n);
    assert.equal(r.reservedMicros, 0n);
    assert.equal((await db.importTask.findFirstOrThrow({ where: { runId: run.id } })).status, 'pending');
  });

  it('stages each place once, skips records without coordinates, and respects the record limit', async () => {
    const run = await newRun({ recordLimit: 20 });
    await stages.seedDfs(run, { all: false, cities: ['tel-aviv'], categories: ['nails'], nearby: false, text: false });
    while (await stages.discoverDfs(run));
    const n = await db.importPlace.count({ where: { runId: run.id } });
    assert.equal(n, 20);
    const r = await db.importRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.ok(r.spentMicros > 0n && r.spentMicros <= r.budgetMicros!);
    assert.equal(r.reservedMicros, 0n);
    // The Google rating is publishable by default; a business with no website gets its Google profile link.
    const rating = await db.fieldObservation.findFirst({ where: { importPlace: { runId: run.id }, field: 'rating' } });
    assert.equal(rating?.publishable, true);
    const noSite = await db.importPlace.findFirst({ where: { runId: run.id, websiteKind: 'google_profile' } });
    assert.ok(noSite?.website?.startsWith('https://www.google.com/maps?cid='));
  });

  it('a count run stores the provider total per city and category, pays one request per pair, and skips fresh pairs', async () => {
    const count = await import('../../scripts/import/stages/count');
    dfs.setMode('ok');
    await db.importCoverage.deleteMany({ where: { citySlug: 'tel-aviv', categorySlug: { in: ['nails', 'facials'] } } });
    const run = await newRun({ provider: 'count', recordLimit: null, scope: { all: false, cities: ['tel-aviv'], categories: ['nails', 'facials'] } });
    await count.seedCount(run, { all: false, cities: ['tel-aviv'], categories: ['nails', 'facials'] });
    assert.equal(await db.importTask.count({ where: { runId: run.id, kind: 'count' } }), 2);
    const before = dfs.requests.length;
    while (await count.countStage(run));
    assert.equal(dfs.requests.length, before + 2);
    const rows = await db.importCoverage.findMany({ where: { citySlug: 'tel-aviv', categorySlug: { in: ['nails', 'facials'] } } });
    assert.equal(rows.length, 2);
    assert.ok(rows.every(r => r.providerTotal != null && r.providerTotal > 0 && r.runId === run.id));
    const spent = await db.importRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.ok(spent.spentMicros > 0n && spent.reservedMicros === 0n);
    // A second count of the same pairs asks nothing: they were counted a moment ago.
    const again = await newRun({ provider: 'count', recordLimit: null, scope: { all: false, cities: ['tel-aviv'], categories: ['nails', 'facials'] } });
    await count.seedCount(again, { all: false, cities: ['tel-aviv'], categories: ['nails', 'facials'] });
    assert.equal(await db.importTask.count({ where: { runId: again.id } }), 0);
    assert.equal(((await db.importRun.findUniqueOrThrow({ where: { id: again.id } })).stats as { skippedFresh?: number }).skippedFresh, 2);
  });

  it('a value with a lone surrogate (an emoji cut in half) is stored cleaned instead of failing the write', async () => {
    const run = await newRun();
    const place = await db.importPlace.create({ data: { placeId: `test:surrogate:${run.id}`, runId: run.id, name: 'סלון 😀'.slice(0, 6), address: 'x', lat: 32.08, lng: 34.78, description: 'תיאור \uD83D חתוך', categories: ['nails'] } });
    assert.equal(place.name, 'סלון ');
    assert.equal(place.description, 'תיאור  חתוך');
    await db.$transaction([
      db.fieldObservation.deleteMany({ where: { importPlaceId: place.id, provider: 'test' } }),
      db.fieldObservation.createMany({ data: [{ importPlaceId: place.id, field: 'description', value: { text: 'ביו \uDE00 קטוע', tags: ['a\u0000b'] }, provider: 'test', retrievedAt: new Date(), confidence: 0.5, publishable: false }] }),
    ]);
    const obs = await db.fieldObservation.findFirstOrThrow({ where: { importPlaceId: place.id, provider: 'test' } });
    assert.deepEqual(obs.value, { text: 'ביו  קטוע', tags: ['ab'] });
  });

  it('a rerun never overwrites fields staff edited', async () => {
    const run1 = await newRun({ recordLimit: 5 });
    await stages.seedDfs(run1, { all: false, cities: ['tel-aviv'], categories: ['nails'], nearby: false, text: false });
    while (await stages.discoverDfs(run1));
    const p = await db.importPlace.findFirstOrThrow({ where: { runId: run1.id, phone: { not: null } } });
    await db.importPlace.update({ where: { id: p.id }, data: { name: 'שם שנערך ידנית', phone: '+972525551234', crawl: { ...((p.crawl as object) ?? {}), editedFields: ['name', 'phone'] } } });
    const run2 = await newRun({ recordLimit: 50 });
    await stages.seedDfs(run2, { all: false, cities: ['tel-aviv'], categories: ['nails'], nearby: false, text: false });
    while (await stages.discoverDfs(run2));
    const again = await db.importPlace.findUniqueOrThrow({ where: { id: p.id } });
    assert.equal(again.runId, run2.id); // seen again by the new run
    // 32 provider items: one repeat of the same place and one without coordinates.
    assert.equal(await db.importPlace.count({ where: { runId: run2.id } }), 30);
    assert.equal(again.name, 'שם שנערך ידנית');
    assert.equal(again.phone, '+972525551234');
    runs.push(run1.id);
  });

  it('deletes restricted data once its retention ends', async () => {
    const { sweepExpired } = await import('../../src/lib/import/retention');
    const id = `test-${Date.now()}`;
    await db.googleDisplay.createMany({
      data: [
        { placeId: `${id}-old`, fields: { location: { latitude: 1, longitude: 1 } }, sku: 'essentials', fetchedAt: new Date(), expiresAt: new Date(Date.now() - 1000) },
        { placeId: `${id}-new`, fields: { id: 'x' }, sku: 'essentials', fetchedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) },
      ],
    });
    const obs = await db.fieldObservation.create({ data: { field: 'rating', value: 4.5, provider: 'google', retrievedAt: new Date(), expiresAt: new Date(Date.now() - 1000), publishable: false } });
    await sweepExpired(db);
    assert.equal(await db.googleDisplay.count({ where: { placeId: `${id}-old` } }), 0);
    assert.equal(await db.googleDisplay.count({ where: { placeId: `${id}-new` } }), 1);
    assert.equal(await db.fieldObservation.count({ where: { id: obs.id } }), 0);
    await db.googleDisplay.deleteMany({ where: { placeId: { startsWith: id } } });
  });
});

describe('enhancing published listings', { skip }, () => {
  let web: { port: number; close: () => Promise<void> };
  let pdb: PrismaClient;
  const made: { businesses: string[]; places: string[]; runs: string[] } = { businesses: [], places: [], runs: [] };
  before(async () => {
    process.env.IMPORT_TEST_ALLOW_PRIVATE = '1';
    process.env.UPLOAD_DIR = `${process.env.TMPDIR ?? '/tmp'}/bf-test-uploads`;
    process.env.IMPORT_IMAGE_QUALITY = '0'; // fixture images are flat colours
    const { startSites } = await import('../../scripts/import/sim/fixtures');
    web = await startSites([{ host: 'enh.test', kind: 'full' }]);
    pdb = (await import('../../scripts/import/ctx')).db;
  });
  after(async () => {
    await pdb.importPlace.deleteMany({ where: { id: { in: made.places } } });
    await pdb.business.deleteMany({ where: { id: { in: made.businesses } } });
    await pdb.importRun.deleteMany({ where: { id: { in: made.runs } } });
    await web.close();
  });

  async function listing(claimed: boolean) {
    const biz = await pdb.business.create({ data: { status: 'live', type: 'salon' } });
    made.businesses.push(biz.id);
    const b = await pdb.branch.create({
      data: {
        businessId: biz.id, name: 'סלון להעשרה', slug: `enh-${biz.id.slice(0, 8)}`, regionSlug: 'dan', cityName: 'תל אביב', address: 'רחוב 1', lat: 32.08, lng: 34.78,
        status: 'live', isClaimed: claimed, phone: '+97235550000', description: 'תיאור שכתב הצוות',
        categories: { create: [{ categorySlug: 'nails' }] }, treatments: { create: [{ name: 'מניקור', priceAgorot: 0, isPublished: false }] },
      },
    });
    const u = `http://enh.test:${web.port}`;
    const run = await pdb.importRun.create({ data: { label: 'enhance test', provider: 'dataforseo', scope: {}, maxRequests: 0 } });
    made.runs.push(run.id);
    const p = await pdb.importPlace.create({
      data: {
        runId: run.id,
        placeId: `enh-${b.id}`, provider: 'dataforseo', name: 'סלון להעשרה', address: 'רחוב 1', lat: 32.08, lng: 34.78, status: 'approved', branchId: b.id,
        phone: '+97239999999', email: 'info@enh.test', website: `${u}/`, hours: [{ open: '09:00', close: '19:00', closed: false }], description: 'תיאור מהמקור',
        categories: ['nails', 'brows-lashes'], treatments: [{ name: 'מניקור', priceNis: 120, priceType: 'fixed', category: 'nails', isMedical: false, durationMin: null }, { name: 'הרמת ריסים', priceNis: 220, priceType: 'fixed', category: 'brows-lashes', isMedical: false, durationMin: null }],
        logoUrl: `${u}/logo.png`, photoUrls: [`${u}/img/photo-1.png`, `${u}/img/photo-2.png`], accessible: true, freeParking: true, faqs: [{ q: 'ש', a: 'ת' }],
        googleRating: 4.6, googleReviewCount: 40, ratingProvider: 'dataforseo', googleMapsUri: 'https://www.google.com/maps?cid=1',
      },
    });
    made.places.push(p.id);
    return { b, p };
  }

  it('fills only what is missing and never overwrites', async () => {
    const { enhanceBranch } = await import('../../src/lib/server/importEnhance');
    const { DEFAULT_SETTINGS } = await import('../../src/lib/import/settings');
    const actor = (await pdb.user.findFirst({ select: { id: true } })) ?? (await pdb.user.create({ data: {}, select: { id: true } }));
    const { b, p } = await listing(false);
    const r = await enhanceBranch(b.id, p, DEFAULT_SETTINGS, actor!.id);
    const after = await pdb.branch.findUniqueOrThrow({ where: { id: b.id }, include: { treatments: true, categories: true } });
    assert.equal(after.phone, '+97235550000'); // kept
    assert.equal(after.description, 'תיאור שכתב הצוות'); // kept
    assert.equal(after.email, 'info@enh.test');
    assert.ok(after.logoUrl?.startsWith('/media/') && after.coverUrl?.startsWith('/media/'));
    assert.equal(after.accessible && after.freeParking, true);
    assert.equal(after.googleRating, 4.6);
    assert.deepEqual(after.categories.map(c => c.categorySlug).sort(), ['brows-lashes', 'nails']);
    assert.equal(after.treatments.length, 2);
    assert.ok((after.treatments.find(t => t.name === 'מניקור')!.priceAgorot ?? 0) > 0); // missing price filled
    assert.ok(r.filled.includes('logo') && r.filled.includes('services') && r.filled.includes('prices'));
  });

  it('leaves claimed listings alone', async () => {
    const { enhanceBranch } = await import('../../src/lib/server/importEnhance');
    const { DEFAULT_SETTINGS } = await import('../../src/lib/import/settings');
    const actor = await pdb.user.findFirst({ select: { id: true } });
    const { b, p } = await listing(true);
    const r = await enhanceBranch(b.id, p, DEFAULT_SETTINGS, actor!.id);
    assert.equal(r.skipped, 'claimed');
    const after = await pdb.branch.findUniqueOrThrow({ where: { id: b.id } });
    assert.equal(after.email, null);
  });

  it('a bulk publish creates the listing without images, and the pending-images step copies them afterwards', async () => {
    const { approvePlace } = await import('../../src/lib/server/importOps');
    const { countPendingImages, copyPendingImages } = await import('../../src/lib/server/importEnhance');
    const { DEFAULT_SETTINGS } = await import('../../src/lib/import/settings');
    const actor = (await pdb.user.findFirst({ select: { id: true } })) ?? (await pdb.user.create({ data: {}, select: { id: true } }));
    const u = `http://enh.test:${web.port}`;
    const run = await pdb.importRun.create({ data: { label: 'publish test', provider: 'dataforseo', scope: {}, maxRequests: 0 } });
    made.runs.push(run.id);
    const p = await pdb.importPlace.create({
      data: {
        runId: run.id, placeId: `pub-${run.id}`, provider: 'dataforseo', name: 'סלון לפרסום מהיר', address: 'רחוב 2', lat: 32.08, lng: 34.78, status: 'ready',
        regionSlug: 'dan', cityName: 'תל אביב', phone: '+97235550001', email: 'info@enh.test', website: `${u}/`, categories: ['nails'],
        logoUrl: `${u}/logo.png`, photoUrls: [`${u}/img/photo-1.png`, `${u}/img/photo-2.png`],
      },
    });
    made.places.push(p.id);
    const before = await countPendingImages();
    const t0 = Date.now();
    const r = await approvePlace(actor, p.id, { images: false });
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(Date.now() - t0 < 5000, 'publishing without images must be quick');
    const b = await pdb.branch.findUniqueOrThrow({ where: { id: r.ok ? r.branchId : '' } });
    made.businesses.push(b.businessId);
    assert.equal(b.logoUrl, null);
    assert.equal(await countPendingImages(), before + 1); // waits for the image step
    const copied = await copyPendingImages(DEFAULT_SETTINGS, actor.id, 50);
    assert.ok(copied.done >= 1);
    const after = await pdb.branch.findUniqueOrThrow({ where: { id: b.id } });
    assert.ok(after.logoUrl, 'logo copied by the pending-images step');
    assert.notEqual(after.coverUrl, b.coverUrl);
  });

  it('branches found under one business website are published as one business with several branches', async () => {
    const { approvePlace } = await import('../../src/lib/server/importOps');
    const actor = (await pdb.user.findFirst({ select: { id: true } })) ?? (await pdb.user.create({ data: {}, select: { id: true } }));
    const run = await pdb.importRun.create({ data: { label: 'chain test', provider: 'dataforseo', scope: {}, maxRequests: 0 } });
    made.runs.push(run.id);
    const domain = `chain-${run.id.slice(0, 8)}.test`;
    const mk = (name: string, city: string, slug: string) =>
      pdb.importPlace.create({
        data: {
          runId: run.id, placeId: `chain-${run.id}-${slug}`, provider: 'dataforseo', name, address: `רחוב 1, ${city}`, lat: 32.08, lng: 34.78, status: 'ready',
          regionSlug: 'dan', cityName: city, citySlug: slug, phone: '+97235550002', website: `https://www.${domain}/`, websiteKind: 'own', siteDomain: domain, categories: ['hair-salons'],
        },
      });
    const a = await mk('פרופורציה תל אביב', 'תל אביב', 'tel-aviv');
    const b = await mk('פרופורציה רמת גן', 'רמת גן', 'ramat-gan');
    const c = await mk('קליניקת רותי', 'גבעתיים', 'givatayim'); // same domain, unrelated name: not the chain
    made.places.push(a.id, b.id, c.id);
    const ra = await approvePlace(actor, a.id, { images: false });
    const rb = await approvePlace(actor, b.id, { images: false });
    const rc = await approvePlace(actor, c.id, { images: false });
    assert.ok(ra.ok && rb.ok && rc.ok);
    const [ba, bb, bc] = await Promise.all([ra, rb, rc].map(r => pdb.branch.findUniqueOrThrow({ where: { id: r.ok ? r.branchId : '' } })));
    made.businesses.push(ba.businessId, bc.businessId);
    assert.equal(ba.businessId, bb.businessId, 'two branches of the chain share one business');
    assert.notEqual(ba.businessId, bc.businessId, 'an unrelated name on the same domain stays separate');
    const biz = await pdb.business.findUniqueOrThrow({ where: { id: ba.businessId } });
    assert.equal(biz.chainKey, domain);
    // The claim flow offers the sibling branch of the same business.
    const { siblingBranches } = await import('../../src/app/for-business/claim/data');
    const sib = await siblingBranches(ba.id);
    assert.deepEqual(sib.map(x => x.id), [bb.id]);
  });
});

describe('render stage: the worker\'s own browser reads a JavaScript site', { skip }, () => {
  let web: { port: number; close: () => Promise<void> };
  let pdb: PrismaClient;
  let hasBrowser = false;
  const made: { places: string[]; runs: string[]; domains: string[] } = { places: [], runs: [], domains: [] };
  before(async () => {
    process.env.IMPORT_TEST_ALLOW_PRIVATE = '1';
    const { startSites } = await import('../../scripts/import/sim/fixtures');
    web = await startSites([{ host: 'js.test', kind: 'scripted', email: 'hello@js.test', phone: '03-5550505' }]);
    pdb = (await import('../../scripts/import/ctx')).db;
    hasBrowser = (await import('../../scripts/import/crawlee/browser')).browserAvailable();
  });
  after(async () => {
    await pdb.importPlace.deleteMany({ where: { id: { in: made.places } } });
    await pdb.importRun.deleteMany({ where: { id: { in: made.runs } } });
    await pdb.siteFetch.deleteMany({ where: { domain: { in: made.domains } } });
    await web.close();
  });

  it('the HTTP crawler sees an empty shell; the browser sees the business', async t => {
    if (!hasBrowser) return t.skip('no Chromium on this machine');
    const { crawlSite } = await import('../../scripts/import/crawl');
    const { renderPages } = await import('../../scripts/import/crawlee/browser');
    const u = `http://js.test:${web.port}/`;
    const plain = await crawlSite(u, { maxPages: 4, browserAllowed: () => false, sitemap: false });
    assert.ok(!plain.facts.some(f => f.emails.length), 'no email without JavaScript');
    const pages = await renderPages([u], { followLinks: true, maxPages: 3 });
    assert.ok(pages.length >= 2 && pages.length <= 3, `home and its contact page: ${pages.map(p => p.finalUrl).join(', ')}`);
    assert.ok(pages.some(p => /hello@js\.test/.test(p.html)), 'the rendered contact page shows the email');
    assert.ok(pages.every(p => p.status === 200));
  });

  it('a render task fills the domain cache and sends the record through the website stage again', async t => {
    if (!hasBrowser) return t.skip('no Chromium on this machine');
    const { seedRenderTasks, renderStage } = await import('../../scripts/import/stages/render');
    const { requeueAfterSources } = await import('../../scripts/import/stages/sources');
    const { enrich } = await import('../../scripts/import/stages/enrich');
    const u = `http://js.test:${web.port}/`;
    made.domains.push('js.test');
    await pdb.siteFetch.deleteMany({ where: { domain: 'js.test' } });
    const run = await pdb.importRun.create({ data: { label: 'render test', provider: 'dataforseo', scope: {}, maxRequests: 0, budgetMicros: 1_000_000n, status: 'running', lockedBy: ctx.WORKER, lockedUntil: new Date(Date.now() + 600_000) } });
    made.runs.push(run.id);
    const p = await pdb.importPlace.create({
      data: {
        runId: run.id, placeId: `js-${run.id}`, provider: 'dataforseo', name: 'עסק לדוגמה', address: 'רחוב 1, תל אביב', lat: 32.08, lng: 34.78, status: 'enriched',
        regionSlug: 'dan', cityName: 'תל אביב', citySlug: 'tel-aviv', website: u, websiteKind: 'own', siteDomain: 'js.test', categories: ['nails'], crawl: { site: 'failed' },
      },
    });
    made.places.push(p.id);
    assert.equal(await seedRenderTasks(run, new Map([[p.id, new Set(['render'])]]), [p]), 1);
    while (await renderStage(run));
    const task = await pdb.importTask.findFirstOrThrow({ where: { runId: run.id, kind: 'render' } });
    assert.equal(task.status, 'done');
    assert.equal(task.found, 1);
    const cache = await pdb.siteFetch.findUniqueOrThrow({ where: { domain: 'js.test' } });
    assert.equal(cache.status, 'ok');
    const summary = cache.result as { emails?: Array<{ value: string }>; via?: string };
    assert.ok(summary.emails?.some(e => e.value === 'hello@js.test'), 'the cached summary carries the email the browser saw');
    assert.equal(summary.via, 'browser');
    const after = await pdb.importPlace.findUniqueOrThrow({ where: { id: p.id } });
    assert.equal((after.crawl as { render?: { status?: string } }).render?.status, 'ok');
    // Back through the website stage, which reads the cache like any crawl.
    assert.equal(await requeueAfterSources(run), 1);
    while (await enrich(run));
    const filled = await pdb.importPlace.findUniqueOrThrow({ where: { id: p.id } });
    assert.equal(filled.email, 'hello@js.test');
    assert.equal(filled.phone, '+97235550505');
    const stats = (await pdb.importRun.findUniqueOrThrow({ where: { id: run.id } })).stats as { counters?: Record<string, number> };
    assert.ok((stats.counters?.browserPages ?? 0) >= 2);
  });
});

describe('writing stage: a leftover reservation never loops', { skip }, () => {
  let pdb: PrismaClient;
  let mockBefore: string | undefined;
  const made: { places: string[]; runs: string[] } = { places: [], runs: [] };
  before(async () => {
    mockBefore = process.env.IMPORT_EDITORIAL_MOCK;
    process.env.IMPORT_EDITORIAL_MOCK = '1'; // the template writer stands in: no key, no call
    pdb = (await import('../../scripts/import/ctx')).db;
  });
  after(async () => {
    if (mockBefore === undefined) delete process.env.IMPORT_EDITORIAL_MOCK;
    else process.env.IMPORT_EDITORIAL_MOCK = mockBefore;
    await pdb.spendEntry.deleteMany({ where: { runId: { in: made.runs } } });
    await pdb.providerBudget.deleteMany({ where: { key: { in: made.runs.map(id => `editorial:run:${id}`) } } });
    await pdb.importPlace.deleteMany({ where: { id: { in: made.places } } });
    await pdb.importRun.deleteMany({ where: { id: { in: made.runs } } });
  });

  it('a reservation left by a worker stopped mid-call is released, the draft is written and the stage ends', async () => {
    const { editorialStage } = await import('../../scripts/import/stages/editorial');
    const { buildPacket, packetHash, PROMPT_VERSION } = await import('../../src/lib/import/editorial');
    const run = await pdb.importRun.create({ data: { label: 'stale reservation', provider: 'dataforseo', scope: {}, maxRequests: 0, budgetMicros: 1_000_000n, status: 'running', lockedBy: ctx.WORKER, lockedUntil: new Date(Date.now() + 600_000) } });
    made.runs.push(run.id);
    const p = await pdb.importPlace.create({
      data: {
        runId: run.id, placeId: `stale-${run.id}`, provider: 'dataforseo', name: 'סלון תקוע', address: 'רחוב 1, תל אביב', lat: 32.08, lng: 34.78, status: 'extracted',
        regionSlug: 'dan', cityName: 'תל אביב', citySlug: 'tel-aviv', phone: '+97235550009', categories: ['nails'], description: 'סלון ציפורניים שכונתי עם צוות ותיק.',
        treatments: [{ name: 'מניקור', priceNis: 120, priceType: 'fixed', category: 'nails', isMedical: false, durationMin: null }],
      },
    });
    made.places.push(p.id);
    // What a worker killed between "reserve" and "commit" leaves behind: the key is taken, no draft exists.
    const key = `editorial:${p.id}:${packetHash(buildPacket(p, {}))}:${PROMPT_VERSION}`;
    await pdb.spendEntry.create({ data: { runId: run.id, provider: 'openai', endpoint: 'editorial', requestKey: key, estimatedMicros: 5_000n, status: 'reserved', meta: { caps: [] } } });
    assert.equal(await editorialStage(run), true);
    assert.equal(await editorialStage(run), false, 'nothing left: the stage ends instead of selecting the record again');
    const after = await pdb.importPlace.findUniqueOrThrow({ where: { id: p.id } });
    const ed = after.editorial as { promptVersion?: string; words?: number; skipped?: string };
    assert.equal(ed.promptVersion, PROMPT_VERSION);
    assert.ok((ed.words ?? 0) > 0 && !ed.skipped, 'a draft was written');
    const entry = await pdb.spendEntry.findUniqueOrThrow({ where: { requestKey: key } });
    assert.notEqual(entry.status, 'reserved', 'the leftover reservation was settled');
    const fresh = await pdb.importRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(fresh.reservedMicros, 0n, 'nothing stays reserved on the run');
  });
});
