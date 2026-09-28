// ChatGPT (OpenAI) as research source and writer: pure tests on how a cited answer becomes facts, then
// a database test that runs the research stage end to end against the mock Responses API (budget hold,
// call, fill, settle; a second pass is free; budget refusal; a funds error stops the run), the writer
// through the same mock, and the profiles report over the records it produced. Nothing reaches the
// network or spends money.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { buildPacket } from '../../src/lib/import/editorial';
import { planFor, type PlanSignals } from '../../src/lib/import/enrichPlan';
import { openaiCostUsd, openaiErrorKind, researchFacts, researchMessage, researchTargets } from '../../src/lib/import/openai';
import { DEFAULT_PRICING } from '../../src/lib/import/pricing';
import { DEFAULT_SETTINGS } from '../../src/lib/import/settings';
import { mayPublish } from '../../src/lib/import/sourcePolicy';
import { startMockOpenAI, type MockOpenAI } from '../../scripts/import/sim/fixtures';

const PAGE = 'https://www.noa-clinic.co.il/contact';

describe('ChatGPT research answers', () => {
  it('keeps only facts that name the page they came from, and normalizes them', () => {
    const f = researchFacts({
      website: { value: 'noa-clinic.co.il', sourceUrl: PAGE },
      phone: { value: '03-555-1234', sourceUrl: PAGE },
      email: { value: 'Hello@Noa-Clinic.co.il ', sourceUrl: PAGE },
      whatsapp: { value: '052 123 4567', sourceUrl: '' }, // no page: dropped
      instagram: { value: 'https://www.instagram.com/noa_clinic/', sourceUrl: 'https://www.instagram.com/noa_clinic/' },
      facebook: { value: 'https://www.instagram.com/other/', sourceUrl: PAGE }, // wrong network: ignored
      booking: { value: 'https://www.tor4you.co.il/noa', sourceUrl: PAGE },
      hours: { sourceUrl: PAGE, days: [{ day: 0, open: '9:00', close: '18:00', closed: false }, { day: 5, open: '', close: '', closed: true }, { day: 9, open: '1', close: '2', closed: false }] },
      services: [{ name: 'טיפול פנים', priceNis: 250, priceType: 'fixed', durationMin: 60, sourceUrl: PAGE, quote: 'טיפול פנים 250' }, { name: 'ללא מקור', priceNis: 100, priceType: 'fixed', durationMin: null, sourceUrl: 'not a url', quote: '' }, { name: 'לפי הצעה', priceNis: null, priceType: 'on_request', durationMin: null, sourceUrl: PAGE, quote: '' }],
      team: [{ name: 'נועה', role: 'קוסמטיקאית', sourceUrl: PAGE }, { name: '', role: 'x', sourceUrl: PAGE }],
      languages: { value: ['עברית', 'רוסית'], sourceUrl: PAGE },
      establishedYear: { value: 1800, sourceUrl: PAGE },
      accessible: { value: true, sourceUrl: PAGE },
      summary: [{ text: 'קליניקה לאסתטיקה רפואית בתל אביב.', sourceUrl: PAGE }, { text: 'בלי מקור', sourceUrl: 'javascript:alert(1)' }],
      notFound: ['free parking'],
    });
    assert.equal(f.website?.value, 'https://noa-clinic.co.il/');
    assert.equal(f.websiteKind, 'own');
    assert.equal(f.phone?.value, '+97235551234');
    assert.equal(f.email?.value, 'hello@noa-clinic.co.il');
    assert.equal(f.whatsapp, null);
    assert.deepEqual(f.socials.map(s => s.network), ['instagram']);
    assert.equal(f.booking?.value.includes('tor4you'), true);
    assert.deepEqual(f.hours?.value[0], { open: '09:00', close: '18:00', closed: false });
    assert.deepEqual(f.hours?.value[5], { open: '', close: '', closed: true });
    assert.equal(f.hours?.value[1].unknown, true);
    assert.equal(f.services.length, 2);
    assert.equal(f.services[1].priceType, 'on_request');
    assert.equal(f.team.length, 1);
    assert.deepEqual(f.languages?.value, ['עברית', 'רוסית']);
    assert.equal(f.establishedYear, null); // outside the plausible range
    assert.equal(f.accessible?.value, true);
    assert.equal(f.notes.length, 1);
    assert.deepEqual(f.notFound, ['free parking']);
    assert.equal(f.dropped, 4); // whatsapp, one service, one team member, one note
    assert.ok(f.sources.includes(PAGE));
  });

  it('asks for what the missing template sections need, and phrases the request from the record', () => {
    const t = researchTargets(['contact', 'hours', 'services', 'team']);
    assert.ok(t.includes('phone') && t.includes('opening hours') && t.includes('services and prices') && t.includes('team members with roles'));
    assert.deepEqual(researchTargets([]), []);
    const msg = researchMessage({ name: 'נועה קליניק', address: 'דיזנגוף 1', cityName: 'תל אביב', phone: '+97235551234', website: null, categories: ['אסתטיקה רפואית'], known: ['phone'], missing: ['opening hours'] });
    assert.ok(msg.includes('Business: נועה קליניק') && msg.includes('Website on record: none') && msg.includes('Look for: opening hours.'));
  });

  it('classifies errors and prices a call from the usage reported', () => {
    assert.equal(openaiErrorKind(429, 'insufficient_quota', 'You exceeded your current quota'), 'funds');
    assert.equal(openaiErrorKind(401, 'invalid_api_key', 'Incorrect API key provided'), 'auth');
    assert.equal(openaiErrorKind(429, 'rate_limit_exceeded', 'Rate limit reached'), 'transient');
    assert.equal(openaiErrorKind(503, null, 'overloaded'), 'transient');
    assert.equal(openaiErrorKind(400, 'invalid_request_error', 'bad schema'), 'other');
    const p = DEFAULT_PRICING.openai;
    const usd = openaiCostUsd({ inputTokens: 1_000_000, outputTokens: 0, searchCalls: 1 }, p);
    assert.ok(Math.abs(usd - (p.inputPer1MUsd + p.webSearchPer1kUsd / 1000)) < 1e-9);
  });

  it('plans research only with a key and a gap it can fill, and not again within a month', () => {
    const base: PlanSignals = { hasSite: false, siteOutcome: null, siteThin: false, placeId: false, cid: false, instagram: false, facebook: false, hasEditorial: false, researchedAt: null };
    const opts = { settings: DEFAULT_SETTINGS, apifyConfigured: false, openaiConfigured: true };
    assert.ok(planFor(['hours'], base, opts).includes('research'));
    assert.ok(!planFor(['hours'], base, { ...opts, openaiConfigured: false }).includes('research'));
    assert.ok(!planFor(['hours'], base, { ...opts, settings: { ...DEFAULT_SETTINGS, researchEnabled: false } }).includes('research'));
    assert.ok(!planFor(['hours'], { ...base, researchedAt: new Date().toISOString() }, opts).includes('research'));
    assert.ok(planFor(['hours'], { ...base, researchedAt: '2020-01-01T00:00:00Z' }, opts).includes('research'));
    assert.equal(mayPublish('openai_research', 'phone'), true);
    assert.equal(mayPublish('openai_research', 'email'), false); // a person confirms an email found by search
  });
});

// ---------- database: the research stage and the writer against the mock API ----------

const URL_OK = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const skip = URL_OK ? false : 'needs a local DATABASE_URL';

describe('ChatGPT research stage and writer', { skip }, () => {
  let db: PrismaClient;
  let openai: MockOpenAI;
  let ctx: typeof import('../../scripts/import/ctx');
  let stage: typeof import('../../scripts/import/stages/research');
  const made: { places: string[]; runs: string[]; businesses: string[] } = { places: [], runs: [], businesses: [] };
  let mockMode: 'full' | 'empty' = 'full';

  before(async () => {
    openai = await startMockOpenAI(subject => {
      if (mockMode === 'empty') return { website: null, phone: null, email: null, whatsapp: null, instagram: null, facebook: null, tiktok: null, youtube: null, booking: null, hours: null, services: [], team: [], languages: null, establishedYear: null, accessible: null, freeParking: null, summary: [], notFound: ['everything'] };
      const name = subject.match(/Business: (.+)/)?.[1] ?? '';
      return {
        website: { value: 'https://research-salon.test/', sourceUrl: 'https://research-salon.test/' },
        phone: { value: '04-555-9999', sourceUrl: 'https://research-salon.test/contact' },
        email: { value: 'info@research-salon.test', sourceUrl: 'https://research-salon.test/contact' },
        whatsapp: null, instagram: { value: 'https://www.instagram.com/research_salon/', sourceUrl: 'https://research-salon.test/' }, facebook: null, tiktok: null, youtube: null, booking: null,
        hours: { sourceUrl: 'https://research-salon.test/hours', days: [0, 1, 2, 3, 4].map(day => ({ day, open: '10:00', close: '19:00', closed: false })) },
        services: [{ name: 'לק ג׳ל', priceNis: 120, priceType: 'fixed', durationMin: 45, sourceUrl: 'https://research-salon.test/prices', quote: 'לק ג׳ל 120 ₪' }],
        team: [{ name: 'דנה', role: 'מנהלת', sourceUrl: 'https://research-salon.test/about' }], languages: { value: ['עברית'], sourceUrl: 'https://research-salon.test/about' },
        establishedYear: { value: 2018, sourceUrl: 'https://research-salon.test/about' }, accessible: { value: true, sourceUrl: 'https://research-salon.test/about' }, freeParking: null,
        summary: [{ text: `${name}: סלון ציפורניים בחיפה עם שלוש עמדות ומכונת קפה.`, sourceUrl: 'https://research-salon.test/about' }], notFound: [],
      };
    }, { inputTokens: 2000, outputTokens: 800 });
    process.env.OPENAI_API_BASE = openai.url;
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.IMPORT_EDITORIAL_MOCK;
    ctx = await import('../../scripts/import/ctx');
    stage = await import('../../scripts/import/stages/research');
    db = ctx.db;
    await db.importSettings.deleteMany({ where: { id: 1 } });
  });
  after(async () => {
    await db.spendEntry.deleteMany({ where: { runId: { in: made.runs } } });
    await db.providerBudget.deleteMany({ where: { key: { in: made.runs.map(id => `research:run:${id}`) } } });
    await db.fieldObservation.deleteMany({ where: { importPlaceId: { in: made.places } } });
    await db.importPlace.deleteMany({ where: { id: { in: made.places } } });
    await db.business.deleteMany({ where: { id: { in: made.businesses } } });
    await db.importTask.deleteMany({ where: { runId: { in: made.runs } } });
    await db.importRun.deleteMany({ where: { id: { in: made.runs } } });
    await db.$disconnect();
    await openai.close();
  });

  async function run(budgetMicros = 1_000_000n) {
    const r = await db.importRun.create({ data: { label: 'research test', provider: 'dataforseo', scope: {}, maxRequests: 0, budgetMicros, status: 'running', lockedBy: ctx.WORKER, lockedUntil: new Date(Date.now() + 600_000) } });
    made.runs.push(r.id);
    return r;
  }
  async function place(runId: string, name: string, extra: Record<string, unknown> = {}) {
    const p = await db.importPlace.create({ data: { runId, placeId: `research-${made.places.length}-${Date.now()}`, provider: 'dataforseo', sourceId: `r${made.places.length}`, name, address: 'רחוב הנמל 3', cityName: 'חיפה', regionSlug: 'north', lat: 32.8, lng: 34.99, status: 'extracted', categories: ['nails'], ...extra } });
    made.places.push(p.id);
    return p;
  }

  it('fills empty fields from cited facts, keeps observations with their page, and settles the reported cost', async () => {
    const r = await run();
    const p = await place(r.id, 'סלון מחקר');
    assert.equal(await stage.seedResearchTasks(r, [p.id]), 1);
    assert.equal(await stage.researchStage(r), true);
    assert.equal(await stage.researchStage(r), false);
    assert.equal(openai.requests.length, 1);
    const body = openai.requests[0].body as { tools: Array<{ type: string }>; max_tool_calls: number; text: { format: { type: string } } };
    assert.equal(body.tools[0].type, 'web_search');
    assert.equal(body.text.format.type, 'json_schema');
    assert.ok(body.max_tool_calls > 0);

    const a = await db.importPlace.findUniqueOrThrow({ where: { id: p.id } });
    assert.equal(a.phone, '+97245559999');
    assert.equal(a.website, 'https://research-salon.test/');
    // The email's domain has no mail records here, so it stays an observation for a person; when it does resolve, the fill is marked as found by search.
    assert.ok(a.email === null || a.emailSource === 'search');
    assert.equal((a.hours as Array<{ open: string }>)[0].open, '10:00');
    assert.equal((a.treatments as unknown[]).length, 1);
    assert.equal(a.establishedYear, 2018);
    assert.equal(a.accessible, true);
    const crawl = a.crawl as { research: { filled: string[]; sources: string[]; notes: unknown[]; costUsd: number; searchCalls: number } };
    assert.ok(crawl.research.filled.includes('phone') && crawl.research.filled.includes('hours') && crawl.research.filled.includes('website'));
    assert.equal(crawl.research.searchCalls, 1);
    assert.ok(crawl.research.costUsd > 0);
    assert.equal(stage.researchGainedWebsite(a.crawl), true);
    const obs = await db.fieldObservation.findMany({ where: { importPlaceId: p.id, provider: 'openai_research' } });
    assert.ok(obs.length >= 5);
    assert.ok(obs.every(o => o.sourceUrl?.startsWith('https://research-salon.test/')));
    assert.ok(obs.some(o => o.field === 'email' && !o.publishable));
    const spend = await db.spendEntry.findFirstOrThrow({ where: { runId: r.id, provider: 'openai' } });
    assert.equal(spend.status, 'committed');
    const expected = BigInt(Math.round(openaiCostUsd({ inputTokens: 2000, outputTokens: 800, searchCalls: 1 }, DEFAULT_PRICING.openai) * 1_000_000));
    assert.equal(spend.actualMicros, expected);
    const fresh = await db.importRun.findUniqueOrThrow({ where: { id: r.id } });
    assert.equal(fresh.reservedMicros, 0n);
    assert.equal(fresh.spentMicros, expected);

    // A worker that died after the call but before writing the outcome: the same attempt's request key exists, nothing is sent or paid again.
    await db.importPlace.update({ where: { id: p.id }, data: { crawl: { ...(crawl as object), research: undefined } } });
    await db.importTask.create({ data: { runId: r.id, key: 'research:again', kind: 'research', params: { ids: [p.id] } } });
    await stage.researchStage(r);
    assert.equal(openai.requests.length, 1);
    const again = await db.importTask.findFirstOrThrow({ where: { runId: r.id, key: 'research:again' } });
    assert.equal(again.status, 'done');
    // Restore the outcome for the report test below.
    await db.importPlace.update({ where: { id: p.id }, data: { crawl: a.crawl as object } });
  });

  it('a record over the research cap is skipped without a call; a quota error stops the run', async () => {
    const r = await run(1000n);
    const p = await place(r.id, 'סלון תקציב');
    await stage.seedResearchTasks(r, [p.id]);
    const before = openai.requests.length;
    await stage.researchStage(r);
    assert.equal(openai.requests.length, before);
    const fresh = await db.importRun.findUniqueOrThrow({ where: { id: r.id } });
    assert.equal((fresh.stats as { researchBudgetHit?: string }).researchBudgetHit, 'run');

    const r2 = await run();
    await stage.seedResearchTasks(r2, [p.id]);
    openai.setMode('funds');
    await assert.rejects(() => stage.researchStage(r2), /quota/i);
    openai.setMode('ok');
    const t = await db.importTask.findFirstOrThrow({ where: { runId: r2.id, kind: 'research' } });
    assert.equal(t.status, 'failed');
    const sp = await db.spendEntry.findFirst({ where: { runId: r2.id, provider: 'openai' } });
    assert.equal(sp?.status, 'released');
    const p2 = await db.importPlace.findUniqueOrThrow({ where: { id: p.id } });
    assert.equal(p2.phone, null); // nothing was filled
  });

  it('an answer with nothing cited fills nothing and says so on the record', async () => {
    mockMode = 'empty';
    const r = await run();
    const p = await place(r.id, 'סלון ריק');
    await stage.seedResearchTasks(r, [p.id]);
    await stage.researchStage(r);
    mockMode = 'full';
    const a = await db.importPlace.findUniqueOrThrow({ where: { id: p.id } });
    const research = (a.crawl as { research: { filled: string[]; notFound: string[] } }).research;
    assert.deepEqual(research.filled, []);
    assert.deepEqual(research.notFound, ['everything']);
    assert.equal(a.phone, null);
    const t = await db.importTask.findFirstOrThrow({ where: { runId: r.id, kind: 'research' } });
    assert.equal(t.status, 'done');
    assert.equal(t.found, 0);
  });

  it('the writer runs through the same API with a strict schema and prices the draft', async () => {
    const { writeEditorial } = await import('../../scripts/import/editorialCall');
    const packet = buildPacket({
      name: 'סלון מחקר', address: 'רחוב הנמל 3', cityName: 'חיפה', categories: ['nails'], phone: '+97245559999', email: null, website: 'https://research-salon.test/', websiteKind: 'own',
      hours: [0, 1, 2, 3, 4].map(() => ({ open: '10:00', close: '19:00', closed: false })), treatments: [{ name: 'לק ג׳ל', priceAgorot: 12000, priceType: 'fixed', durationMin: 45, evidence: 'לק ג׳ל 120 ₪', sourceUrl: 'https://research-salon.test/prices' }],
      description: 'סלון ציפורניים בחיפה עם שלוש עמדות ומכונת קפה, פתוח גם בערבי חג.', team: [], languages: ['עברית'], establishedYear: 2018, accessible: true, freeParking: null, whatsapp: null, bookingUrl: null, instagram: null, facebook: null,
      businessType: 'salon', faqs: [], tiktok: null, youtube: null,
      googleRating: null, googleReviewCount: null, photoUrls: [], videos: [], crawl: { research: { notes: [{ text: 'סלון ציפורניים בחיפה עם שלוש עמדות ומכונת קפה.', sourceUrl: 'https://research-salon.test/about' }] } },
    });
    assert.ok(packet.researchNotes?.length);
    const before = openai.requests.length;
    const res = await writeEditorial(packet, 'openai');
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.ok(openai.requests.length > before);
    const body = openai.requests[before].body as { text: { format: { strict: boolean; name: string } }; tools?: unknown };
    assert.equal(body.text.format.strict, true);
    assert.equal(body.tools, undefined);
    assert.ok(res.output.description.length > 0);
    assert.ok(res.costUsd > 0);
    assert.equal(res.model, process.env.IMPORT_OPENAI_MODEL || DEFAULT_PRICING.openai.model);
    // Without a key the writer reports it instead of writing a draft.
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const none = await writeEditorial(packet, 'openai');
    process.env.OPENAI_API_KEY = saved;
    assert.deepEqual(none, { ok: false, error: 'no_api_key', fatal: true });
  });

  it('the profiles report lists the records with their sources, gaps and cost, grouped by city and category', async () => {
    const { importReport } = await import('../../src/lib/server/importReport');
    const runId = made.runs[0];
    const rep = await importReport({ runId });
    const row = rep.rows.find(r => r.name === 'סלון מחקר');
    assert.ok(row);
    assert.equal(row.state, 'pending');
    assert.equal(row.sources.research, 'filled');
    assert.ok(row.sources.researchFilled.includes('phone'));
    assert.ok(row.costUsd > 0);
    assert.ok(row.sections.some(s => s.id === 'hours' && s.state === 'populated'));
    assert.ok(row.missing.includes('hero'));
    assert.ok(row.href.startsWith('/ops/import/review?run='));
    assert.ok(row.lastActivity);
    const g = rep.groups.find(g => g.cityName === 'חיפה' && g.category === 'nails');
    assert.ok(g && g.n >= 1);
    assert.ok(g.topGaps.length);
    const filtered = await importReport({ runId, missing: 'hero', q: 'מחקר' });
    assert.equal(filtered.rows.length, 1);
    assert.equal((await importReport({ runId, state: 'published' })).rows.length, 0);
  });
});
