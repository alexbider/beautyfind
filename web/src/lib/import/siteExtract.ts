// Deterministic extraction of explicitly published facts from one HTML page. No LLM, no guessing:
// every fact carries the page URL and a short evidence snippet. Page content is data only.

import { cleanEmail, extractEmails, sameDomain } from './email';
import { findPhones, normalizeIlPhone } from './phone';
import type { DayHours } from './rules';

export interface Fact<T = string> {
  value: T;
  url: string;
  evidence: string;
  onContactPage?: boolean;
}

export interface PageFacts {
  emails: Fact[];
  agencyEmails: string[]; // footer credits of the site builder: excluded
  phones: Fact[];
  whatsapp: Fact[]; // only explicit wa.me / api.whatsapp links
  socials: Fact<{ network: string; url: string }>[];
  booking: Fact[];
  hours: Fact<DayHours[]> | null;
  address: Fact | null;
  services: Fact<{ name: string; priceNis: number; priceType: 'fixed' | 'from' | 'per_unit' | 'per_ml' | 'per_area'; currency: 'ILS' }>[];
  logos: Fact[]; // candidates only: reuse rights are not established
  links: string[]; // relevant same-site links to follow
  text: string;
}

const CONTACT_PAGE = /(contact|צור|צרו|קשר)/i;
export const FOLLOW = /(contact|about|service|treat|price|pricing|menu|branch|location|צור|צרו|קשר|אודות|שירות|טיפול|מחיר|מחירון|סניפ|מיקום)/i;
const SKIP = /(blog|news|post|tag\/|category\/|calendar|events?\/|search|cart|checkout|login|signin|wp-admin|wp-json|feed|privacy|terms|accessibility|נגישות|תקנון|מדיניות|\.(pdf|jpe?g|png|gif|webp|zip|mp4)$)/i;
const CREDIT = /(נבנה\s*(ע["״]?י|על ידי)|בניית\s*אתרים|עיצוב\s*ו?בניית|פיתוח\s*אתרים|developed by|designed by|powered by|created by|website by|site by|web design)/i;
const BOOKING_HOSTS = /(^|\.)(tor4you\.co\.il|mytor\.co\.il|calendly\.com|setmore\.com|fresha\.com|booksy\.com|simplybook\.(me|it)|vagaro\.com|easyapp\.co\.il|bizonline\.co\.il|picktime\.com|appointy\.com)$/i;

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/footer|\/header)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const snippet = (text: string, needle: string, span = 70) => {
  const i = text.indexOf(needle);
  if (i < 0) return needle;
  return text.slice(Math.max(0, i - span), i + needle.length + span).replace(/\s+/g, ' ').trim();
};

// ---------- JSON-LD ----------

const DAY_INDEX: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };

function hoursFromLd(spec: unknown): DayHours[] | null {
  const list = Array.isArray(spec) ? spec : spec ? [spec] : [];
  if (!list.length) return null;
  const days: DayHours[] = Array.from({ length: 7 }, () => ({ open: '', close: '', closed: true }));
  let any = false;
  for (const s of list as Array<Record<string, unknown>>) {
    const opens = String(s.opens ?? '').slice(0, 5);
    const closes = String(s.closes ?? '').slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(opens) || !/^\d{2}:\d{2}$/.test(closes)) continue;
    const dow = Array.isArray(s.dayOfWeek) ? s.dayOfWeek : [s.dayOfWeek];
    for (const d of dow) {
      const key = String(d ?? '').split('/').pop()!.toLowerCase();
      const i = DAY_INDEX[key];
      if (i == null) continue;
      days[i] = { open: opens, close: closes === '00:00' ? '23:59' : closes, closed: false };
      any = true;
    }
  }
  return any ? days : null;
}

function jsonLd(html: string) {
  const out = { emails: [] as string[], phones: [] as string[], sameAs: [] as string[], logo: null as string | null, hours: null as DayHours[] | null, address: null as string | null };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const visit = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(visit);
      if (!v || typeof v !== 'object') return;
      const o = v as Record<string, unknown>;
      if (typeof o.email === 'string') out.emails.push(o.email);
      if (typeof o.telephone === 'string') out.phones.push(o.telephone);
      if (Array.isArray(o.sameAs)) out.sameAs.push(...o.sameAs.filter((x): x is string => typeof x === 'string'));
      if (typeof o.logo === 'string') out.logo ??= o.logo;
      else if (o.logo && typeof (o.logo as { url?: unknown }).url === 'string') out.logo ??= (o.logo as { url: string }).url;
      if (o.openingHoursSpecification) out.hours ??= hoursFromLd(o.openingHoursSpecification);
      if (o.address && typeof o.address === 'object') {
        const a = o.address as Record<string, unknown>;
        const parts = [a.streetAddress, a.addressLocality].filter(x => typeof x === 'string' && x.trim());
        if (parts.length) out.address ??= parts.join(', ');
      }
      for (const x of Object.values(o)) if (x && typeof x === 'object') visit(x);
    };
    try {
      visit(JSON.parse(m[1]));
    } catch {
      /* broken JSON-LD is common */
    }
  }
  return out;
}

// ---------- prices ----------

const PRICE_RE = /(?:₪\s*(\d{2,6}(?:[.,]\d{1,2})?)|(\d{2,6}(?:[.,]\d{1,2})?)\s*(?:₪|ש["״']?ח|שקלים|שקל|nis|ils))/i;

/** Lines with an explicit shekel price: "name ... 250 ₪". The line itself is kept as evidence. */
export function priceLines(text: string, url: string): PageFacts['services'] {
  const out: PageFacts['services'] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length < 4 || line.length > 160) continue;
    const m = line.match(PRICE_RE);
    if (!m) continue;
    const price = Number((m[1] ?? m[2]).replace(',', '.'));
    if (!Number.isFinite(price) || price < 10 || price > 100_000) continue;
    const name = line
      .slice(0, m.index)
      .replace(/(החל\s*מ[-־]?|מ[-־]\s*$|:|-|–|\||\.{2,})\s*$/u, '')
      .trim();
    if (name.length < 2 || name.length > 80 || /^\d/.test(name)) continue;
    const priceType = /החל\s*מ|^מ[-־]|\bfrom\b/i.test(line) ? 'from' : /ליחידה|per unit/i.test(line) ? 'per_unit' : /למ["״]?ל|per ml/i.test(line) ? 'per_ml' : /לאזור|per area/i.test(line) ? 'per_area' : 'fixed';
    out.push({ value: { name, priceNis: price, priceType, currency: 'ILS' }, url, evidence: line });
  }
  return out.slice(0, 80);
}

// ---------- page ----------

export function extractPage(html: string, url: string, siteHost: string): PageFacts {
  const text = htmlToText(html);
  const isContact = CONTACT_PAGE.test(decodeURIComponentSafe(new URL(url).pathname));
  const ld = jsonLd(html);

  // Emails: every address, minus the site builder's footer credit.
  const agency = new Set<string>();
  const emails: Fact[] = [];
  for (const e of new Set([...extractEmails(html), ...ld.emails.map(x => cleanEmail(x)).filter((x): x is string => !!x)])) {
    const ctx = snippet(text, e, 90);
    if (CREDIT.test(ctx) && !sameDomain(e, `https://${siteHost}`)) {
      agency.add(e);
      continue;
    }
    emails.push({ value: e, url, evidence: ctx, onContactPage: isContact });
  }

  const phones: Fact[] = [];
  const seenPhones = new Set<string>();
  const addPhone = (p: string | null, ev: string) => {
    if (p && !seenPhones.has(p)) {
      seenPhones.add(p);
      phones.push({ value: p, url, evidence: ev, onContactPage: isContact });
    }
  };
  for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi)) addPhone(normalizeIlPhone(decode(m[1])), `tel:${m[1]}`);
  for (const p of ld.phones) addPhone(normalizeIlPhone(p), `JSON-LD telephone ${p}`);
  for (const p of findPhones(text)) addPhone(p, snippet(text, p.replace('+972', '0').slice(0, 4)));

  const whatsapp: Fact[] = [];
  for (const m of html.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=|whatsapp:\/\/send\?phone=)(\+?\d{9,14})/gi)) {
    const n = normalizeIlPhone(m[1]);
    if (n && !whatsapp.some(w => w.value === n)) whatsapp.push({ value: n, url, evidence: m[0] });
  }

  const socials: PageFacts['socials'] = [];
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(m => decode(m[1]));
  for (const h of [...hrefs, ...ld.sameAs]) {
    const s = socialOf(h);
    if (s && !socials.some(x => x.value.url === s.url)) socials.push({ value: s, url, evidence: h });
  }

  const booking: Fact[] = [];
  for (const h of hrefs) {
    try {
      const u = new URL(h, url);
      if (BOOKING_HOSTS.test(u.hostname) && !booking.some(b => b.value === u.toString())) booking.push({ value: u.toString(), url, evidence: h });
    } catch {
      /* bad href */
    }
  }

  const logos: Fact[] = [];
  if (ld.logo) logos.push({ value: absolute(ld.logo, url), url, evidence: 'JSON-LD logo' });
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (og) logos.push({ value: absolute(decode(og), url), url, evidence: 'og:image' });

  const links: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const u = new URL(decode(m[1]), url);
      if (u.hostname.replace(/^www\./, '') !== siteHost) continue;
      const path = decodeURIComponentSafe(u.pathname);
      const label = htmlToText(m[2]);
      if (SKIP.test(path)) continue;
      if (FOLLOW.test(path) || FOLLOW.test(label)) links.push(u.toString().split('#')[0]);
    } catch {
      /* bad href */
    }
  }

  return {
    emails,
    agencyEmails: [...agency],
    phones,
    whatsapp,
    socials,
    booking,
    hours: ld.hours ? { value: ld.hours, url, evidence: 'JSON-LD openingHoursSpecification' } : null,
    address: ld.address ? { value: ld.address, url, evidence: 'JSON-LD address' } : null,
    services: priceLines(text, url),
    logos,
    links: [...new Set(links)],
    text,
  };
}

function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const absolute = (href: string, base: string) => {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
};

export function socialOf(href: string): { network: string; url: string } | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|he-il|he)\./, '');
  const first = u.pathname.split('/').filter(Boolean)[0] ?? '';
  if (!first) return null;
  if (host === 'instagram.com' && !['p', 'reel', 'reels', 'explore', 'accounts', 'stories'].includes(first)) return { network: 'instagram', url: `https://www.instagram.com/${first}` };
  if ((host === 'facebook.com' || host === 'fb.com') && !['sharer', 'sharer.php', 'share', 'plugins', 'tr', 'dialog', 'login'].includes(first)) return { network: 'facebook', url: `https://www.facebook.com/${u.pathname.replace(/^\/|\/$/g, '')}` };
  if (host === 'tiktok.com' && first.startsWith('@')) return { network: 'tiktok', url: `https://www.tiktok.com/${first}` };
  if (host === 'youtube.com' && (first.startsWith('@') || first === 'channel' || first === 'c')) return { network: 'youtube', url: `https://www.youtube.com${u.pathname}` };
  return null;
}

/** Best email for a branch: own-domain on a contact page, then own-domain, then contact page, then any. */
export function rankEmails(facts: Fact[], website: string | null): Fact[] {
  const score = (f: Fact) => (sameDomain(f.value, website) ? 2 : 0) + (f.onContactPage ? 1 : 0);
  return [...facts].sort((a, b) => score(b) - score(a));
}
