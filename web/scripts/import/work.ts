// Directory import worker. Picks up a queued run from /ops/import and takes it through
//   discover (DataForSEO, or the legacy Google grid) -> website enrichment -> optional LLM -> checks.
// Safe to stop at any point and start again: every step reads its state from the database, paid
// calls are checkpointed around the request, and a lease stops two workers from working the same run.
//
//   npm run import:work                      next queued run
//   npm run import:work -- --run <id>        a specific run
//   npm run import:work -- --max-minutes 30  stop after 30 minutes (resume later)
//
// See docs/import.md for configuration.

import { appendFileSync } from 'node:fs';
import type { ImportRun } from '@prisma/client';
import { sweepExpired } from '../../src/lib/import/retention';
import { RunScope } from '../../src/lib/import/rules';
import { closeBrowser } from './crawl';
import { argRun, db, LEASE_MS, log, Stop, timeLeft, WORKER } from './ctx';
import { check } from './stages/check';
import { discoverDfs, seedDfs } from './stages/dfsDiscover';
import { enrich } from './stages/enrich';
import { enhancePlaceIds, enhanceStage, seedEnhance } from './stages/enhance';
import { collectPostPhotos, queuePostPhotos } from './stages/googlePosts';
import { extractStage } from './stages/extractLlm';
import { discoverGoogle, seedGoogle } from './stages/googleDiscover';

async function claim(runId?: string): Promise<ImportRun | null> {
  const now = new Date();
  const candidates = await db.importRun.findMany({
    where: { ...(runId ? { id: runId } : {}), status: { in: ['queued', 'running'] }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }, { lockedBy: WORKER }] },
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
  log(`run ${run.id} "${run.label}" (${run.provider})`);
  try {
    if (run.provider === 'enhance') {
      await seedEnhance(run);
      while (await enhanceStage(run, 'dfs_refresh'));
      await queuePostPhotos(run, await enhancePlaceIds(run));
      while (await collectPostPhotos(run));
      while (await enhanceStage(run, 'enhance'));
      await db.importRun.updateMany({ where: { id: run.id, lockedBy: WORKER }, data: { status: 'done', finishedAt: new Date(), lockedBy: null, lockedUntil: null } });
      log('enhance run done');
      return 'done';
    }
    const scope = RunScope.parse(run.scope);
    if (run.provider === 'dataforseo') {
      await seedDfs(run, scope);
      while (await discoverDfs(run));
    } else {
      await seedGoogle(run, scope);
      while (await discoverGoogle(run));
    }
    while (await enrich(run));
    // Records still short of photos: photos from the business's own Google posts.
    await queuePostPhotos(run, (await db.importPlace.findMany({ where: { runId: run.id, status: { in: ['enriched', 'extracted'] } }, select: { id: true } })).map(p => p.id));
    while (await collectPostPhotos(run));
    while (await extractStage(run));
    await check(run);
    await db.importRun.updateMany({ where: { id: run.id, lockedBy: WORKER }, data: { status: 'done', finishedAt: new Date(), lockedBy: null, lockedUntil: null } });
    log('run done');
    return 'done';
  } catch (e) {
    if (e instanceof Stop) {
      await db.importRun.updateMany({ where: { id: run.id, lockedBy: WORKER }, data: { lockedBy: null, lockedUntil: null, ...(/kill switch|disabled/.test(e.message) ? { status: 'paused', error: e.message } : {}) } });
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
  const only = argRun();
  let more = false;
  const swept = await sweepExpired(db);
  if (swept.google || swept.observations) log(`deleted expired restricted data: ${swept.google} Google, ${swept.observations} observations`);
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
