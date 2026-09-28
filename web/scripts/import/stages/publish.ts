// Optional last step of an import run: publish the records that passed every check without a person
// looking (scope.autoPublish, off by default). "Ready" means no blocking reason and no review reason;
// anything a person should look at stays in the review queue. Same code path as the approve button.

import type { ImportRun } from '@prisma/client';
import { approvePlace } from '../../../src/lib/server/importOps';
import { bump, db, heartbeat, log } from '../ctx';

/** Tells the site to refresh its cached public pages (needs SITE_URL and REVALIDATE_SECRET on the worker); otherwise they refresh on their own schedule. */
export async function refreshSite(): Promise<boolean> {
  const base = (process.env.SITE_URL || '').replace(/\/$/, '');
  const secret = process.env.REVALIDATE_SECRET;
  if (!base || !secret) {
    log('publish: SITE_URL or REVALIDATE_SECRET not set, the public pages refresh on their own schedule');
    return false;
  }
  try {
    const res = await fetch(`${base}/api/revalidate`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15_000) });
    log(`publish: site refresh ${res.ok ? 'done' : `failed (${res.status})`}`);
    return res.ok;
  } catch (e) {
    log(`publish: site refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

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
  if (n) await refreshSite();
  return n;
}
