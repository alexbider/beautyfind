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
    assert.ok(after.treatments.find(t => t.name === 'מניקור')!.priceAgorot > 0); // missing price filled
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
});
