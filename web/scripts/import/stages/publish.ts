// Optional last step of an import run: publish the records that passed every check without a person
// looking (scope.autoPublish, off by default). "Ready" means no blocking reason and no review reason;
// anything a person should look at stays in the review queue. Same code path as the approve button.

import type { ImportRun } from '@prisma/client';
import { approvePlace } from '../../../src/lib/server/importOps';
import { bump, db, heartbeat, log } from '../ctx';

export async function publishReady(run: ImportRun): Promise<number> {
  const actor = run.createdById ? { id: run.createdById } : null;
  if (!actor) {
    log('publish: run has no creator, nothing published');
    return 0;
  }
  let n = 0;
  for (;;) {
    await heartbeat(run.id);
    const batch = await db.importPlace.findMany({ where: { runId: run.id, status: 'ready' }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: 20 });
    if (!batch.length) break;
    for (const { id } of batch) {
      const r = await approvePlace(actor, id);
      if (r.ok) n++;
      else await db.importPlace.updateMany({ where: { id, status: 'ready' }, data: { status: 'needs_review', reasons: { push: `publish_${r.error}` } } });
    }
  }
  await bump(run.id, { autoPublished: n });
  log(`publish: ${n} records published automatically`);
  return n;
}
