// Reads a business's own website: the home page plus up to a few contact, price and treatment
// pages on the same host. Respects robots.txt, waits between requests and keeps only text.
//
// Getting through, in this order:
//   1. a plain request with ordinary browser headers (through CRAWL_PROXY when it is set, for example
//      an Israeli proxy, since some Israeli sites refuse visitors from abroad);
//   2. when that is blocked or the page is built by JavaScript (Wix, React and the like), a real
//      headless Chromium renders the page, through the same proxy.
// Public social profiles (Facebook, Instagram) are read only with CRAWL_SOCIAL=1, and never logged in.

import type { Browser } from 'playwright-core';
import { ProxyAgent, type Dispatcher } from 'undici';
import { extractEmails } from '../../src/lib/import/email';
import { findPhones, normalizeIlPhone } from '../../src/lib/import/phone';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.7,en;q=0.6',
};
const MAX_PAGES = 7;
const MAX_BYTES = 2_000_000;
const PAGE_TEXT = 8_000; // characters kept per page for extraction
const TOTAL_TEXT = 24_000; // all pages together, keeps each Claude call small
const PAUSE_MS = 700;

// Profiles on these hosts are not the business's own site.
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|tiktok\.com|wa\.me|whatsapp\.com)$/i;
const FOLLOW = /(contact|about|price|pricing|menu|service|treat|צור|צרו|קשר|אודות|מחיר|מחירון|טיפול|שירות|תפריט)/i;
const GUESS = ['/contact', '/contact-us', '/צור-קשר', '/about', '/אודות'];
const BLOCKED_STATUS = new Set([401, 403, 406, 429, 451, 503]);

export interface CrawlResult {
  pages: Array<{ url: string; status: number | string; via?: 'fetch' | 'browser' }>;
  emails: string[];
  phones: string[];
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
  text: string; // for extraction, "## url\n..." per page
  skipped?: 'social' | 'robots' | 'unreachable' | 'no_website' | 'blocked';
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------- proxy and browser ----------

const proxyUrl = process.env.CRAWL_PROXY?.trim() || null;
const dispatcher: Dispatcher | undefined = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

let browserP: Promise<Browser | null> | null = null;
/** One shared headless Chromium, started on first need. Null when it cannot start (logged once). */
function browser(): Promise<Browser | null> {
  browserP ??= (async () => {
    try {
      const { chromium } = await import('playwright-core');
      const proxy = proxyUrl ? (() => {
        const u = new URL(proxyUrl);
        return { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username) || undefined, password: decodeURIComponent(u.password) || undefined };
      })() : undefined;
      return await chromium.launch({ headless: true, executablePath: process.env.CRAWL_CHROMIUM_PATH || undefined, proxy });
    } catch (e) {
      console.warn('[crawl] headless browser unavailable, plain requests only:', e instanceof Error ? e.message.split('\n')[0] : e);
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

type Got = { status: number; html: string; finalUrl: string; via: 'fetch' | 'browser' } | { error: string };

async function fetchPage(url: string, anyText = false): Promise<Got> {
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      // @ts-expect-error undici dispatcher on Node's fetch
      dispatcher,
    });
    const type = res.headers.get('content-type') ?? '';
    if (!anyText && !/text\/html|application\/xhtml/i.test(type)) return { status: res.status, html: '', finalUrl: res.url, via: 'fetch' };
    const buf = await res.arrayBuffer();
    const html = new TextDecoder('utf-8').decode(buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf);
    return { status: res.status, html, finalUrl: res.url, via: 'fetch' };
  } catch (e) {
    return { error: e instanceof Error ? `${e.name}: ${(e.cause as Error | undefined)?.message ?? e.message}`.slice(0, 160) : 'fetch_failed' };
  }
}

async function renderPage(url: string): Promise<Got> {
  const b = await browser();
  if (!b) return { error: 'no_browser' };
  const ctx = await b.newContext({ userAgent: UA, locale: 'he-IL', timezoneId: 'Asia/Jerusalem', extraHTTPHeaders: { 'Accept-Language': HEADERS['Accept-Language'] } });
  try {
    const page = await ctx.newPage();
    // Text only: skip images, media and fonts.
    await page.route('**/*', r => (['image', 'media', 'font'].includes(r.request().resourceType()) ? r.abort() : r.continue()));
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    // Cloudflare-style checks resolve on their own after a few seconds.
    if (/just a moment|checking your browser|אנא המתן/i.test(await page.title())) await page.waitForTimeout(6_000);
    return { status: res?.status() ?? 200, html: await page.content(), finalUrl: page.url(), via: 'browser' };
  } catch (e) {
    return { error: e instanceof Error ? e.message.split('\n')[0].slice(0, 160) : 'render_failed' };
  } finally {
    await ctx.close().catch(() => {});
  }
}

const textLength = (html: string) => htmlToText(html).length;
const looksBlocked = (g: Got) =>
  'error' in g || BLOCKED_STATUS.has(g.status) || /cf-chl|challenge-platform|captcha|access denied|request blocked/i.test(g.html.slice(0, 20_000));
// Built in the browser: little text in the HTML but app scripts (Wix, React, Next, Vue...).
const looksScripted = (g: Got) => !('error' in g) && g.status < 400 && textLength(g.html) < 600 && /<script/i.test(g.html);

/** Plain request first; a real browser when that is blocked or the page is built by scripts. */
async function get(url: string): Promise<Got> {
  const first = await fetchPage(url);
  if (!looksBlocked(first) && !looksScripted(first)) return first;
  const second = await renderPage(url);
  if ('error' in second) return first;
  return second;
}

// ---------- parsing ----------

/** Disallowed path prefixes from robots.txt for all crawlers. */
async function robots(origin: string): Promise<string[]> {
  const r = await fetchPage(`${origin}/robots.txt`, true);
  if ('error' in r || r.status >= 400) return [];
  const rules: string[] = [];
  let applies = false;
  let inAgents = false;
  for (const line of r.html.split(/\r?\n/)) {
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
}

const allowed = (path: string, rules: string[]) => !rules.some(r => path.startsWith(r.replace(/\*.*$/, '')));

function htmlToText(html: string): string {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '';
  const desc = html.match(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? '';
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/span)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return [title, desc, body].filter(Boolean).join('\n');
}

function jsonLd(html: string): { emails: string[]; phones: string[] } {
  const emails: string[] = [];
  const phones: string[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (k === 'email' && typeof x === 'string') emails.push(x);
          else if (k === 'telephone' && typeof x === 'string') phones.push(x);
          else walk(x);
        }
      }
    };
    try {
      walk(JSON.parse(m[1]));
    } catch {
      /* broken JSON-LD is common, ignore it */
    }
  }
  return { emails, phones };
}

function links(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const u = new URL(m[1], base);
      const label = m[2].replace(/<[^>]+>/g, ' ');
      let path = u.pathname;
      try {
        path = decodeURIComponent(path);
      } catch {
        /* keep encoded */
      }
      if (FOLLOW.test(path) || FOLLOW.test(label)) out.push(u.toString().split('#')[0]);
    } catch {
      /* bad href */
    }
  }
  return out;
}

function social(html: string) {
  const ig = html.match(/https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]{2,30})\/?["'?]/)?.[1];
  const fb = html.match(/https?:\/\/(?:www\.|he-il\.|m\.)?facebook\.com\/([A-Za-z0-9_.\-/%]{2,80}?)\/?["'?]/)?.[1];
  const wa = html.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=|whatsapp:\/\/send\?phone=)(\+?\d{9,14})/)?.[1];
  const skipIg = new Set(['p', 'explore', 'accounts', 'reel', 'reels', 'stories']);
  return {
    instagram: ig && !skipIg.has(ig) ? `https://www.instagram.com/${ig}` : null,
    facebook: fb && !/^(sharer|share|plugins|tr|dialog|login)/.test(fb) ? `https://www.facebook.com/${fb}` : null,
    whatsapp: wa ? normalizeIlPhone(wa) : null,
  };
}

interface Harvest {
  emails: Set<string>;
  phones: Set<string>;
  seenLines: Set<string>;
}

/** Contacts from one page into the harvest; returns the page text minus lines already seen (menus, footers). */
function harvest(h: Harvest, html: string): string {
  for (const e of extractEmails(html)) h.emails.add(e);
  const ld = jsonLd(html);
  for (const e of ld.emails) for (const x of extractEmails(`mailto:${e}`)) h.emails.add(x);
  for (const p of ld.phones) {
    const n = normalizeIlPhone(p);
    if (n) h.phones.add(n);
  }
  for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi)) {
    const n = normalizeIlPhone(m[1]);
    if (n) h.phones.add(n);
  }
  const text = htmlToText(html);
  for (const p of findPhones(text)) h.phones.add(p);
  const fresh = text.split('\n').filter(l => {
    const k = l.trim();
    if (!k || h.seenLines.has(k)) return false;
    h.seenLines.add(k);
    return true;
  });
  return fresh.join('\n');
}

// ---------- entry points ----------

export async function crawlSite(website: string | null | undefined): Promise<CrawlResult> {
  const empty: CrawlResult = { pages: [], emails: [], phones: [], whatsapp: null, instagram: null, facebook: null, text: '' };
  if (!website) return { ...empty, skipped: 'no_website' };
  let start: URL;
  try {
    start = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
  } catch {
    return { ...empty, skipped: 'unreachable' };
  }
  const host = start.hostname.replace(/^www\./, '');
  if (SOCIAL.test(host)) {
    const r = { ...empty, skipped: 'social' as const };
    if (/instagram\.com$/i.test(host)) r.instagram = start.toString().split('?')[0];
    if (/facebook\.com$|fb\.com$|fb\.me$/i.test(host)) r.facebook = start.toString().split('?')[0];
    return r;
  }

  const rules = await robots(start.origin);
  if (!allowed(start.pathname || '/', rules)) return { ...empty, skipped: 'robots' };

  const res: CrawlResult = { ...empty };
  const h: Harvest = { emails: new Set(), phones: new Set(), seenLines: new Set() };
  const queue = [start.toString()];
  const seen = new Set<string>();
  const texts: string[] = [];
  let siteHost = host; // follows a redirect to the real domain (bit.ly, linktree, www)
  let total = 0;

  while (queue.length && res.pages.length < MAX_PAGES) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const u = new URL(url);
    if (res.pages.length && u.hostname.replace(/^www\./, '') !== siteHost) continue;
    if (!allowed(u.pathname, rules)) continue;
    if (res.pages.length) await sleep(PAUSE_MS);
    const r = await get(url);
    if ('error' in r) {
      res.pages.push({ url, status: r.error });
      if (res.pages.length === 1) return { ...res, skipped: 'unreachable' };
      continue;
    }
    res.pages.push({ url, status: r.status, via: r.via });
    if (r.status >= 400 || !r.html) {
      if (res.pages.length === 1) return { ...res, skipped: BLOCKED_STATUS.has(r.status) ? 'blocked' : 'unreachable' };
      continue;
    }

    const text = harvest(h, r.html);
    const s = social(r.html);
    res.instagram ??= s.instagram;
    res.facebook ??= s.facebook;
    res.whatsapp ??= s.whatsapp;
    if (total < TOTAL_TEXT && text) {
      const piece = text.slice(0, Math.min(PAGE_TEXT, TOTAL_TEXT - total));
      texts.push(`## ${r.finalUrl}\n${piece}`);
      total += piece.length;
    }

    if (res.pages.length === 1) {
      siteHost = new URL(r.finalUrl).hostname.replace(/^www\./, '');
      const found = links(r.html, r.finalUrl);
      for (const l of found) if (!seen.has(l)) queue.push(l);
      // No contact links in the markup (menus built by scripts): try the usual addresses.
      if (!found.length) for (const g of GUESS) queue.push(new URL(g, r.finalUrl).toString());
    }
  }

  res.emails = [...h.emails];
  res.phones = [...h.phones];
  res.text = texts.join('\n\n');
  return res;
}

/**
 * A public Facebook page or Instagram profile, read without logging in (only with CRAWL_SOCIAL=1).
 * Pages behind a login wall simply give nothing. Returns contacts and the visible text.
 */
export async function crawlSocial(url: string): Promise<{ emails: string[]; phones: string[]; text: string; status: string }> {
  const none = { emails: [], phones: [], text: '' };
  if (process.env.CRAWL_SOCIAL !== '1') return { ...none, status: 'disabled' };
  let target = url;
  // The "about" tab of a Facebook page holds the contact details.
  if (/facebook\.com\/(?!profile\.php)[^/?]+\/?$/i.test(url)) target = url.replace(/\/?$/, '/about');
  const r = await renderPage(target);
  if ('error' in r) return { ...none, status: r.error };
  if (r.status >= 400) return { ...none, status: String(r.status) };
  const h: Harvest = { emails: new Set(), phones: new Set(), seenLines: new Set() };
  const text = harvest(h, r.html);
  if (/log in to|התחבר(ו)? ל|login_form/i.test(text.slice(0, 400)) && !h.emails.size && !h.phones.size) return { ...none, status: 'login_wall' };
  return { emails: [...h.emails], phones: [...h.phones], text: text.slice(0, 4_000), status: 'ok' };
}
