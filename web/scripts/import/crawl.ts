// Stage 2A: reads a business's official website cheaply, self-hosted on Crawlee.
//
// - Crawlee's BasicCrawler drives the queue (priority, retries, per-site pacing); every request still
//   goes through safeFetch (SSRF-safe DNS pinning, size and time limits, manual redirects).
// - Identifies itself as BeautyFindBot and follows robots.txt. An explicit block (401/403/429/451,
//   a challenge page) stops the crawl for that site: no proxies, no challenge bypass.
// - Homepage plus relevant same-site pages (contact, branches, about, services, prices, team, gallery,
//   videos) found through the site's menu, same-site links and one bounded look at the sitemap.
//   Progressive budget: the first `maxPages` (five) relevant pages, extended once to `maxPagesExtended`
//   (twelve) only while template fields the profile needs are still missing; stops when complete.
// - Conditional requests (ETag / Last-Modified) and a content hash avoid re-reading unchanged pages.
// - Playwright (Crawlee's PlaywrightCrawler on the worker's own Chromium) is the fallback for pages
//   whose content needs JavaScript, capped per run; crawlee/browser.ts.

import { createHash, randomUUID } from 'node:crypto';
import { BasicCrawler, RequestQueue } from 'crawlee';
import { checkUrl, safeFetch, UnsafeUrlError } from '../../src/lib/import/safeFetch';
import { extractPage, FOLLOW, type PageFacts } from '../../src/lib/import/siteExtract';
import { BRANCHES_LINK } from '../../src/lib/import/locations';
import { browserAvailable, memoryConfig, renderPage, UA } from './crawlee/browser';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'he-IL,he;q=0.9,en;q=0.6' };
const BLOCKED = new Set([401, 403, 429, 451]);
const PAUSE_MS = Number(process.env.IMPORT_CRAWL_PAUSE_MS ?? 700); // politeness delay between pages of one site
const ALLOW_PRIVATE = process.env.IMPORT_TEST_ALLOW_PRIVATE === '1'; // local fixtures only

export type SiteStatus = 'ok' | 'no_email' | 'blocked' | 'robots' | 'failed' | 'unsafe' | 'not_modified';

export interface Validators {
  [url: string]: { etag?: string; lastModified?: string; hash?: string };
}

export interface CrawlOutcome {
  status: SiteStatus;
  pages: Array<{ url: string; status: number | string; via: 'fetch' | 'browser' | 'cache'; depth: number }>;
  sitemapUrls?: number; // same-site URLs taken from the sitemap (0 when none was read)
  extended?: boolean; // the page budget was raised because template fields were still missing
  facts: PageFacts[];
  validators: Validators;
  contentHash: string | null;
  browserUsed: number;
  error?: string;
}

const decodeURIComponentSafe = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Kept for the worker's shutdown: Crawlee closes its browsers after every render, nothing stays open. */
export async function closeBrowser() {}

/** Disallow rules that apply to us from the site's robots.txt (empty when none or unreadable). */
export async function robots(origin: string): Promise<string[] | null> {
  try {
    const r = await safeFetch(`${origin}/robots.txt`, { headers: HEADERS, maxBytes: 200_000, timeoutMs: 10_000, allowPrivate: ALLOW_PRIVATE });
    if (r.status >= 400) return [];
    const rules: string[] = [];
    let applies = false;
    let inAgents = false;
    for (const line of r.body.split(/\r?\n/)) {
      const [k, ...rest] = line.replace(/#.*/, '').split(':');
      const key = k.trim().toLowerCase();
      const val = rest.join(':').trim();
      if (key === 'user-agent') {
        if (!inAgents) applies = false;
        inAgents = true;
        if (val === '*' || /beautyfind/i.test(val)) applies = true;
      } else if (key) {
        inAgents = false;
        if (applies && key === 'disallow' && val) rules.push(val);
      }
    }
    return rules;
  } catch {
    return [];
  }
}
export const allowedBy = (path: string, rules: string[]) => !rules.some(r => r === '/' ? true : path.startsWith(r.replace(/\*.*$/, '')));

const looksChallenge = (html: string) => /cf-chl|challenge-platform|captcha|access denied|request blocked/i.test(html.slice(0, 20_000));
const looksScripted = (facts: PageFacts, html: string) => facts.text.length < 400 && /<script/i.test(html);

export interface CrawlOptions {
  maxPages: number;
  /** Raised to this many pages only while `needMore` still says template fields are missing. */
  maxPagesExtended?: number;
  /** Which profile fields are still missing after the pages read so far. Empty = stop reading. */
  needMore?: (facts: PageFacts[]) => string[];
  browserAllowed: () => boolean; // asks the run whether one more rendered page is within its cap
  prior?: Validators;
  sitemap?: boolean; // default true
}

/** What the profile template still lacks, given the pages read so far. Contact and prices first. */
export function missingTemplateFields(facts: PageFacts[]): string[] {
  const miss: string[] = [];
  if (!facts.some(f => f.phones.length)) miss.push('phone');
  if (!facts.some(f => f.emails.length)) miss.push('email');
  if (!facts.some(f => f.hours)) miss.push('hours');
  const services = new Set(facts.flatMap(f => f.services.map(x => x.value.name)));
  if (services.size < 3) miss.push('services');
  if (!facts.some(f => f.services.some(x => x.value.priceNis != null))) miss.push('prices');
  if (new Set(facts.flatMap(f => f.photos.map(x => x.value))).size < 5) miss.push('gallery');
  if (!facts.some(f => f.team.length)) miss.push('team');
  if (!facts.some(f => f.description)) miss.push('description');
  // A videos page is worth one more request only when the site has one and no video was seen yet.
  if (!facts.some(f => f.videos.length) && facts.some(f => f.links.some(l => /video|סרטונים|וידאו/i.test(decodeURIComponentSafe(l))))) miss.push('videos');
  // A chain: the site links to a branches page and no page read so far lists its locations. The record is
  // one branch, so its own address, phone and hours live on that page, not on the homepage.
  const branchesLinked = facts.some(f => [...f.links, ...f.menuLinks].some(l => BRANCHES_LINK.test(decodeURIComponentSafe(l))));
  if (branchesLinked && !facts.some(f => f.locations.length >= 2)) miss.push('locations');
  return miss;
}

const SITEMAP_MAX_BYTES = 400_000;
/** Same-site URLs from /sitemap.xml (or the first child of a sitemap index) that look like profile pages. Bounded, one or two requests. */
async function sitemapUrls(origin: string, host: string): Promise<string[]> {
  const read = async (url: string) => {
    try {
      const r = await safeFetch(url, { headers: { ...HEADERS, Accept: 'application/xml,text/xml' }, maxBytes: SITEMAP_MAX_BYTES, timeoutMs: 10_000, allowPrivate: ALLOW_PRIVATE });
      return r.status === 200 ? r.body : '';
    } catch {
      return '';
    }
  };
  let xml = await read(`${origin}/sitemap.xml`);
  if (!xml) return [];
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]);
  // A sitemap index: read the first child that is not a post/news/product sitemap.
  if (/<sitemapindex/i.test(xml)) {
    const child = locs.find(l => !/post|news|blog|product|tag|category|image|video/i.test(l)) ?? locs[0];
    xml = child ? await read(child) : '';
    if (!xml) return [];
  }
  const out: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    try {
      const u = new URL(m[1]);
      if (u.hostname.replace(/^www\./, '') !== host) continue;
      const path = decodeURIComponentSafe(u.pathname);
      if (FOLLOW.test(path) && !/blog|post|news|tag\/|category\/|product/i.test(path)) out.push(u.toString().split('#')[0]);
    } catch {
      /* bad loc */
    }
    if (out.length >= 30) break;
  }
  return out;
}

export async function crawlSite(website: string, opts: CrawlOptions): Promise<CrawlOutcome> {
  const out: CrawlOutcome = { status: 'failed', pages: [], facts: [], validators: {}, contentHash: null, browserUsed: 0, sitemapUrls: 0, extended: false };
  const needMore = opts.needMore ?? missingTemplateFields;
  let cap = opts.maxPages;
  let start: URL;
  try {
    start = checkUrl(/^https?:\/\//i.test(website) ? website : `https://${website}`, ALLOW_PRIVATE);
  } catch (e) {
    return { ...out, status: 'unsafe', error: e instanceof Error ? e.message : 'bad_url' };
  }
  const rules = await robots(start.origin);
  if (rules && !allowedBy(start.pathname || '/', rules)) return { ...out, status: 'robots' };

  let host = start.hostname.replace(/^www\./, '');
  const hash = createHash('sha256');
  let anyChanged = false;
  let stop = false;

  // Contact and branches first, then prices and services, then gallery, then the rest.
  const rank = (l: string) => {
    const d = decodeURIComponentSafe(l);
    return /צור|צרו|קשר|contact/i.test(d) ? 0 : BRANCHES_LINK.test(d) ? 0.5 : /מחיר|price|pricing/i.test(d) ? 1 : /טיפול|שירות|treat|service|menu/i.test(d) ? 2 : /גלריה|תמונות|gallery|portfolio|עבודות/i.test(d) ? 3 : /צוות|team|staff|רופאים|doctors/i.test(d) ? 4 : /אודות|about|עלינו|מי אנחנו/i.test(d) ? 5 : /סרטונים|video/i.test(d) ? 6 : FOLLOW.test(d) ? 7 : 8;
  };

  const config = memoryConfig();
  const queue = await RequestQueue.open(`site-${randomUUID()}`, { config });
  const crawler = new BasicCrawler(
    {
      requestQueue: queue,
      maxConcurrency: 1,
      maxRequestRetries: 0,
      requestHandlerTimeoutSecs: 90,
      useSessionPool: false,
      async requestHandler({ request, crawler: c }) {
        if (stop || out.pages.length >= cap) return;
        const url = request.url;
        const depth = (request.userData as { depth?: number }).depth ?? 0;
        const u = new URL(url);
        if (out.pages.length && u.hostname.replace(/^www\./, '') !== host) return;
        if (rules && !allowedBy(u.pathname, rules)) return;
        if (out.pages.length) await sleep(PAUSE_MS);

        const prior = opts.prior?.[url];
        const headers: Record<string, string> = { ...HEADERS };
        if (prior?.etag) headers['If-None-Match'] = prior.etag;
        if (prior?.lastModified) headers['If-Modified-Since'] = prior.lastModified;

        let res;
        try {
          res = await safeFetch(url, { headers, maxBytes: 1_500_000, timeoutMs: 15_000, allowPrivate: ALLOW_PRIVATE });
        } catch (e) {
          const msg = e instanceof UnsafeUrlError ? `unsafe:${e.message}` : e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 160) : 'fetch_failed';
          out.pages.push({ url, status: msg, via: 'fetch', depth });
          if (out.pages.length === 1) {
            out.status = e instanceof UnsafeUrlError || /EUNSAFE|unsafe_address/.test(msg) ? 'unsafe' : 'failed';
            out.error = msg;
            stop = true;
            await c.autoscaledPool?.abort();
          }
          return;
        }
        if (res.status === 304) {
          out.pages.push({ url, status: 304, via: 'cache', depth });
          out.validators[url] = prior!;
          return;
        }
        if (BLOCKED.has(res.status) || looksChallenge(res.body)) {
          out.pages.push({ url, status: res.status, via: 'fetch', depth });
          if (out.pages.length === 1) {
            out.status = 'blocked';
            stop = true;
            await c.autoscaledPool?.abort();
          }
          return;
        }
        out.pages.push({ url, status: res.status, via: 'fetch', depth });
        if (res.status >= 400 || !res.body) {
          if (out.pages.length === 1) {
            out.status = 'failed';
            out.error = `http_${res.status}`;
            stop = true;
            await c.autoscaledPool?.abort();
          }
          return;
        }
        if (out.pages.length === 1) host = new URL(res.url).hostname.replace(/^www\./, '');

        let html = res.body;
        let finalUrl = res.url;
        let facts = extractPage(html, finalUrl, host);
        if (looksScripted(facts, html) && browserAvailable() && opts.browserAllowed()) {
          const r = await renderPage(finalUrl);
          if (r && r.status < 400) {
            html = r.html;
            finalUrl = r.finalUrl;
            facts = extractPage(html, finalUrl, host);
            out.pages[out.pages.length - 1].via = 'browser';
            out.browserUsed++;
          }
        }
        const pageHash = createHash('sha256').update(facts.text).digest('hex').slice(0, 16);
        if (pageHash !== prior?.hash) anyChanged = true;
        hash.update(pageHash);
        out.validators[finalUrl] = { etag: res.headers.get('etag') ?? undefined, lastModified: res.headers.get('last-modified') ?? undefined, hash: pageHash };
        out.facts.push(facts);

        // After the homepage: the sitemap names the profile pages a menu may hide (team, prices, branches).
        if (out.pages.length === 1 && opts.sitemap !== false) {
          const extra = await sitemapUrls(new URL(finalUrl).origin, host);
          out.sitemapUrls = extra.length;
          await c.addRequests(extra.map(l => ({ url: l, uniqueKey: l, userData: { depth: 1 } })));
        }

        // Stop as soon as the template's fields are covered; extend the budget once while they are not.
        const missing = needMore(out.facts);
        if (missing.length === 0 && out.pages.length >= 2) {
          stop = true;
          await c.autoscaledPool?.abort();
          return;
        }
        if (out.pages.length >= cap && opts.maxPagesExtended && opts.maxPagesExtended > cap && missing.length) {
          cap = opts.maxPagesExtended;
          out.extended = true;
        }
        if (out.pages.length >= cap) {
          stop = true;
          await c.autoscaledPool?.abort();
          return;
        }

        if (depth < 2) {
          // The site's menu links join the queue too (one level down), so a section the menu names is never
          // missed; contact and branches pages go to the front of the queue.
          const next = [...facts.links, ...(depth === 0 ? facts.menuLinks : [])].filter((l, i, arr) => arr.indexOf(l) === i).sort((a, b) => rank(a) - rank(b));
          const front = next.filter(l => rank(l) <= 1);
          const back = next.filter(l => rank(l) > 1);
          await c.addRequests(back.map(l => ({ url: l, uniqueKey: l, userData: { depth: depth + 1 } })));
          await c.addRequests(front.map(l => ({ url: l, uniqueKey: l, userData: { depth: depth + 1 } })), { forefront: true });
        }
      },
    },
    config,
  );
  try {
    await crawler.addRequests([{ url: start.toString(), uniqueKey: start.toString(), userData: { depth: 0 } }]);
    await crawler.run();
  } finally {
    await queue.drop().catch(() => {});
  }
  if (stop && (out.status === 'unsafe' || out.status === 'blocked' || (out.status === 'failed' && out.error))) return out;

  out.contentHash = out.facts.length ? hash.digest('hex').slice(0, 32) : null;
  const allCached = out.pages.length > 0 && out.pages.every(p => p.via === 'cache');
  if (allCached || (!anyChanged && out.facts.length === 0 && out.pages.some(p => p.via === 'cache'))) return { ...out, status: 'not_modified' };
  out.status = out.facts.some(f => f.emails.length) ? 'ok' : 'no_email';
  return out;
}
