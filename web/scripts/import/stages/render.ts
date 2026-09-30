// Render stage: sites our HTTP crawler could not read (a failed fetch, or a JavaScript shell with no
// content) are read once more in the worker's own headless Chromium through Crawlee's PlaywrightCrawler
// (scripts/import/crawlee/browser.ts). No provider, no charge per page. Runs inside import runs after
// the website stage and inside enhance runs, only for the records whose plan names the `render` step
// (src/lib/import/enrichPlan.ts).
//
// The rendered pages go through the same `extractPage` as any crawl and become the domain's cached
// site summary, which the website stage then reads like any other site (requeueAfterSources sends the
// record back through it). Sites that blocked us or forbid crawling in robots.txt are never rendered:
// the planner leaves them out, and robots.txt is checked again here before the browser opens.

import { Prisma, type ImportPlace, type ImportRun } from '@prisma/client';
import { siteHost } from '../../../src/lib/import/email';
import { extractPage } from '../../../src/lib/import/siteExtract';
import { allowedBy, robots, type CrawlOutcome } from '../crawl';
import { browserAvailable, renderPages } from '../crawlee/browser';
import { bump, db, heartbeat, log, setStats, settings, Stop } from '../ctx';
import { summarize } from './enrich';

export const RENDER_TASK = 'render';
const SITES_PER_TASK = 5;

export interface RenderTarget {
  id: string; // import record id
  url: string; // the record's website
}

interface TaskParams {
  targets: RenderTarget[];
}

type Crawl = Record<string, unknown> & { render?: Record<string, unknown> };

/** Creates the render tasks of a run from the per-record plans: one task per five sites, every record of a site on it. */
export async function seedRenderTasks(run: ImportRun, plans: Map<string, Set<string>>, places: Array<Pick<ImportPlace, 'id' | 'website'>>): Promise<number> {
  const s = await settings();
  if (!s.apifyRender) return 0;
  const targets: RenderTarget[] = places.filter(p => plans.get(p.id)?.has('render') && p.website && siteHost(p.website)).map(p => ({ id: p.id, url: p.website! }));
  const hosts = [...new Set(targets.map(t => siteHost(t.url)!))];
  const tasks: Prisma.ImportTaskCreateManyInput[] = [];
  for (let i = 0; i < hosts.length; i += SITES_PER_TASK) {
    const slice = new Set(hosts.slice(i, i + SITES_PER_TASK));
    tasks.push({ runId: run.id, key: `${RENDER_TASK}:${i}`, kind: RENDER_TASK, params: { targets: targets.filter(t => slice.has(siteHost(t.url)!)) } as unknown as Prisma.InputJsonValue });
  }
  if (tasks.length) await db.importTask.createMany({ data: tasks, skipDuplicates: true });
  return hosts.length;
}

/** Runs one pending render task. Returns false when none is left. */
export async function renderStage(run: ImportRun): Promise<boolean> {
  const task = await db.importTask.findFirst({ where: { runId: run.id, kind: RENDER_TASK, status: { in: ['pending', 'dispatched'] } }, orderBy: { createdAt: 'asc' } });
  if (!task) return false;
  await heartbeat(run.id);
  const s = await settings();
  if (s.killSwitch) throw new Stop('kill switch on');
  if (!browserAvailable()) {
    await db.importTask.updateMany({ where: { runId: run.id, kind: RENDER_TASK, status: 'pending' }, data: { status: 'failed', error: 'no Chromium on the worker (npx playwright-core install chromium, or CRAWL_CHROMIUM_PATH)' } });
    await setStats(run.id, { renderNoBrowser: true });
    log('render: no Chromium on the worker, render tasks skipped');
    return true;
  }
  await db.importTask.update({ where: { id: task.id }, data: { status: 'dispatched' } });
  const { targets } = task.params as unknown as TaskParams;
  const hosts = [...new Set(targets.map(t => siteHost(t.url)).filter((h): h is string => !!h))];
  let done = 0;
  let pagesTotal = 0;
  for (const host of hosts) {
    await heartbeat(run.id);
    const start = targets.find(t => siteHost(t.url) === host)!.url;
    const r = await renderSite(host, start, s);
    pagesTotal += r.pages;
    if (r.status === 'ok' || r.status === 'no_email') done++;
    const now = new Date().toISOString();
    for (const t of targets.filter(x => siteHost(x.url) === host)) {
      const p = await db.importPlace.findUnique({ where: { id: t.id }, select: { crawl: true } });
      if (!p) continue;
      const crawl = (p.crawl ?? {}) as Crawl;
      crawl.render = { at: now, pages: r.pages, status: r.status, ...(r.error ? { error: r.error } : {}) };
      await db.importPlace.update({ where: { id: t.id }, data: { crawl: crawl as Prisma.InputJsonValue } });
    }
    log(`render ${host}: ${r.status}, ${r.pages} pages${r.error ? ` (${r.error})` : ''}`);
  }
  await db.importTask.update({ where: { id: task.id }, data: { status: 'done', found: done } });
  await bump(run.id, { renderSites: hosts.length, renderOk: done, browserPages: pagesTotal });
  return true;
}

/** Renders one site into the domain cache. The outcome is what the website stage will see. */
async function renderSite(host: string, start: string, s: Awaited<ReturnType<typeof settings>>): Promise<{ status: CrawlOutcome['status']; pages: number; error?: string }> {
  const now = new Date();
  const fail = async (status: 'failed' | 'robots', error: string) => {
    const nextCheckAt = new Date(now.getTime() + s.recheckFailDays * 86_400_000);
    await db.siteFetch.upsert({ where: { domain: host }, create: { domain: host, status, fetchedAt: now, nextCheckAt, error }, update: { status, fetchedAt: now, nextCheckAt, error } });
    return { status, pages: 0, error };
  };
  let origin: string;
  try {
    origin = new URL(start).origin;
  } catch {
    return fail('failed', 'render: bad url');
  }
  const rules = (await robots(origin)) ?? [];
  if (!allowedBy(new URL(start).pathname || '/', rules)) return fail('robots', 'render: robots.txt disallows');
  let rendered: Awaited<ReturnType<typeof renderPages>>;
  try {
    rendered = await renderPages([start], { followLinks: true, maxPages: s.apifyRenderPages });
  } catch (e) {
    return fail('failed', `render: ${(e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, '<url>').slice(0, 160)}`);
  }
  // Pages robots.txt keeps us out of are dropped even when the browser followed a link to them.
  const pages = rendered.filter(pg => {
    try {
      return allowedBy(new URL(pg.finalUrl).pathname || '/', rules);
    } catch {
      return false;
    }
  });
  const facts = pages.filter(pg => pg.status > 0 && pg.status < 400 && pg.html).map(pg => extractPage(pg.html, pg.finalUrl, host));
  if (!facts.length) return fail('failed', 'render: no readable page');
  const outcome: CrawlOutcome = {
    status: facts.some(f => f.emails.length) ? 'ok' : 'no_email',
    pages: pages.map((pg, i) => ({ url: pg.finalUrl, status: pg.status, via: 'browser', depth: i ? 1 : 0 })),
    facts, validators: {}, contentHash: null, browserUsed: pages.length,
  };
  const summary = { ...summarize(outcome, s.llmEnabled), via: 'browser' };
  const nextCheckAt = new Date(now.getTime() + s.recheckOkDays * 86_400_000);
  await db.siteFetch.upsert({
    where: { domain: host },
    create: { domain: host, status: outcome.status, fetchedAt: now, nextCheckAt, pages: pages.length, result: summary as unknown as Prisma.InputJsonValue, error: null },
    update: { status: outcome.status, fetchedAt: now, nextCheckAt, pages: pages.length, result: summary as unknown as Prisma.InputJsonValue, error: null, validators: {} },
  });
  return { status: outcome.status, pages: pages.length };
}
