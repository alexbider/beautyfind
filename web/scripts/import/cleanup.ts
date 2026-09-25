// Removes old import runs so imports start fresh. Live listings are never touched: records that were
// approved or merged into a listing are kept (with their run) as the link to that listing.
//
//   npm run import:cleanup -- --provider google            list what would be removed
//   npm run import:cleanup -- --provider google --confirm  remove it

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const KEEP = ['approved', 'merged'] as const;

async function main() {
  const provider = arg('provider');
  if (!provider) throw new Error('--provider is required (for example google)');
  const confirm = process.argv.includes('--confirm');
  const runs = await db.importRun.findMany({ where: { provider }, select: { id: true, label: true, status: true, createdAt: true } });
  const ids = runs.map(r => r.id);
  const [places, kept] = await Promise.all([
    db.importPlace.count({ where: { runId: { in: ids }, status: { notIn: [...KEEP] } } }),
    db.importPlace.count({ where: { runId: { in: ids }, status: { in: [...KEEP] } } }),
  ]);
  for (const r of runs) console.log(`run "${r.label}" ${r.status} ${r.createdAt.toISOString().slice(0, 10)}`);
  console.log(`SUMMARY runs=${runs.length} records_to_remove=${places} records_kept_linked_to_live_listings=${kept}`);
  if (!confirm) return console.log('dry run: nothing removed (add --confirm)');
  if (['running'].some(s => runs.some(r => r.status === s))) throw new Error('a run is still running; pause or cancel it first');

  const res = await db.$transaction(async tx => {
    const obs = await tx.fieldObservation.deleteMany({ where: { importPlace: { runId: { in: ids }, status: { notIn: [...KEEP] } } } });
    // Drop pointers from kept records to records about to go.
    const doomed = (await tx.importPlace.findMany({ where: { runId: { in: ids }, status: { notIn: [...KEEP] } }, select: { id: true } })).map(p => p.id);
    await tx.importPlace.updateMany({ where: { dupOfId: { in: doomed } }, data: { dupOfId: null } });
    const pl = await tx.importPlace.deleteMany({ where: { runId: { in: ids }, status: { notIn: [...KEEP] } } });
    const tasks = await tx.importTask.deleteMany({ where: { runId: { in: ids } } });
    const withKept = new Set((await tx.importPlace.findMany({ where: { runId: { in: ids } }, select: { runId: true } })).map(p => p.runId));
    const gone = ids.filter(id => !withKept.has(id));
    const spend = await tx.spendEntry.deleteMany({ where: { runId: { in: gone } } });
    const rr = await tx.importRun.deleteMany({ where: { id: { in: gone } } });
    // Old crawl cache, so the new website stage reads every site fresh.
    const sites = await tx.siteFetch.deleteMany({});
    return { runs: rr.count, runsKept: withKept.size, places: pl.count, observations: obs.count, tasks: tasks.count, spend: spend.count, siteCache: sites.count };
  }, { timeout: 120_000 });
  console.log(`REMOVED ${Object.entries(res).map(([k, v]) => `${k}=${v}`).join(' ')}`);
}

main()
  .catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
