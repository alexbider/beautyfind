// Extra sources inside an import run, so a record is complete the first time it reaches review:
// after the website stage, every record still missing template sections gets the Apify steps that can
// fill them (Google Maps, the business's Facebook page and Instagram profile, a browser read of a site
// our crawler could not load). Records that gained a website or a rendered site go through the
// website stage once more, then the editorial writer runs on the full evidence.

import type { ImportRun } from '@prisma/client';
import { planFor, planSignals, STEP_ORDER, type StepId } from '../../../src/lib/import/enrichPlan';
import { placeCoverage } from '../../../src/lib/import/placeCoverage';
import { db, log, setStats, settings } from '../ctx';
import { apifyConfigured } from '../providers/apify';
import { seedApifyTasks } from './apify';

const APIFY_STEPS: StepId[] = ['maps', 'facebook', 'instagram', 'render'];

/** Plans the Apify steps for this run's records and creates their tasks (once per run). */
export async function seedSources(run: ImportRun): Promise<Record<string, number>> {
  const stats = (run.stats ?? {}) as { sourcesSeeded?: boolean };
  if (stats.sourcesSeeded) return {};
  const s = await settings();
  const places = await db.importPlace.findMany({ where: { runId: run.id, status: { in: ['enriched', 'extracted'] } } });
  const opts = { settings: s, apifyConfigured: apifyConfigured(), allowed: APIFY_STEPS };
  const plans = new Map<string, Set<string>>();
  const counts = Object.fromEntries(STEP_ORDER.map(st => [st, 0]));
  for (const p of places) {
    const cov = placeCoverage(p, { mapConfigured: true });
    const plan = planFor(cov.missing, planSignals(p), opts);
    plans.set(p.id, new Set(plan));
    for (const st of plan) counts[st]++;
  }
  const tasks = await seedApifyTasks(run, plans, places);
  await setStats(run.id, { sourcesSeeded: true, sourcesPlan: counts, apifyTasks: tasks, apifyConfigured: apifyConfigured() });
  log(`sources: ${places.length} records, plan ${JSON.stringify(counts)}`);
  return counts;
}

/**
 * After the actors ran: records whose site was rendered, or that gained a website from a profile, go
 * back to the website stage (the rendered summary is in the domain cache; a new website is crawled).
 */
export async function requeueAfterSources(run: ImportRun): Promise<number> {
  const places = await db.importPlace.findMany({ where: { runId: run.id, status: { in: ['enriched', 'extracted'] } }, select: { id: true, crawl: true } });
  const again: string[] = [];
  for (const p of places) {
    const apify = ((p.crawl as { apify?: Record<string, { filled?: string[]; status?: string }> } | null)?.apify ?? {});
    const rendered = !!apify.render;
    const newSite = Object.values(apify).some(x => Array.isArray(x?.filled) && x.filled.includes('website'));
    if (rendered || newSite) again.push(p.id);
  }
  if (again.length) await db.importPlace.updateMany({ where: { id: { in: again } }, data: { status: 'found' } });
  if (again.length) log(`sources: ${again.length} records go through the website stage again`);
  return again.length;
}
