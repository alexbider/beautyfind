// Stage 2A: reads a business's official website cheaply.
//
// - Ordinary HTTP requests through safeFetch (SSRF-safe, size and time limits, manual redirects).
// - Identifies itself as BeautyFindBot and follows robots.txt. An explicit block (401/403/429/451,
//   a challenge page) stops the crawl for that site: no proxies, no challenge bypass.
// - Homepage plus relevant same-site pages (contact, about, services, prices, team, branches, gallery,
//   videos), found through same-site links and one bounded look at the sitemap. Progressive budget: the
//   first `maxPages` (five) relevant pages, extended once to `maxPagesExtended` (twelve) only while
//   template fields the profile needs are still missing; stops as soon as they are complete.
// - Conditional requests (ETag / Last-Modified) and a content hash avoid re-reading unchanged pages.
// - A headless browser is an optional, capped fallback only for pages whose content needs JavaScript.

import { createHash } from 'node:crypto';
import type { Browser } from 'playwright-core';
import { checkUrl, safeFetch, UnsafeUrlError } from '../../src/lib/import/safeFetch';
import { extractPage, FOLLOW, type PageFacts } from '../../src/lib/import/siteExtract';

const UA = 'BeautyFindBot/1.0 (+https://beautyfind.co.il/bot; business directory listing check)';
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

let browserP: Promise<Browser | null> | null = null;
function browser(): Promise<Browser | null> {
  browserP ??= (async () => {
    try {
      const { chromium } = await import('playwright-core');
      return await chromium.launch({ headless: true, executablePath: process.env.CRAWL_CHROMIUM_PATH || undefined });
    } catch (e) {
      console.warn('[crawl] headless browser unavailable:', e instanceof Error ? e.message.split('\n')[0] : e);
      return null;
    }
  })();
  return browserP;
}
export async function closeBrowser() {
  const b = browserP ? await browserP : null;
  browserP = null;
  await b?.close().catch(() => {});
}

/** Renders one page; used only when allowed and the plain HTML has no usable content. */
async function render(url: string): Promise<{ status: number; html: string; url: string } | null> {
  checkUrl(url, ALLOW_PRIVATE);
  const b = await browser();
  if (!b) return null;
  const ctx = await b.newContext({ userAgent: UA, locale: 'he-IL' });
  try {
    const page = await ctx.newPage();
    // Every request the page makes is checked too; images, media and fonts are not loaded.
    await page.route('**/*', r => {
      const t = r.request().resourceType();
      if (['image', 'media', 'font'].includes(t)) return r.abort();
      try {
        checkUrl(r.request().url(), ALLOW_PRIVATE);
      } catch {
        return r.abort();
      }
      return r.continue();
    });
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => {});
    return { status: res?.status() ?? 0, html: await page.content(), url: page.url() };
  } catch {
    return null;
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function robots(origin: string): Promise<string[] | null> {
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
const allowedBy = (path: string, rules: string[]) => !rules.some(r => r === '/' ? true : path.startsWith(r.replace(/\*.*$/, '')));

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
  const queue: Array<{ url: string; depth: number }> = [{ url: start.toString(), depth: 0 }];
  const seen = new Set<string>();
  const hash = createHash('sha256');
  let anyChanged = false;

  while (queue.length && out.pages.length < cap) {
    const { url, depth } = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const u = new URL(url);
    if (out.pages.length && u.hostname.replace(/^www\./, '') !== host) continue;
    if (rules && !allowedBy(u.pathname, rules)) continue;
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
      if (out.pages.length === 1) return { ...out, status: e instanceof UnsafeUrlError || /EUNSAFE|unsafe_address/.test(msg) ? 'unsafe' : 'failed', error: msg };
      continue;
    }
    if (res.status === 304) {
      out.pages.push({ url, status: 304, via: 'cache', depth });
      out.validators[url] = prior!;
      continue;
    }
    if (BLOCKED.has(res.status) || looksChallenge(res.body)) {
      out.pages.push({ url, status: res.status, via: 'fetch', depth });
      if (out.pages.length === 1) return { ...out, status: 'blocked' };
      continue;
    }
    out.pages.push({ url, status: res.status, via: 'fetch', depth });
    if (res.status >= 400 || !res.body) {
      if (out.pages.length === 1) return { ...out, status: 'failed', error: `http_${res.status}` };
      continue;
    }
    if (out.pages.length === 1) host = new URL(res.url).hostname.replace(/^www\./, '');

    let html = res.body;
    let finalUrl = res.url;
    let facts = extractPage(html, finalUrl, host);
    if (looksScripted(facts, html) && opts.browserAllowed()) {
      const r = await render(finalUrl);
      if (r && r.status < 400) {
        html = r.html;
        finalUrl = r.url;
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
      for (const l of extra) if (!seen.has(l)) queue.push({ url: l, depth: 1 });
    }

    // Stop as soon as the template's fields are covered; extend the budget once while they are not.
    const missing = needMore(out.facts);
    if (missing.length === 0 && out.pages.length >= 2) break;
    if (out.pages.length >= cap && opts.maxPagesExtended && opts.maxPagesExtended > cap && missing.length) {
      cap = opts.maxPagesExtended;
      out.extended = true;
    }

    if (depth < 2) {
      // Contact first, then prices and services, then gallery, then the rest.
      const rank = (l: string) => {
        const d = decodeURIComponentSafe(l);
        return /צור|צרו|קשר|contact/i.test(d) ? 0 : /מחיר|price|pricing/i.test(d) ? 1 : /טיפול|שירות|treat|service|menu/i.test(d) ? 2 : /גלריה|תמונות|gallery|portfolio|עבודות/i.test(d) ? 3 : /צוות|team|staff|רופאים|doctors/i.test(d) ? 4 : /אודות|about|עלינו|מי אנחנו/i.test(d) ? 5 : /סניפ|branch|סרטונים|video/i.test(d) ? 6 : 7;
      };
      const next = facts.links.filter(l => !seen.has(l)).sort((a, b) => rank(a) - rank(b));
      for (const l of next) queue.push({ url: l, depth: depth + 1 });
      queue.sort((a, b) => a.depth - b.depth || rank(a.url) - rank(b.url));
    }
  }

  out.contentHash = out.facts.length ? hash.digest('hex').slice(0, 32) : null;
  const allCached = out.pages.length > 0 && out.pages.every(p => p.via === 'cache');
  if (allCached || (!anyChanged && out.facts.length === 0 && out.pages.some(p => p.via === 'cache'))) return { ...out, status: 'not_modified' };
  out.status = out.facts.some(f => f.emails.length) ? 'ok' : 'no_email';
  return out;
}
