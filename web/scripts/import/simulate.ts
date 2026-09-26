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
// The editorial writer and YouTube are stood in for locally: no API call leaves the machine.
process.env.IMPORT_EDITORIAL_MOCK = '1';
process.env.STORAGE_ADAPTER ??= 'local';
process.env.UPLOAD_DIR ??= `${process.env.TMPDIR ?? '/tmp'}/bf-sim-uploads`;

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
  process.env.YOUTUBE_OEMBED_BASE = `http://yt.test:${web.port}/oembed`;

  const ctx = await import('./ctx');
  const { seedDfs, discoverDfs } = await import('./stages/dfsDiscover');
  const { enrich } = await import('./stages/enrich');
  const { queuePostPhotos, collectPostPhotos } = await import('./stages/googlePosts');
  const { extractStage } = await import('./stages/extractLlm');
  const { editorialStage } = await import('./stages/editorial');
  const { check } = await import('./stages/check');
  const { countWords, WORDS_MIN } = await import('../../src/lib/import/editorial');
  const { fromMicros } = await import('../../src/lib/import/pricing');
  const { loadSettings } = await import('../../src/lib/import/settings');
  const { db } = ctx;
  const s = await loadSettings(db);

  // Start from a clean slate: earlier simulated records would otherwise be "seen again" and keep old results.
  const old = await db.importRun.findMany({ where: { label: { in: ['SIMULATED pilot', 'SIMULATED enhance'] } }, select: { id: true } });
  // Listings approved by earlier simulations (and their businesses) go too, so approvals below start fresh.
  const oldBranches = await db.$queryRaw<Array<{ business_id: string }>>`SELECT DISTINCT b.business_id FROM branches b JOIN import_places p ON p.branch_id = b.id WHERE p.place_id LIKE 'ChIJsim%' OR p.place_id LIKE 'dfs:cid:9000000%' OR p.run_id = ANY(${old.map(r => r.id)}::uuid[])`;
  if (oldBranches.length) await db.business.deleteMany({ where: { id: { in: oldBranches.map(r => r.business_id) } } });
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
    while (await editorialStage(run));
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

  // The 10-business pilot (feature request §12): richly sourced clinics, chain branches, a site without
  // prices, sparse listings without a site. Approved through the real path, then measured.
  const { branchCoverage } = await import('../../src/lib/server/importPublish');
  const kindOf = (p: { website: string | null }) => sites.find(x => p.website?.includes(`//${x.host}:`))?.kind ?? null;
  const open = (p: { status: string }) => ['ready', 'needs_review'].includes(p.status);
  const richOrChain = all.filter(p => (kindOf(p) === 'rich' || kindOf(p) === 'chain') && open(p));
  const noPrices = all.filter(p => kindOf(p) === 'no_prices' && open(p));
  const sparse = all.filter(p => !p.website && p.status === 'ready');
  const plain = all.filter(p => p.status === 'ready' && !richOrChain.includes(p) && !noPrices.includes(p) && !sparse.includes(p));
  const pilotPicks = [...richOrChain.slice(0, 4), ...noPrices.slice(0, 1), ...sparse.slice(0, 2), ...plain.slice(0, 3)].slice(0, 10);
  const { approvePlace: approveForPilot } = await import('../../src/lib/server/importOps');
  const pilotActor = (await db.user.findFirst({ where: { opsRole: 'ops' }, select: { id: true } })) ?? (await db.user.create({ data: { email: 'simulated-ops@beautyfind.test', opsRole: 'ops' }, select: { id: true } }));
  const pilotRows: string[] = [];
  const pilotTotals = { words: [] as number[], faqs: [] as number[], photos: 0, videos: 0, unpriced: 0, services: 0, statuses: {} as Record<string, number>, needsMore: 0 };
  for (const p of pilotPicks) {
    const r = await approveForPilot(pilotActor, p.id);
    if (!r.ok || !r.branchId) {
      pilotRows.push(`- ${p.name}: not approved (${r.ok ? 'no branch' : r.error})`);
      continue;
    }
    const b = await db.branch.findUniqueOrThrow({ where: { id: r.branchId }, include: { categories: true, treatments: { where: { isPublished: true }, select: { priceAgorot: true, priceType: true } } } });
    const staff = await db.staffMember.count({ where: { businessId: b.businessId } });
    const cov = branchCoverage(b, { verifiedStaff: 0, conflicts: [], reviewReasons: [] });
    const ed = (b.editorial ?? null) as { words?: number; faqs?: unknown[]; needsMoreInfo?: boolean; model?: string } | null;
    const words = ed?.words ?? countWords(b.description ?? '');
    const faqs = Array.isArray(b.faqs) ? b.faqs.length : 0;
    const photos = (b.coverUrl?.startsWith('/media/') ? 1 : 0) + (Array.isArray(b.gallery) ? b.gallery.length : 0);
    const videos = Array.isArray(b.videos) ? b.videos.length : 0;
    const unpriced = b.treatments.filter(t => t.priceAgorot == null).length;
    pilotTotals.words.push(words);
    pilotTotals.faqs.push(faqs);
    pilotTotals.photos += photos;
    pilotTotals.videos += videos;
    pilotTotals.unpriced += unpriced;
    pilotTotals.services += b.treatments.length;
    pilotTotals.statuses[cov.status] = (pilotTotals.statuses[cov.status] ?? 0) + 1;
    if (ed?.needsMoreInfo) pilotTotals.needsMore++;
    const zero = b.treatments.filter(t => t.priceAgorot === 0 && t.priceType !== 'free').length;
    pilotRows.push(`- ${b.name} (${b.cityName}; ${b.categories.map(c => c.categorySlug).join(', ') || 'no category'}): ${cov.status}, coverage ${cov.templateCoverage}%, readiness ${cov.readiness}%, description ${words} words (${ed?.model ?? 'source'}${ed?.needsMoreInfo ? ', needs_more_business_information' : ''}), ${faqs} FAQs, ${b.treatments.length} services (${unpriced} without a published price, ${zero} zero-priced), ${photos} photos, ${videos} videos, team ${Array.isArray(b.team) ? b.team.length : 0} from the site / ${staff} staff logins created, hours ${Array.isArray(b.hours) && b.hours.length ? 'known' : 'unknown'}, map ${process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY ? 'embed' : 'not configured (links only)'}`);
  }
  const editorialSpend = await db.spendEntry.aggregate({ where: { runId: run.id, provider: 'anthropic' }, _sum: { actualMicros: true }, _count: true });
  const pilotLines = [
    '## SIMULATED 10-business pilot',
    '',
    `Approved through the real approve path (${pilotPicks.length} records: rich clinic sites, a two-branch chain, a site without prices, sparse listings without a site, plain sites). The editorial writer ran in mock mode (model "template": a deterministic draft built from the evidence packet, so word counts show the packet's richness, not Claude's writing). YouTube ids were validated against a local oEmbed stand-in.`,
    '',
    ...pilotRows,
    '',
    `- Descriptions: ${pilotTotals.words.filter(w => w >= WORDS_MIN).length} of ${pilotTotals.words.length} reach ${WORDS_MIN} words; ${pilotTotals.needsMore} flagged needs_more_business_information (kept short, not padded). FAQs: ${pilotTotals.faqs.filter(n => n >= 5).length} of ${pilotTotals.faqs.length} have five or more.`,
    `- Services: ${pilotTotals.services} published, ${pilotTotals.unpriced} shown as "המחיר לא פורסם" with a quote action; zero-priced unknowns: 0 by construction (checked per row above).`,
    `- Media: ${pilotTotals.photos} copied photos (WebP derivatives when sharp is available), ${pilotTotals.videos} playable videos; before/after candidates are never published.`,
    `- Readiness: ${Object.entries(pilotTotals.statuses).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`,
    `- Editorial cost recorded for the run: $${fromMicros(editorialSpend._sum.actualMicros ?? 0n).toFixed(4)} over ${editorialSpend._count} calls (mock: $0). A live Sonnet call is estimated at about $0.06 per profile plus 25% for repairs.`,
    '',
  ];

  // Enhancing published listings: approve five ready records, blank fields on their listings the way an
  // older listing would look, run an enhancement run and see what comes back.
  const { approvePlace } = await import('../../src/lib/server/importOps');
  const { seedEnhance, enhanceStage, enhancePlaceIds } = await import('./stages/enhance');
  // Local database only (checked above): a staff user for the approvals below if there is none.
  const actor = (await db.user.findFirst({ where: { opsRole: 'ops' }, select: { id: true } })) ?? (await db.user.create({ data: { email: 'simulated-ops@beautyfind.test', opsRole: 'ops' }, select: { id: true } }));
  let enhanceLine = 'skipped (no ops user in the local database)';
  if (actor) {
    const ready = await db.importPlace.findMany({ where: { runId: run.id, status: 'ready', logoUrl: { not: null } }, take: 5 });
    const { editorialStage: _unused } = { editorialStage };
    void _unused;
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
    ...pilotLines,
    '## SIMULATED enhancement of published listings',
    '',
    enhanceLine,
    '',
    '## What a live pilot needs',
    '',
    '1. DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD as GitHub Actions secrets (the worker runs there).',
    '2. `npm run import:dfs-categories` once, to confirm the category ids in src/lib/import/dataforseo.ts.',
    '3. ANTHROPIC_API_KEY as a GitHub Actions secret for the editorial writer (IMPORT_EDITORIAL_MODEL optional), YOUTUBE_API_KEY optional, NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY on Vercel for the map.',
    '4. A pilot run from /ops/import: DataForSEO, one city, record limit 10, ceiling $2 (the editorial allowance is reserved per profile and settled at the reported token cost).',
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
