// Extra sources inside an import run, so a record is complete the first time it reaches review:
// after the website stage, every record still missing template sections gets the steps that can fill
// them (the Apify actors for Google Maps, the business's Facebook page and Instagram profile; the
// worker's own browser for a site our crawler could not load) and ChatGPT web research for what is
// still open. Records that gained a website or a rendered site go through the website stage once
// more, then the editorial writer runs on the full evidence.

import type { ImportRun } from '@prisma/client';
import { planFor, planSignals, STEP_ORDER, type StepId } from '../../../src/lib/import/enrichPlan';
import { placeCoverage } from '../../../src/lib/import/placeCoverage';
import { db, log, setStats, settings } from '../ctx';
import { apifyConfigured } from '../providers/apify';
import { seedApifyTasks } from './apify';
import { seedRenderTasks } from './render';
import { researchGainedWebsite, seedResearchTasks } from './research';
import { openaiConfigured } from '../providers/openai';

const SOURCE_STEPS: StepId[] = ['maps', 'facebook', 'instagram', 'render', 'research'];

/** Plans the source steps for this run's records and creates their tasks (once per run). */
export async function seedSources(run: ImportRun): Promise<Record<string, number>> {
  const stats = (run.stats ?? {}) as { sourcesSeeded?: boolean };
  if (stats.sourcesSeeded) return {};
  const s = await settings();
  const places = await db.importPlace.findMany({ where: { runId: run.id, status: { in: ['enriched', 'extracted'] } } });
  const opts = { settings: s, apifyConfigured: apifyConfigured(), openaiConfigured: openaiConfigured(), allowed: SOURCE_STEPS };
  const plans = new Map<string, Set<string>>();
  const counts = Object.fromEntries(STEP_ORDER.map(st => [st, 0]));
  for (const p of places) {
    const cov = placeCoverage(p, { mapConfigured: true });
    const plan = planFor(cov.missing, planSignals(p), opts);
    plans.set(p.id, new Set(plan));
    for (const st of plan) counts[st]++;
  }
  const tasks = await seedApifyTasks(run, plans, places);
  const render = await seedRenderTasks(run, plans, places);
  const research = await seedResearchTasks(run, places.filter(p => plans.get(p.id)?.has('research')).map(p => p.id));
  await setStats(run.id, { sourcesSeeded: true, sourcesPlan: counts, apifyTasks: tasks, renderSites: render, researchTasks: research, apifyConfigured: apifyConfigured(), openaiConfigured: openaiConfigured() });
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
    const crawl = (p.crawl ?? {}) as { apify?: Record<string, { filled?: string[]; status?: string }>; render?: { status?: string } };
    const apify = crawl.apify ?? {};
    const rendered = crawl.render?.status === 'ok' || crawl.render?.status === 'no_email';
    const newSite = Object.values(apify).some(x => Array.isArray(x?.filled) && x.filled.includes('website')) || researchGainedWebsite(p.crawl);
    if (rendered || newSite) again.push(p.id);
  }
  if (again.length) await db.importPlace.updateMany({ where: { id: { in: again } }, data: { status: 'found' } });
  if (again.length) log(`sources: ${again.length} records go through the website stage again`);
  return again.length;
}
