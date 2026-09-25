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
  const dfs = await startMockDfs(withPort);
  process.env.DATAFORSEO_BASE_URL = dfs.url;

  const ctx = await import('./ctx');
  const { seedDfs, discoverDfs } = await import('./stages/dfsDiscover');
  const { enrich } = await import('./stages/enrich');
  const { extractStage } = await import('./stages/extractLlm');
  const { check } = await import('./stages/check');
  const { fromMicros } = await import('../../src/lib/import/pricing');
  const { loadSettings } = await import('../../src/lib/import/settings');
  const { db } = ctx;
  const s = await loadSettings(db);

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
  const ready = byStatus.find(x => x.status === 'ready')?._count ?? 0;
  const spent = fromMicros(r.spentMicros);
  const privateRedirects = sites.filter(x => x.kind === 'redirect_private').length;
  const refused = await db.importPlace.count({ where: { runId: run.id, crawl: { path: ['site'], equals: 'unsafe' } } });
  const refusedSites = await db.siteFetch.count({ where: { domain: { in: sites.filter(x => x.kind === 'redirect_private').map(x => x.host) }, status: 'unsafe' } });

  const lines = [
    '# SIMULATED import pilot',
    '',
    '> **SIMULATED. Not a live result.** Produced by `npm run import:simulate` against a local mock of the DataForSEO',
    '> Business Listings API and invented fixture websites. No provider was contacted and no money was spent.',
    '> The counts below describe the fixtures (built to include blocked sites, robots.txt refusals, missing emails,',
    '> site-builder footer emails, phone conflicts, a redirect to a cloud metadata address, a repeated place and a',
    '> record without coordinates). They say nothing about how many Israeli businesses a live run will find.',
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
