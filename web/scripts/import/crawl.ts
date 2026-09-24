// Reads a business's own website: the home page plus up to a few contact, price and treatment
// pages on the same host. Respects robots.txt, identifies itself, waits between requests and
// keeps only text. Nothing here stores images or copies page layout.

import { extractEmails } from '../../src/lib/import/email';
import { findPhones, normalizeIlPhone } from '../../src/lib/import/phone';

const UA = 'BeautyFindBot/1.0 (+https://beautyfind.co.il/bot; directory listing check)';
const MAX_PAGES = 6;
const MAX_BYTES = 1_500_000;
const PAGE_TEXT = 14_000; // characters kept per page for extraction
const PAUSE_MS = 800;

const SOCIAL = /(^|\.)(facebook\.com|fb\.com|instagram\.com|linktr\.ee|tiktok\.com|wa\.me|whatsapp\.com)$/i;
const FOLLOW = /(contact|about|price|pricing|menu|service|treat|צור|צרו|קשר|אודות|מחיר|מחירון|טיפול|שירות|תפריט)/i;

export interface CrawlResult {
  pages: Array<{ url: string; status: number | string }>;
  emails: string[];
  phones: string[];
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
  text: string; // for extraction, "## url\n..." per page
  skipped?: 'social' | 'robots' | 'unreachable' | 'no_website';
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function get(url: string, anyText = false): Promise<{ status: number; html: string; finalUrl: string } | { error: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'he,en;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    const type = res.headers.get('content-type') ?? '';
    if (!anyText && !/text\/html|application\/xhtml/i.test(type)) return { status: res.status, html: '', finalUrl: res.url };
    const buf = await res.arrayBuffer();
    const html = new TextDecoder('utf-8').decode(buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf);
    return { status: res.status, html, finalUrl: res.url };
  } catch (e) {
    return { error: e instanceof Error ? e.name + ': ' + e.message.slice(0, 120) : 'fetch_failed' };
  }
}

/** Disallowed path prefixes for us from robots.txt (groups for * and BeautyFindBot). */
async function robots(origin: string): Promise<string[]> {
  const r = await get(`${origin}/robots.txt`, true);
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
      if (val === '*' || /beautyfindbot/i.test(val)) applies = true;
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
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? '';
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
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
      if (FOLLOW.test(decodeURIComponent(u.pathname)) || FOLLOW.test(label)) out.push(u.toString().split('#')[0]);
    } catch {
      /* bad href */
    }
  }
  return out;
}

function social(html: string) {
  const ig = html.match(/https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]{2,30})\/?["'?]/)?.[1];
  const fb = html.match(/https?:\/\/(?:www\.|he-il\.)?facebook\.com\/([A-Za-z0-9_.\-/%]{2,80}?)\/?["'?]/)?.[1];
  const wa = html.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=|whatsapp:\/\/send\?phone=)(\+?\d{9,14})/)?.[1];
  const skipIg = new Set(['p', 'explore', 'accounts', 'reel', 'stories']);
  return {
    instagram: ig && !skipIg.has(ig) ? `https://www.instagram.com/${ig}` : null,
    facebook: fb && !/^(sharer|share|plugins|tr|dialog)/.test(fb) ? `https://www.facebook.com/${fb}` : null,
    whatsapp: wa ? normalizeIlPhone(wa) : null,
  };
}

export async function crawlSite(website: string | null | undefined): Promise<CrawlResult> {
  const empty: CrawlResult = { pages: [], emails: [], phones: [], whatsapp: null, instagram: null, facebook: null, text: '' };
  if (!website) return { ...empty, skipped: 'no_website' };
  let start: URL;
  try {
    start = new URL(website);
  } catch {
    return { ...empty, skipped: 'unreachable' };
  }
  const host = start.hostname.replace(/^www\./, '');
  if (SOCIAL.test(host)) {
    const r = { ...empty, skipped: 'social' as const };
    if (/instagram\.com$/i.test(host)) r.instagram = website.split('?')[0];
    if (/facebook\.com$|fb\.com$/i.test(host)) r.facebook = website.split('?')[0];
    return r;
  }

  const rules = await robots(start.origin);
  if (!allowed(start.pathname || '/', rules)) return { ...empty, skipped: 'robots' };

  const res: CrawlResult = { ...empty };
  const emails = new Set<string>();
  const phones = new Set<string>();
  const queue = [start.toString()];
  const seen = new Set<string>();
  const texts: string[] = [];

  while (queue.length && res.pages.length < MAX_PAGES) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, '') !== host || !allowed(u.pathname, rules)) continue;
    if (res.pages.length) await sleep(PAUSE_MS);
    const r = await get(url);
    if ('error' in r) {
      res.pages.push({ url, status: r.error });
      if (res.pages.length === 1) return { ...res, skipped: 'unreachable' };
      continue;
    }
    res.pages.push({ url, status: r.status });
    if (r.status >= 400 || !r.html) continue;

    for (const e of extractEmails(r.html)) emails.add(e);
    const ld = jsonLd(r.html);
    for (const e of ld.emails) for (const x of extractEmails(`mailto:${e}`)) emails.add(x);
    for (const p of ld.phones) {
      const n = normalizeIlPhone(p);
      if (n) phones.add(n);
    }
    for (const m of r.html.matchAll(/href=["']tel:([^"']+)["']/gi)) {
      const n = normalizeIlPhone(m[1]);
      if (n) phones.add(n);
    }
    const text = htmlToText(r.html);
    for (const p of findPhones(text)) phones.add(p);
    const s = social(r.html);
    res.instagram ??= s.instagram;
    res.facebook ??= s.facebook;
    res.whatsapp ??= s.whatsapp;
    texts.push(`## ${url}\n${text.slice(0, PAGE_TEXT)}`);
    if (res.pages.length === 1) for (const l of links(r.html, r.finalUrl)) if (!seen.has(l)) queue.push(l);
  }

  res.emails = [...emails];
  res.phones = [...phones];
  res.text = texts.join('\n\n');
  return res;
}
