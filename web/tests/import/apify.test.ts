// Apify as an enrichment source: pure mapping and planning tests, then a database test that runs one
// actor task end to end against the mock Apify server (budget hold, start, poll, dataset, fill) and the
// batch deletion rules. Nothing here reaches the network or spends money.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  apifyErrorKind, attributesFromMaps, facebookFacts, groupRenderPages, hoursFromFacebook, hoursFromMaps, instagramFacts, instagramHandle, mapsFacts, mapsInput, parseClock, profileMatches, renderInput,
} from '../../src/lib/import/apify';
import { estimatePlans, planFor, scopeSteps, stepApplies, STEP_ORDER, stepUsd, type PlanSignals } from '../../src/lib/import/enrichPlan';
import { pricing } from '../../src/lib/import/pricing';
import { DEFAULT_SETTINGS } from '../../src/lib/import/settings';
import { mayPublish, ratingProviderOk } from '../../src/lib/import/sourcePolicy';
import { startMockApify, type MockApify } from '../../scripts/import/sim/fixtures';

describe('Apify Google Maps mapping', () => {
  it('parses clock times and opening hours, keeping missing days unknown', () => {
    assert.equal(parseClock('9 AM'), '09:00');
    assert.equal(parseClock('9:30 PM'), '21:30');
    assert.equal(parseClock('12 AM'), '00:00');
    assert.equal(parseClock('12 PM'), '12:00');
    assert.equal(parseClock('18:30'), '18:30');
    const h = hoursFromMaps([
      { day: 'Sunday', hours: '9 AM to 1 PM, 4 to 8 PM' },
      { day: 'Monday', hours: '9 AM to 6 PM' },
      { day: 'Friday', hours: 'Closed' },
      { day: 'Saturday', hours: 'Open 24 hours' },
    ])!;
    assert.deepEqual(h[0], { open: '09:00', close: '20:00', closed: false }); // split shift collapsed, "4 to 8 PM" borrows PM
    assert.deepEqual(h[1], { open: '09:00', close: '18:00', closed: false });
    assert.equal(h[2].unknown, true); // Tuesday was not listed: unknown, not closed
    assert.deepEqual(h[5], { open: '', close: '', closed: true });
    assert.deepEqual(h[6], { open: '00:00', close: '23:59', closed: false });
    assert.equal(hoursFromMaps([]), null);
    assert.equal(hoursFromMaps([{ day: 'Monday', hours: 'unknown text' }]), null);
  });

  it('reads tri-state attributes and never turns absence into false', () => {
    const a = attributesFromMaps({ Accessibility: [{ 'Wheelchair accessible entrance': true }, { 'Wheelchair accessible parking lot': false }], Parking: [{ 'Free parking lot': true }], Planning: [{ 'Appointment required': true }] });
    assert.deepEqual(a, { accessible: true, freeParking: true, appointmentRequired: true });
    assert.deepEqual(attributesFromMaps({ Amenities: [{ 'Restroom': true }] }), { accessible: null, freeParking: null, appointmentRequired: null });
    assert.deepEqual(attributesFromMaps(null), { accessible: null, freeParking: null, appointmentRequired: null });
  });

  it('maps a place item to facts with an Israeli phone, photos, rating and closure', () => {
    const f = mapsFacts({
      placeId: 'ChIJx', cid: '123', title: 'קליניקה', url: 'https://maps.google.com/?cid=123', phone: '03-555-1234', website: 'https://noa-clinic.co.il/', totalScore: 4.7, reviewsCount: 88,
      description: 'קליניקה לאסתטיקה רפואית בתל אביב עם רופאה מומחית ועשר שנות ותק.', imageUrls: ['https://lh5.googleusercontent.com/p/a=w408-h306-k-no', 'https://lh5.googleusercontent.com/p/b=w408-h306-k-no', 'ftp://x'],
      openingHours: [{ day: 'Sunday', hours: '9 AM to 6 PM' }], additionalInfo: { Accessibility: [{ 'Wheelchair accessible entrance': true }] }, temporarilyClosed: true, claimThisBusiness: false, bookingLinks: ['https://www.tor4you.co.il/x'],
    }, { maxPhotos: 5 });
    assert.equal(f.phone, '+97235551234');
    assert.equal(f.website, 'https://noa-clinic.co.il/');
    assert.deepEqual(f.rating, { value: 4.7, count: 88 });
    assert.equal(f.photos.length, 2);
    assert.equal(f.accessible, true);
    assert.equal(f.closed, 'temporarily');
    assert.equal(f.claimedOnProvider, true);
    assert.equal(f.hours?.[0].open, '09:00');
    assert.equal(f.bookingLinks.length, 1);
    assert.equal(mapsFacts({ title: 'x', description: 'short' }, { maxPhotos: 5 }).description, null);
  });

  it('builds actor inputs by place id or cid, without reviews', () => {
    const inp = mapsInput([{ id: 'a', placeId: 'ChIJa', cid: null }, { id: 'b', placeId: null, cid: '77' }], { maxImages: 6 }) as { placeIds: string[]; startUrls: Array<{ url: string }>; maxReviews: number };
    assert.deepEqual(inp.placeIds, ['ChIJa']);
    assert.deepEqual(inp.startUrls, [{ url: 'https://maps.google.com/?cid=77' }]);
    assert.equal(inp.maxReviews, 0);
    const r = renderInput(['https://a.test/'], { maxPages: 8 }) as { respectRobotsTxtFile: boolean; maxCrawlPages: number };
    assert.equal(r.respectRobotsTxtFile, true);
    assert.equal(r.maxCrawlPages, 8);
  });
});

describe('Apify social profiles', () => {
  it('reads an Instagram profile and confirms it only through its own link or phone', () => {
    const f = instagramFacts({
      username: 'Noa_Clinic', fullName: 'Noa Clinic', biography: 'אסתטיקה רפואית בת״א. לתיאום: 052-123-4567', externalUrl: 'https://www.noa-clinic.co.il/?utm=ig', followersCount: 1200, profilePicUrlHD: 'https://ig.test/p.jpg',
      latestPosts: [{ type: 'Image', displayUrl: 'https://ig.test/1.jpg', url: 'https://www.instagram.com/p/1/', caption: 'טיפול פנים' }, { type: 'Video', displayUrl: 'https://ig.test/v.jpg' }, { type: 'Sidecar', images: ['https://ig.test/2.jpg'], url: 'https://www.instagram.com/p/2/' }],
    }, { maxPosts: 6 });
    assert.equal(f.handle, 'noa_clinic');
    assert.equal(f.phone, '+972521234567');
    assert.equal(f.photos.length, 2); // the video is skipped
    assert.equal(profileMatches(f, { domain: 'noa-clinic.co.il', phone: null }), 'links_site');
    assert.equal(profileMatches(f, { domain: 'other.co.il', phone: '+972521234567' }), 'shows_phone');
    assert.equal(profileMatches(f, { domain: 'other.co.il', phone: '+97230000000' }), null); // same name is not evidence
    assert.equal(instagramFacts({ username: 'x', error: 'not found' }, { maxPosts: 3 }).unavailable, true);
    assert.equal(instagramHandle('https://instagram.com/Noa_Clinic/?hl=he'), 'noa_clinic');
    assert.equal(instagramHandle('https://instagram.com/p/abc'), null);
  });

  it('reads a Facebook page with hours in either shape', () => {
    const f = facebookFacts({ pageUrl: 'https://www.facebook.com/noaclinic/', title: 'Noa Clinic', intro: 'קליניקה לאסתטיקה רפואית', email: 'Hello@Noa-Clinic.co.il', phone: '03-555-1234', website: 'https://noa-clinic.co.il', coverPhotoUrl: 'https://fb.test/cover.jpg', workHours: { Monday: '09:00 - 18:00', Friday: 'Closed' } });
    assert.equal(f.email, 'hello@noa-clinic.co.il');
    assert.equal(f.phone, '+97235551234');
    assert.equal(f.photos.length, 1);
    assert.deepEqual(f.hours?.[1], { open: '09:00', close: '18:00', closed: false });
    assert.deepEqual(f.hours?.[5], { open: '', close: '', closed: true });
    assert.equal(hoursFromFacebook([{ day: 'Sunday', hours: '10 AM to 4 PM' }])?.[0].close, '16:00');
    assert.equal(facebookFacts({ error: 'page not found' }).unavailable, true);
  });

  it('groups rendered pages per site and classifies errors', () => {
    const g = groupRenderPages([{ url: 'https://a.test/', html: '<p>a</p>', crawl: { httpStatusCode: 200 } }, { url: 'https://www.a.test/prices', html: '<p>b</p>' }, { url: 'https://b.test/', html: null }]);
    assert.equal(g.get('a.test')?.length, 2);
    assert.equal(g.has('b.test'), false);
    assert.equal(apifyErrorKind(402, 'platform-usage-limit-exceeded Monthly usage hard limit exceeded'), 'funds');
    assert.equal(apifyErrorKind(401, 'token-not-found'), 'auth');
    assert.equal(apifyErrorKind(503, 'temporarily unavailable'), 'transient');
    assert.equal(apifyErrorKind(400, 'invalid input'), 'other');
  });

  it('publication policy: Apify facts follow the provider rules', () => {
    assert.equal(mayPublish('apify_google_maps', 'hours'), true);
    assert.equal(mayPublish('apify_google_maps', 'rating'), false);
    assert.equal(mayPublish('apify_google_maps', 'rating', { publishProviderRatings: true }), true);
    assert.equal(mayPublish('apify_instagram', 'photo'), false);
    assert.equal(mayPublish('apify_instagram', 'photo', { useProviderImages: true }), true);
    assert.equal(mayPublish('apify_site', 'service'), true);
    assert.equal(ratingProviderOk('apify_google_maps') && ratingProviderOk('dataforseo') && !ratingProviderOk('google'), true);
  });
});

describe('enrichment plan from gaps and sources', () => {
  const opts = { settings: DEFAULT_SETTINGS, apifyConfigured: true };
  const base: PlanSignals = { hasSite: true, siteOutcome: 'ok', siteThin: false, placeId: true, cid: true, instagram: true, facebook: false, hasEditorial: false };

  it('picks only the steps that can fill a missing section and have a source', () => {
    const plan = planFor(['hours', 'hero'], base, opts);
    assert.deepEqual(plan, ['dfs', 'maps', 'instagram', 'site', 'images']);
    assert.deepEqual(planFor(['about', 'faq'], { ...base, instagram: false, cid: false, placeId: false }, opts), ['site', 'editorial']);
    assert.deepEqual(planFor([], base, opts), []);
    assert.ok(!planFor(['about'], base, opts).includes('regenerate')); // never automatic
  });

  it('sends a site to the browser only when our crawler could not read it, never a blocked one', () => {
    assert.equal(stepApplies('render', { ...base, siteOutcome: 'failed' }, opts), true);
    assert.equal(stepApplies('render', { ...base, siteOutcome: 'ok', siteThin: true }, opts), true);
    assert.equal(stepApplies('render', { ...base, siteOutcome: 'blocked' }, opts), false);
    assert.equal(stepApplies('render', { ...base, siteOutcome: 'robots' }, opts), false);
    assert.equal(stepApplies('site', { ...base, siteOutcome: 'failed' }, opts), false);
    assert.equal(stepApplies('site', { ...base, siteOutcome: 'blocked' }, opts), false);
    assert.equal(stepApplies('maps', { ...base, placeId: false, cid: false }, opts), false);
    assert.equal(stepApplies('maps', base, { ...opts, settings: { ...DEFAULT_SETTINGS, apifyEnabled: false } }), false);
    assert.equal(stepApplies('maps', base, { ...opts, settings: { ...DEFAULT_SETTINGS, killSwitch: true } }), false);
    assert.equal(stepApplies('instagram', base, { ...opts, apifyConfigured: false }), false);
  });

  it('respects the allowed set and estimates per step', () => {
    const plan = planFor(['hours', 'hero', 'about'], base, { ...opts, allowed: ['maps', 'editorial'] });
    assert.deepEqual(plan, ['maps', 'editorial']);
    const est = estimatePlans([plan, ['maps'], []], pricing(), { renderPages: 8, editorialEnabled: true });
    assert.equal(est.perStep.maps.listings, 2);
    assert.equal(est.perStep.editorial.listings, 1);
    assert.equal(est.listings, 3);
    assert.ok(Math.abs(est.totalUsd - (2 * stepUsd('maps', pricing(), { renderPages: 8, editorialEnabled: true }) + stepUsd('editorial', pricing(), { renderPages: 8, editorialEnabled: true }))) < 1e-9);
    assert.equal(stepUsd('site', pricing(), { renderPages: 8, editorialEnabled: true }), 0);
    assert.equal(stepUsd('editorial', pricing(), { renderPages: 8, editorialEnabled: false }), 0);
  });

  it('folds legacy scope booleans into steps', () => {
    const a = scopeSteps({ refresh: true, rereadSite: true });
    assert.deepEqual([...a.steps].sort(), ['dfs', 'editorial', 'images', 'site']);
    assert.equal(a.auto, false);
    const b = scopeSteps({ steps: ['maps', 'instagram'], auto: true });
    assert.deepEqual([...b.steps], ['maps', 'instagram']);
    assert.equal(b.auto, true);
    assert.equal(STEP_ORDER.length, 9);
  });
});

// ---------- database: one actor task end to end, and batch deletion ----------

const URL_OK = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const skip = URL_OK ? false : 'needs a local DATABASE_URL';

describe('Apify task flow and batch deletion', { skip }, () => {
  let db: PrismaClient;
  let apify: MockApify;
  let ctx: typeof import('../../scripts/import/ctx');
  let stage: typeof import('../../scripts/import/stages/apify');
  const made: { businesses: string[]; places: string[]; runs: string[] } = { businesses: [], places: [], runs: [] };
  const MAPS = 'compass~crawler-google-places';

  before(async () => {
    apify = await startMockApify({
      [MAPS]: [{
        placeId: 'ChIJtest-apify-1', cid: '5551', title: 'סלון אפיפיי', phone: '03-555-7777', website: 'https://apify-salon.test/', totalScore: 4.4, reviewsCount: 12,
        openingHours: [{ day: 'Sunday', hours: '9 AM to 6 PM' }, { day: 'Monday', hours: '9 AM to 6 PM' }], additionalInfo: { Accessibility: [{ 'Wheelchair accessible entrance': true }], Parking: [{ 'Free street parking': true }] },
        imageUrls: ['https://lh5.googleusercontent.com/p/x1=w408-h306-k-no', 'https://lh5.googleusercontent.com/p/x2=w408-h306-k-no'], description: 'סלון יופי בחיפה עם צוות של ארבע מעצבות ושירותי ציפורניים, גבות וריסים מאז 2015.',
      }],
    }, { usdPerItem: 0.004 });
    process.env.APIFY_API_BASE = apify.url;
    process.env.APIFY_TOKEN = 'test-token';
    ctx = await import('../../scripts/import/ctx');
    stage = await import('../../scripts/import/stages/apify');
    db = ctx.db;
    await db.importSettings.deleteMany({ where: { id: 1 } });
  });
  after(async () => {
    await db.spendEntry.deleteMany({ where: { runId: { in: made.runs } } });
    await db.providerBudget.deleteMany({ where: { key: { in: made.runs.map(id => `apify:run:${id}`) } } });
    await db.fieldObservation.deleteMany({ where: { importPlaceId: { in: made.places } } });
    await db.importPlace.deleteMany({ where: { id: { in: made.places } } });
    await db.business.deleteMany({ where: { id: { in: made.businesses } } });
    await db.importTask.deleteMany({ where: { runId: { in: made.runs } } });
    await db.importRun.deleteMany({ where: { id: { in: made.runs } } });
    await db.$disconnect();
    await apify.close();
  });

  async function enhanceRun(budgetMicros = 1_000_000n) {
    const run = await db.importRun.create({ data: { label: 'apify test', provider: 'enhance', scope: { branchIds: [], steps: ['maps'], auto: true }, maxRequests: 0, budgetMicros, status: 'running', lockedBy: ctx.WORKER, lockedUntil: new Date(Date.now() + 600_000) } });
    made.runs.push(run.id);
    return run;
  }

  async function place(discoveryRunId: string, placeId: string) {
    const biz = await db.business.create({ data: { status: 'live', type: 'salon' } });
    made.businesses.push(biz.id);
    const b = await db.branch.create({ data: { businessId: biz.id, name: 'סלון אפיפיי', slug: `apify-${biz.id.slice(0, 8)}`, regionSlug: 'north', cityName: 'חיפה', address: 'רחוב 2', lat: 32.79, lng: 34.99, status: 'live', isClaimed: false } });
    const p = await db.importPlace.create({
      data: { runId: discoveryRunId, placeId, provider: 'dataforseo', sourceId: '5551', name: 'סלון אפיפיי', address: 'רחוב 2', lat: 32.79, lng: 34.99, status: 'approved', branchId: b.id, phone: '+97235557777', categories: ['nails'], hours: undefined },
    });
    made.places.push(p.id);
    return { b, p };
  }

  it('reserves, starts the actor, reads the dataset, fills the record and settles the reported cost', async () => {
    const disc = await db.importRun.create({ data: { label: 'disc', provider: 'dataforseo', scope: {}, maxRequests: 0, status: 'done' } });
    made.runs.push(disc.id);
    const { p } = await place(disc.id, 'ChIJtest-apify-1');
    const run = await enhanceRun();
    const plans = new Map([[p.id, new Set(['maps'])]]);
    const seeded = await stage.seedApifyTasks(run, plans, [p]);
    assert.equal(seeded.maps, 1);
    assert.equal(await stage.apifyStage(run, 'maps'), true);
    assert.equal(await stage.apifyStage(run, 'maps'), false); // nothing left
    assert.equal(apify.starts.length, 1);
    assert.deepEqual((apify.starts[0].input as { placeIds: string[] }).placeIds, ['ChIJtest-apify-1']);
    assert.equal((apify.starts[0].input as { maxReviews: number }).maxReviews, 0);

    const after = await db.importPlace.findUniqueOrThrow({ where: { id: p.id } });
    assert.equal(after.phone, '+97235557777'); // the provider's phone stays
    assert.equal(after.website, 'https://apify-salon.test/');
    assert.equal((after.hours as Array<{ open: string }>)[0].open, '09:00');
    assert.equal(after.accessible, true);
    assert.equal(after.freeParking, true);
    assert.equal(after.googleRating, 4.4);
    assert.equal(after.ratingProvider, 'apify_google_maps');
    assert.equal(after.photoUrls.length, 2);
    assert.ok(after.description?.includes('חיפה'));
    const crawl = after.crawl as { apify: { maps: { found: boolean; photos: number } }; mediaCandidates: Array<{ provider: string }> };
    assert.equal(crawl.apify.maps.found, true);
    assert.equal(crawl.mediaCandidates.filter(c => c.provider === 'google_profile').length, 2);
    assert.ok(((after.costs as { apifyUsd?: number }).apifyUsd ?? 0) > 0);
    const obs = await db.fieldObservation.findMany({ where: { importPlaceId: p.id, provider: 'apify_google_maps' } });
    // Under the default settings the provider rating is publishable; photos are (useProviderImages on); the description is evidence only.
    assert.ok(obs.some(o => o.field === 'hours') && obs.some(o => o.field === 'rating' && o.publishable) && obs.some(o => o.field === 'description' && !o.publishable));

    const task = await db.importTask.findFirstOrThrow({ where: { runId: run.id, kind: 'apify_maps' } });
    assert.equal(task.status, 'done');
    assert.equal(task.found, 1);
    const spend = await db.spendEntry.findFirstOrThrow({ where: { runId: run.id, provider: 'apify' } });
    assert.equal(spend.status, 'committed');
    assert.equal(spend.actualMicros, 4000n); // usageTotalUsd from the run, not the estimate
    const r = await db.importRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(r.spentMicros, 4000n);
    assert.equal(r.reservedMicros, 0n);
  });

  it('a task over the run budget is skipped without starting an actor; a funds error stops the run', async () => {
    const disc = made.runs[0];
    const { p } = await place(disc, 'ChIJtest-apify-2');
    const run = await enhanceRun(1000n); // less than the gross hold
    await stage.seedApifyTasks(run, new Map([[p.id, new Set(['maps'])]]), [p]);
    const startsBefore = apify.starts.length;
    await stage.apifyStage(run, 'maps');
    assert.equal(apify.starts.length, startsBefore);
    const task = await db.importTask.findFirstOrThrow({ where: { runId: run.id, kind: 'apify_maps' } });
    assert.equal(task.status, 'done');
    assert.equal(task.error, 'budget');

    const run2 = await enhanceRun();
    await stage.seedApifyTasks(run2, new Map([[p.id, new Set(['maps'])]]), [p]);
    apify.setMode('funds');
    await assert.rejects(() => stage.apifyStage(run2, 'maps'), /usage/i);
    apify.setMode('ok');
    const t2 = await db.importTask.findFirstOrThrow({ where: { runId: run2.id, kind: 'apify_maps' } });
    assert.equal(t2.status, 'failed');
    const sp = await db.spendEntry.findFirst({ where: { runId: run2.id, provider: 'apify' } });
    assert.equal(sp?.status, 'released'); // nothing was billed
  });

  it('a stopped worker resumes the same actor run instead of paying twice', async () => {
    const disc = made.runs[0];
    const { p } = await place(disc, 'dfs:cid:5551'); // no place id: the actor is asked by cid and the item is matched by cid
    const run = await enhanceRun();
    await stage.seedApifyTasks(run, new Map([[p.id, new Set(['maps'])]]), [p]);
    const task = await db.importTask.findFirstOrThrow({ where: { runId: run.id, kind: 'apify_maps' } });
    // Pretend the previous worker started the actor and died before collecting.
    const before = apify.starts.length;
    const { reserve, withCaps } = await import('../../src/lib/import/budget');
    await reserve(db, withCaps({ runId: run.id, provider: 'apify', endpoint: MAPS, requestKey: `apify:${task.id}`, estimateMicros: 8000n }));
    const startRes = await fetch(`${apify.url}/v2/acts/${MAPS}/runs`, { method: 'POST', headers: { Authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: '{}' });
    const started = (await startRes.json()) as { data: { id: string; defaultDatasetId: string } };
    await db.importTask.update({ where: { id: task.id }, data: { status: 'dispatched', params: { ...(task.params as object), requestKey: `apify:${task.id}`, apifyRunId: started.data.id, datasetId: started.data.defaultDatasetId, startedAt: Date.now() } } });
    await stage.apifyStage(run, 'maps');
    assert.equal(apify.starts.length, before + 1); // only our manual start; the stage did not start another
    const t = await db.importTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(t.status, 'done');
    assert.equal(t.found, 1);
  });

  it('deletes finished batches but not running ones or discovery runs that own records', async () => {
    const { deleteRun } = await import('../../src/lib/server/importOps');
    const actor = (await db.user.findFirst({ select: { id: true } })) ?? (await db.user.create({ data: {}, select: { id: true } }));
    const done = await db.importRun.create({ data: { label: 'done batch', provider: 'enhance', scope: { steps: ['site'] }, maxRequests: 0, status: 'done' } });
    await db.importTask.create({ data: { runId: done.id, key: 'enhance:0', kind: 'enhance', params: { ids: [] }, status: 'done' } });
    const r1 = await deleteRun(actor, done.id);
    assert.deepEqual(r1, { ok: true });
    assert.equal(await db.importRun.findUnique({ where: { id: done.id } }), null);
    assert.equal(await db.importTask.count({ where: { runId: done.id } }), 0);
    const audit = await db.auditLog.findFirst({ where: { action: 'import_run_delete', subjectId: done.id } });
    assert.ok(audit);

    const running = await enhanceRun();
    const r2 = await deleteRun(actor, running.id);
    assert.deepEqual(r2, { ok: false, error: 'running' });

    const r3 = await deleteRun(actor, made.runs[0]); // the discovery run with staged records
    assert.deepEqual(r3, { ok: false, error: 'has_records' });
    assert.deepEqual(await deleteRun(actor, '00000000-0000-4000-8000-000000000000'), { ok: false, error: 'not_found' });
  });
});

describe('seeding an automatic enhance run', { skip }, () => {
  let db: PrismaClient;
  const made: { businesses: string[]; places: string[]; runs: string[] } = { businesses: [], places: [], runs: [] };
  before(async () => {
    process.env.APIFY_TOKEN = 'test-token';
    db = (await import('../../scripts/import/ctx')).db;
  });
  after(async () => {
    await db.importTask.deleteMany({ where: { runId: { in: made.runs } } });
    await db.importPlace.deleteMany({ where: { id: { in: made.places } } });
    await db.business.deleteMany({ where: { id: { in: made.businesses } } });
    await db.importRun.deleteMany({ where: { id: { in: made.runs } } });
  });

  it('plans per listing from its gaps and writes the steps on the tasks', async () => {
    const disc = await db.importRun.create({ data: { label: 'disc', provider: 'dataforseo', scope: {}, maxRequests: 0, status: 'done' } });
    made.runs.push(disc.id);
    const biz = await db.business.create({ data: { status: 'live', type: 'salon' } });
    made.businesses.push(biz.id);
    // A listing with no hours, no photos and a same-name Instagram account from the provider: the plan should name Instagram and Maps, not the site (there is none).
    const b = await db.branch.create({ data: { businessId: biz.id, name: 'סלון תוכנית', slug: `plan-${biz.id.slice(0, 8)}`, regionSlug: 'dan', cityName: 'תל אביב', address: 'רחוב 3', lat: 32.08, lng: 34.78, status: 'live', isClaimed: false, phone: '+97235551111' } });
    const p = await db.importPlace.create({
      data: { runId: disc.id, placeId: 'ChIJplan-1', provider: 'dataforseo', sourceId: '777', name: 'סלון תוכנית', address: 'רחוב 3', lat: 32.08, lng: 34.78, status: 'approved', branchId: b.id, phone: '+97235551111', categories: ['nails'], socials: { instagram: { url: 'https://www.instagram.com/salon_plan', verified: false, via: 'unverified', sources: ['dataforseo'] } } },
    });
    made.places.push(p.id);
    const { seedEnhance } = await import('../../scripts/import/stages/enhance');
    const { WORKER } = await import('../../scripts/import/ctx');
    const run = await db.importRun.create({ data: { label: 'auto batch', provider: 'enhance', scope: { branchIds: [b.id], steps: ['dfs', 'maps', 'instagram', 'facebook', 'site', 'render', 'editorial', 'images'], auto: true }, maxRequests: 0, budgetMicros: 1_000_000n, status: 'running', lockedBy: WORKER, lockedUntil: new Date(Date.now() + 600_000) } });
    made.runs.push(run.id);
    await seedEnhance(run);
    const tasks = await db.importTask.findMany({ where: { runId: run.id } });
    const kinds = tasks.map(t => t.kind).sort();
    assert.deepEqual(kinds, ['apify_instagram', 'apify_maps', 'dfs_refresh', 'enhance']);
    const enhance = tasks.find(t => t.kind === 'enhance')!;
    const steps = (enhance.params as { steps: Record<string, string[]> }).steps[p.id];
    assert.ok(steps.includes('maps') && steps.includes('instagram') && steps.includes('dfs') && steps.includes('images'));
    assert.ok(!steps.includes('site') && !steps.includes('render') && !steps.includes('facebook'));
    const ig = tasks.find(t => t.kind === 'apify_instagram')!;
    assert.deepEqual((ig.params as { targets: Array<{ handle: string }> }).targets.map(t => t.handle), ['salon_plan']);
    const stats = (await db.importRun.findUniqueOrThrow({ where: { id: run.id } })).stats as { plan: Record<string, number>; auto: boolean; apifyConfigured: boolean };
    assert.equal(stats.auto, true);
    assert.equal(stats.plan.instagram, 1);
    assert.equal(stats.plan.site, 0);
  });
});
