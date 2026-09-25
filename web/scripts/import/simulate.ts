// SIMULATED pilot. Runs the real import stages (discovery, website enrichment, checks) against a local
// mock of DataForSEO and invented fixture websites. No provider is contacted, no money is spent, and the
// numbers describe the fixtures, not Israeli businesses.
//
//   npm run import:simulate                 100-record pilot with a $1 ceiling, then cleans up
//   npm run import:simulate -- --keep       leave the simulated run in the local database to browse
//
// Refuses to run unless DATABASE_URL points at localhost.

process.env.IMPORT_TEST_ALLOW_PRIVATE = '1';
process.env.IMPORT_CRAWL_PAUSE_MS = '0';
process.env.DATAFORSEO_LOGIN = 'simulated';
process.env.DATAFORSEO_PASSWORD = 'simulated';

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeItems, startMockDfs, startSites } from './sim/fixtures';

const LOCAL = /@(localhost|127\.0\.0\.1)(:\d+)?\//;

async function main() {
  if (!LOCAL.test(process.env.DATABASE_URL ?? '')) {
    console.error('Refusing to run: the simulation writes to the database and must use a local DATABASE_URL.');
    process.exit(1);
  }
  const keep = process.argv.includes('--keep');
  const N = 140; // the provider "has" more records than the pilot limit, so the limit is exercised
  const sitesSrv = await startSites([]);
  const { items, sites } = fakeItems(N, sitesSrv.port);
  await sitesSrv.close();
  const web = await startSites(sites);
  const { items: withPort } = fakeItems(N, web.port);
  const dfs = await startMockDfs(withPort, { postImageBase: `http://gimg.test:${web.port}` });
  process.env.DATAFORSEO_BASE_URL = dfs.url;

  const ctx = await import('./ctx');
  const { seedDfs, discoverDfs } = await import('./stages/dfsDiscover');
  const { enrich } = await import('./stages/enrich');
  const { queuePostPhotos, collectPostPhotos } = await import('./stages/googlePosts');
  const { extractStage } = await import('./stages/extractLlm');
  const { check } = await import('./stages/check');
  const { fromMicros } = await import('../../src/lib/import/pricing');
  const { loadSettings } = await import('../../src/lib/import/settings');
  const { db } = ctx;
  const s = await loadSettings(db);

  // Start from a clean slate: earlier simulated records would otherwise be "seen again" and keep old results.
  const old = await db.importRun.findMany({ where: { label: 'SIMULATED pilot' }, select: { id: true } });
  await db.importPlace.deleteMany({ where: { OR: [{ runId: { in: old.map(r => r.id) } }, { placeId: { startsWith: 'ChIJsim' } }, { placeId: { startsWith: 'dfs:cid:9000000' } }] } });
  await db.spendEntry.deleteMany({ where: { runId: { in: old.map(r => r.id) } } });
  await db.importRun.deleteMany({ where: { id: { in: old.map(r => r.id) } } });
  await db.siteFetch.deleteMany({ where: { domain: { endsWith: '.test' } } });

  const scope = { all: false, cities: ['tel-aviv', 'haifa', 'jerusalem'], categories: ['nails', 'facials'], nearby: false, text: false };
  const run = await db.importRun.create({
    data: {
      label: 'SIMULATED pilot', provider: 'dataforseo', scope, recordLimit: s.pilotRecordLimit, budgetMicros: BigInt(Math.round(s.pilotBudgetUsd * 1e6)), maxRequests: 0,
      status: 'running', lockedBy: ctx.WORKER, lockedUntil: new Date(Date.now() + ctx.LEASE_MS), startedAt: new Date(),
    },
  });
  const t0 = Date.now();
  try {
    await seedDfs(run, scope);
    while (await discoverDfs(run));
    while (await enrich(run));
    await queuePostPhotos(run, (await db.importPlace.findMany({ where: { runId: run.id }, select: { id: true } })).map(p => p.id));
    while (await collectPostPhotos(run));
    while (await extractStage(run));
    await check(run);
  } catch (e) {
    console.error('simulation stopped:', e);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const [r, byStatus, reasons, siteOut, spend, emails, conflicts] = await Promise.all([
    db.importRun.findUniqueOrThrow({ where: { id: run.id } }),
    db.importPlace.groupBy({ by: ['status'], where: { runId: run.id }, _count: true }),
    db.$queryRaw<Array<{ reason: string; n: bigint }>>`SELECT unnest(reasons) AS reason, count(*) AS n FROM import_places WHERE run_id = ${run.id}::uuid GROUP BY 1 ORDER BY 2 DESC`,
    db.$queryRaw<Array<{ site: string | null; n: bigint }>>`SELECT crawl->>'site' AS site, count(*) AS n FROM import_places WHERE run_id = ${run.id}::uuid GROUP BY 1 ORDER BY 2 DESC`,
    db.spendEntry.findMany({ where: { runId: run.id } }),
    db.importPlace.count({ where: { runId: run.id, email: { not: null } } }),
    db.importPlace.count({ where: { runId: run.id, reasons: { hasSome: ['phone_conflict', 'hours_conflict'] } } }),
  ]);
  const staged = byStatus.reduce((n, x) => n + x._count, 0);
  const media = await db.$queryRaw<Array<{ with_services: bigint; services: bigint; priced: bigint; with_logo: bigint; with_photos: bigint; photos: bigint; social: bigint }>>`
    SELECT count(*) FILTER (WHERE jsonb_array_length(COALESCE(treatments, '[]'::jsonb)) > 0) AS with_services,
           COALESCE(sum(jsonb_array_length(COALESCE(treatments, '[]'::jsonb))), 0) AS services,
           COALESCE(sum((SELECT count(*) FROM jsonb_array_elements(COALESCE(treatments, '[]'::jsonb)) t WHERE t->>'priceNis' IS NOT NULL)), 0) AS priced,
           count(*) FILTER (WHERE logo_url IS NOT NULL) AS with_logo,
           count(*) FILTER (WHERE cardinality(photo_urls) > 0) AS with_photos,
           COALESCE(sum(cardinality(photo_urls)), 0) AS photos,
           count(*) FILTER (WHERE website_kind = 'social') AS social
    FROM import_places WHERE run_id = ${run.id}::uuid`;
  const m = media[0];
  const ready = byStatus.find(x => x.status === 'ready')?._count ?? 0;
  const spent = fromMicros(r.spentMicros);
  const privateRedirects = sites.filter(x => x.kind === 'redirect_private').length;
  const refused = await db.importPlace.count({ where: { runId: run.id, crawl: { path: ['site'], equals: 'unsafe' } } });
  const refusedSites = await db.siteFetch.count({ where: { domain: { in: sites.filter(x => x.kind === 'redirect_private').map(x => x.host) }, status: 'unsafe' } });

  // Template coverage: how many staged records have each listing field.
  const { completeness, TEMPLATE_FIELDS } = await import('../../src/lib/import/completeness');
  const all = await db.importPlace.findMany({ where: { runId: run.id } });
  const cov = TEMPLATE_FIELDS.map(f => `${f.label} ${all.filter(p => f.ok(p)).length}`);
  const avg = all.length ? Math.round(all.reduce((n, p) => n + completeness(p).score, 0) / all.length) : 0;

  // Enhancing published listings: approve five ready records, blank fields on their listings the way an
  // older listing would look, run an enhancement run and see what comes back.
  const { approvePlace } = await import('../../src/lib/server/importOps');
  const { seedEnhance, enhanceStage, enhancePlaceIds } = await import('./stages/enhance');
  // Local database only (checked above): a staff user for the approvals below if there is none.
  const actor = (await db.user.findFirst({ where: { opsRole: 'ops' }, select: { id: true } })) ?? (await db.user.create({ data: { email: 'simulated-ops@beautyfind.test', opsRole: 'ops' }, select: { id: true } }));
  let enhanceLine = 'skipped (no ops user in the local database)';
  if (actor) {
    const ready = await db.importPlace.findMany({ where: { runId: run.id, status: 'ready', logoUrl: { not: null } }, take: 5 });
    const branchIds: string[] = [];
    for (const p of ready) {
      const r = await approvePlace(actor, p.id);
      if (r.ok && r.branchId) branchIds.push(r.branchId);
    }
    await db.branch.updateMany({ where: { id: { in: branchIds } }, data: { hours: [], description: null, logoUrl: null, coverUrl: null, gallery: [], email: null, accessible: false, freeParking: false, faqs: [] } });
    const er = await db.importRun.create({ data: { label: 'SIMULATED enhance', provider: 'enhance', scope: { branchIds, refresh: true }, recordLimit: branchIds.length, budgetMicros: 500_000n, maxRequests: 0, createdById: actor.id, status: 'running', lockedBy: ctx.WORKER, lockedUntil: new Date(Date.now() + ctx.LEASE_MS) } });
    await seedEnhance(er);
    while (await enhanceStage(er, 'dfs_refresh'));
    await queuePostPhotos(er, await enhancePlaceIds(er));
    while (await collectPostPhotos(er));
    while (await enhanceStage(er, 'enhance'));
    const done = await db.importRun.findUniqueOrThrow({ where: { id: er.id } });
    const c = ((done.stats as { counters?: Record<string, number> }).counters ?? {}) as Record<string, number>;
    const branches = await db.branch.findMany({ where: { id: { in: branchIds } } });
    enhanceLine = `${branchIds.length} listings approved and blanked; after enhancing: logo ${branches.filter(b => b.logoUrl).length}, cover ${branches.filter(b => b.coverUrl).length}, hours ${branches.filter(b => Array.isArray(b.hours) && b.hours.length).length}, description ${branches.filter(b => b.description).length}, email ${branches.filter(b => b.email).length}, photos per listing (cover + gallery) ${branches.map(b => (b.coverUrl ? 1 : 0) + (Array.isArray(b.gallery) ? b.gallery.length : 0)).join('/')} | counters ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ')} | spent $${(Number(done.spentMicros) / 1e6).toFixed(4)}`;
    await db.importRun.update({ where: { id: er.id }, data: { status: 'done', lockedBy: null, lockedUntil: null } });
  }

  const lines = [
    '# SIMULATED import pilot',
    '',
    '> **SIMULATED. Not a live result.** Produced by `npm run import:simulate` against a local mock of the DataForSEO',
    '> Business Listings API and invented fixture websites. No provider was contacted and no money was spent.',
    '> The counts below describe the fixtures (built to include blocked sites, robots.txt refusals, missing emails,',
    '> site-builder footer emails, phone conflicts, a redirect to a cloud metadata address, a site of another business,',
    '> directory and Instagram links given as the website, a repeated place and a record without coordinates).',
    '> They say nothing about how many Israeli businesses a live run will find.',
    '',
    `Generated ${new Date().toISOString()} in ${secs}s. Pricing reference: $0.012 per request + $0.00036 per record (mock billed at these rates).`,
    '',
    '## SIMULATED run',
    '',
    `- Record limit ${r.recordLimit}, ceiling $${fromMicros(r.budgetMicros ?? 0n).toFixed(2)}; mock provider held ${withPort.length} items (${N} businesses + 1 repeat + 1 without coordinates)`,
    `- Provider requests: ${dfs.requests.length}; simulated spend $${spent.toFixed(4)}; reserved at end $${fromMicros(r.reservedMicros).toFixed(4)}`,
    `- Spend entries: ${spend.map(e => `${e.status} ${fromMicros(e.actualMicros ?? e.estimatedMicros).toFixed(4)}`).join(', ')}`,
    `- Unique businesses staged: ${staged}`,
    `- With an email: ${emails} (${staged ? Math.round((emails / staged) * 100) : 0}%)`,
    `- Ready to publish without edits: ${ready}; conflicts sent to review: ${conflicts}`,
    `- Services: ${Number(m.services)} on ${Number(m.with_services)} records (${Number(m.priced)} with a price)`,
    `- Images: ${Number(m.with_logo)} records with a logo, ${Number(m.with_photos)} with photos (${Number(m.photos)} photos chosen)`,
    `- Social profile kept as the website: ${Number(m.social)}`,
    `- Fixture sites that redirect to the cloud metadata address: ${privateRedirects}; of those crawled, refused as unsafe: ${refusedSites} (records marked unsafe: ${refused})`,
    '',
    '## SIMULATED records by status',
    '',
    ...byStatus.map(x => `- ${x.status}: ${x._count}`),
    '',
    '## SIMULATED reasons',
    '',
    ...reasons.map(x => `- ${x.reason}: ${Number(x.n)}`),
    '',
    '## SIMULATED website outcomes',
    '',
    ...siteOut.map(x => `- ${x.site ?? 'not checked'}: ${Number(x.n)}`),
    '',
    '## SIMULATED listing template coverage',
    '',
    `Average completeness ${avg}%. Records with each field: ${cov.join(', ')}.`,
    '',
    '## SIMULATED enhancement of published listings',
    '',
    enhanceLine,
    '',
    '## What a live pilot needs',
    '',
    '1. DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD as GitHub Actions secrets (the worker runs there).',
    '2. `npm run import:dfs-categories` once, to confirm the category ids in src/lib/import/dataforseo.ts.',
    '3. A pilot run from /ops/import: DataForSEO, one city, record limit 100, ceiling $1.',
    '',
  ];
  const out = join(process.cwd(), 'docs', 'import-pilot-SIMULATED.md');
  writeFileSync(out, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\nwritten to ${out}`);

  if (!keep) {
    await db.importPlace.deleteMany({ where: { runId: run.id } });
    await db.spendEntry.deleteMany({ where: { runId: run.id } });
    await db.importRun.delete({ where: { id: run.id } });
    await db.siteFetch.deleteMany({ where: { domain: { endsWith: '.test' } } });
  } else {
    await db.importRun.update({ where: { id: run.id }, data: { status: 'done', finishedAt: new Date(), lockedBy: null, lockedUntil: null } });
    console.log(`kept run ${run.id}; see /ops/import`);
  }
  await db.$disconnect();
  await dfs.close();
  await web.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
