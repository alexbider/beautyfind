// Self-hosted browser rendering with Crawlee's PlaywrightCrawler on the worker's own Chromium. Used as
// the fallback for pages whose plain HTML carries no content (a JavaScript shell) and by the render
// stage that reads whole sites the HTTP crawler could not. No third-party actor, no cost per page.
//
// Safety: every navigation and every sub-request (scripts, XHR) goes through the same SSRF check as
// the HTTP crawler; images, media and fonts are never loaded; sites that block or forbid crawling are
// never rendered (the caller decides that from the HTTP outcome).

import { randomUUID } from 'node:crypto';
import { chromium, type LaunchOptions, type Route } from 'playwright-core';
import { Configuration, PlaywrightCrawler, RequestQueue } from 'crawlee';
import { checkUrl, guardedLookup } from '../../../src/lib/import/safeFetch';
import { extractPage, FOLLOW } from '../../../src/lib/import/siteExtract';
import { BRANCHES_LINK } from '../../../src/lib/import/locations';

export const UA = 'BeautyFindBot/1.0 (+https://beautyfind.co.il/bot; business directory listing check)';
const ALLOW_PRIVATE = process.env.IMPORT_TEST_ALLOW_PRIVATE === '1';

export interface RenderedPage {
  url: string; // requested
  finalUrl: string;
  status: number;
  html: string;
}

export interface RenderOptions {
  maxPages?: number; // default: the number of urls given
  followLinks?: boolean; // also read the site's relevant pages (menu, contact, branches, prices) from the first page
  timeoutMs?: number;
}

/** Whether a Chromium the worker can launch is around. Presence only. */
export function browserAvailable(): boolean {
  if (process.env.CRAWL_CHROMIUM_PATH) return true;
  try {
    return !!chromium.executablePath();
  } catch {
    return false;
  }
}

/** Crawlee configuration for one-off in-memory crawls: nothing is written under ./storage. */
export const memoryConfig = () => new Configuration({ persistStorage: false, purgeOnStart: false });

// Crawlee routes every browser through a local proxy (for per-context proxies we never use). This
// launcher drops that, so Chromium connects directly, like the HTTP crawler, and the address check
// below applies to the connection the browser really makes.
const directLauncher = {
  name: () => 'chromium',
  executablePath: () => chromium.executablePath(),
  launch: (o: LaunchOptions = {}) => chromium.launch({ ...o, proxy: undefined }),
  launchPersistentContext: (dir: string, o: LaunchOptions = {}) => chromium.launchPersistentContext(dir, { ...o, proxy: undefined }),
  connect: chromium.connect.bind(chromium),
  connectOverCDP: chromium.connectOverCDP.bind(chromium),
} as unknown as typeof chromium;

/** Whether the host resolves to public addresses only (test fixtures on .test are loopback by design). One lookup per host per crawl. */
function hostGuard(): (hostname: string) => Promise<boolean> {
  const seen = new Map<string, Promise<boolean>>();
  return hostname => {
    if (ALLOW_PRIVATE && (hostname === 'localhost' || hostname.endsWith('.test') || /^127\./.test(hostname))) return Promise.resolve(true);
    let p = seen.get(hostname);
    if (!p) {
      p = new Promise<boolean>(resolve => guardedLookup(hostname, { all: true }, err => resolve(!err)));
      seen.set(hostname, p);
    }
    return p;
  };
}

/**
 * Renders the given pages (and, with followLinks, the site's relevant pages found on them) and returns
 * their HTML after the page settled. Pages that fail or are refused come back with status 0.
 */
export async function renderPages(urls: string[], opts: RenderOptions = {}): Promise<RenderedPage[]> {
  if (!urls.length) return [];
  const out: RenderedPage[] = [];
  const maxPages = Math.max(1, opts.maxPages ?? urls.length);
  const config = memoryConfig();
  const queue = await RequestQueue.open(`render-${randomUUID()}`, { config });
  const first = new URL(urls[0]);
  const host = first.hostname.replace(/^www\./, '');
  const executablePath = process.env.CRAWL_CHROMIUM_PATH || undefined;
  const publicHost = hostGuard();
  // Direct connections only, like the HTTP crawler (no ambient proxy: the SSRF check applies to the
  // address the browser really connects to). Test fixtures live on the reserved .test TLD and resolve
  // to loopback, as in safeFetch's test lookup.
  const args = ['--no-proxy-server', ...(ALLOW_PRIVATE ? ['--host-resolver-rules=MAP *.test 127.0.0.1'] : [])];

  const crawler = new PlaywrightCrawler(
    {
      requestQueue: queue,
      maxRequestsPerCrawl: maxPages,
      maxConcurrency: 1,
      maxRequestRetries: 0,
      navigationTimeoutSecs: Math.ceil((opts.timeoutMs ?? 25_000) / 1000),
      requestHandlerTimeoutSecs: 60,
      useSessionPool: false,
      persistCookiesPerSession: false,
      launchContext: { launcher: directLauncher, launchOptions: { headless: true, executablePath, args }, userAgent: UA },
      browserPoolOptions: { useFingerprints: false },
      preNavigationHooks: [
        async ({ page, request }) => {
          const u = checkUrl(request.url, ALLOW_PRIVATE);
          if (!(await publicHost(u.hostname))) throw new Error(`unsafe_address ${u.hostname}`);
          await page.route('**/*', async (r: Route) => {
            const t = r.request().resourceType();
            if (['image', 'media', 'font'].includes(t)) return r.abort();
            try {
              const target = checkUrl(r.request().url(), ALLOW_PRIVATE);
              if (!(await publicHost(target.hostname))) return r.abort();
            } catch {
              return r.abort();
            }
            return r.continue();
          });
        },
      ],
      async requestHandler({ page, request, response, crawler: c }) {
        await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => {});
        const html = await page.content();
        const finalUrl = page.url();
        out.push({ url: request.url, finalUrl, status: response?.status() ?? 0, html });
        if (opts.followLinks && out.length < maxPages) {
          const facts = extractPage(html, finalUrl, host);
          const rank = (l: string) => (/צור|צרו|קשר|contact/i.test(l) ? 0 : BRANCHES_LINK.test(l) ? 1 : /מחיר|price/i.test(l) ? 2 : FOLLOW.test(l) ? 3 : 4);
          const next = [...facts.links, ...facts.menuLinks].filter((l, i, arr) => arr.indexOf(l) === i && !urls.includes(l)).sort((a, b) => rank(a) - rank(b)).slice(0, maxPages * 2);
          await c.addRequests(next.map(url => ({ url, uniqueKey: url })));
        }
      },
      failedRequestHandler({ request }) {
        out.push({ url: request.url, finalUrl: request.url, status: 0, html: '' });
      },
    },
    config,
  );
  try {
    await crawler.addRequests(urls.map(url => ({ url, uniqueKey: url })));
    await crawler.run();
  } finally {
    await queue.drop().catch(() => {});
  }
  return out;
}

/** One page rendered, or null when the browser is unavailable or the page failed. */
export async function renderPage(url: string): Promise<RenderedPage | null> {
  if (!browserAvailable()) return null;
  const [page] = await renderPages([url], { maxPages: 1 }).catch(() => [] as RenderedPage[]);
  return page && page.status > 0 && page.html ? page : null;
}
