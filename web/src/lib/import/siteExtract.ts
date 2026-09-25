// Deterministic extraction of explicitly published facts from one HTML page. No LLM, no guessing:
// every fact carries the page URL and a short evidence snippet. Page content is data only.

import { cleanEmail, extractEmails, sameDomain } from './email';
import { findPhones, normalizeIlPhone } from './phone';
import { durationOf, looksLikeServiceName, matchService, serviceKey } from './services';
import { BOOKING_HOSTS, socialOf } from './websiteKind';

export { socialOf };
import type { DayHours } from './rules';

export interface Fact<T = string> {
  value: T;
  url: string;
  evidence: string;
  onContactPage?: boolean;
}

export type PriceType = 'fixed' | 'from' | 'per_unit' | 'per_ml' | 'per_area';
export interface SiteService {
  name: string;
  priceNis: number | null; // null: the service is listed without a price
  priceType: PriceType;
  currency: 'ILS';
  category: string | null;
  isMedical: boolean;
  durationMin: number | null;
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
  services: Fact<SiteService>[];
  logos: Fact[]; // candidate logo image URLs, best first
  photos: Fact[]; // candidate photo URLs from the business's own pages, best first
  siteName: string | null; // og:site_name, JSON-LD name or <title>, for checking the site belongs to the business
  links: string[]; // relevant same-site links to follow
  outLinks: string[]; // links to other sites (used on link-in-bio pages to find the real site)
  text: string;
}

const CONTACT_PAGE = /(contact|צור|צרו|קשר)/i;
export const FOLLOW = /(contact|about|service|treat|price|pricing|menu|branch|location|gallery|portfolio|צור|צרו|קשר|אודות|שירות|טיפול|מחיר|מחירון|סניפ|מיקום|גלריה|תמונות|עבודות)/i;
const SKIP = /(blog|news|post|tag\/|category\/|calendar|events?\/|search|cart|checkout|login|signin|wp-admin|wp-json|feed|privacy|terms|accessibility|נגישות|תקנון|מדיניות|\.(pdf|jpe?g|png|gif|webp|zip|mp4)$)/i;
const CREDIT = /(נבנה\s*(ע["״]?י|על ידי)|בניית\s*אתרים|עיצוב\s*ו?בניית|פיתוח\s*אתרים|developed by|designed by|powered by|created by|website by|site by|web design)/i;

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
  const out = {
    emails: [] as string[], phones: [] as string[], sameAs: [] as string[], logo: null as string | null, hours: null as DayHours[] | null, address: null as string | null,
    name: null as string | null, images: [] as string[], offers: [] as Array<{ name: string; price: number | null; from: boolean; evidence: string }>,
  };
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
      const type = ([] as unknown[]).concat(o['@type'] ?? []).map(String);
      const isBusiness = type.some(t => /LocalBusiness|BeautySalon|HairSalon|NailSalon|DaySpa|HealthAndBeautyBusiness|MedicalClinic|Physician|Dentist|Organization|Store/i.test(t));
      if (isBusiness && typeof o.name === 'string') out.name ??= o.name.trim();
      if (isBusiness) for (const img of ([] as unknown[]).concat(o.image ?? [])) {
        const u = typeof img === 'string' ? img : img && typeof (img as { url?: unknown }).url === 'string' ? (img as { url: string }).url : null;
        if (u) out.images.push(u);
      }
      // Services and offers: "Service", "Offer", "Product" with a name, and a price when given.
      if (type.some(t => /^(Service|Offer|Product|MedicalProcedure|IndividualProduct)$/i.test(t))) {
        const item = (o.itemOffered && typeof o.itemOffered === 'object' ? o.itemOffered : o) as Record<string, unknown>;
        const name = typeof item.name === 'string' ? item.name.trim() : typeof o.name === 'string' ? o.name.trim() : '';
        const offer = ([] as unknown[]).concat(o.offers ?? o)[0] as Record<string, unknown> | undefined;
        const spec = (offer?.priceSpecification ?? {}) as Record<string, unknown>;
        const cur = String(offer?.priceCurrency ?? spec.priceCurrency ?? 'ILS').toUpperCase();
        const raw = offer?.price ?? spec.price ?? offer?.lowPrice ?? spec.minPrice;
        const price = cur === 'ILS' && raw != null && Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : null;
        if (name) out.offers.push({ name, price, from: offer?.lowPrice != null || spec.minPrice != null, evidence: `JSON-LD ${type[0]}: ${name}${price ? ` ${price} ILS` : ''}` });
      }
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

// ---------- services and prices ----------

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d{2,6})(?:[.,]\d{1,2})?`;
const PRICE_RE = new RegExp(String.raw`(?:₪\s*${NUM}(?:\s*[-–]\s*₪?\s*${NUM})?|${NUM}(?:\s*[-–]\s*${NUM})?\s*(?:₪|ש["״']?ח|שקלים|שקל|nis\b|ils\b))`, 'i');
const PRICE_ONLY = new RegExp(String.raw`^(?:החל\s*מ[-־]?\s*|מ[-־]\s*|from\s*)?(?:₪\s*)?${NUM}(?:\s*[-–]\s*${NUM})?\s*(?:₪|ש["״']?ח|שקלים|שקל|nis|ils)?\s*$`, 'i');
const toNum = (s: string | undefined) => (s ? Number(s.replace(/,(?=\d{3})/g, '').replace(',', '.')) : NaN);

function priceOf(m: RegExpMatchArray): { price: number; range: boolean } | null {
  const nums = m.slice(1).filter(Boolean).map(toNum).filter(Number.isFinite);
  if (!nums.length) return null;
  const price = nums[0];
  if (price < 10 || price > 200_000) return null;
  return { price, range: nums.length > 1 };
}

function priceTypeOf(line: string, range: boolean): PriceType {
  if (/ליחידה|per\s*unit/i.test(line)) return 'per_unit';
  if (/למ["״]?ל|per\s*ml/i.test(line)) return 'per_ml';
  if (/לאזור|per\s*area/i.test(line)) return 'per_area';
  return range || /החל\s*מ|(^|\s)מ[-־]\s*\d|\bfrom\b|\+\s*$/i.test(line) ? 'from' : 'fixed';
}

const cleanName = (s: string) =>
  s
    .replace(/[•·●▪■◆★✓✔►▶➤*|:–\-]+\s*$/u, '')
    .replace(/^\s*[•·●▪■◆★✓✔►▶➤*|:–\-]+/u, '')
    .replace(/\s*(החל\s*מ[-־]?|מ[-־]|from)\s*$/iu, '')
    .replace(/\.{2,}|…/g, ' ')
    .replace(/[-–(]?\s*\d{2,3}\s*(?:דק(?:ות|['׳])?|min(?:utes)?)\s*\)?/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function service(name: string, price: number | null, type: PriceType, line: string, url: string): Fact<SiteService> | null {
  const n = cleanName(name);
  if (n.length < 2 || n.length > 80 || /^\d/.test(n) || !/[a-zA-Zא-ת]/.test(n)) return null;
  const m = matchService(n);
  // A priced line is a service even when our vocabulary does not know the treatment.
  if (!m && price == null) return null;
  return { value: { name: n, priceNis: price, priceType: type, currency: 'ILS', category: m?.category ?? null, isMedical: m?.isMedical ?? false, durationMin: durationOf(line) }, url, evidence: line.slice(0, 200) };
}

/**
 * Services on one page:
 * - lines with a shekel price, name before or after the price ("טיפול פנים 250 ₪", "₪250 טיפול פנים"),
 *   ranges ("250-400 ₪") and "from" prices;
 * - a name line followed by a price-only line (card layouts);
 * - short lines that name a known treatment, without a price.
 */
export function priceLines(text: string, url: string): PageFacts['services'] {
  const out: PageFacts['services'] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const used = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 160) continue;
    const priceOnly = PRICE_ONLY.test(line) && /₪|ש["״']?ח|שקל|nis|ils/i.test(line);
    if (priceOnly) {
      // "name" then "price" on the next line.
      const prev = lines[i - 1];
      const m = line.match(PRICE_RE);
      const p = m && priceOf(m);
      if (p && prev && !used.has(i - 1) && !PRICE_RE.test(prev) && looksLikeServiceName(prev)) {
        const f = service(prev, p.price, priceTypeOf(line, p.range), `${prev} ${line}`, url);
        if (f) {
          out.push(f);
          used.add(i - 1);
        }
      }
      continue;
    }
    const m = line.match(PRICE_RE);
    if (m && m.index != null) {
      const p = priceOf(m);
      if (!p) continue;
      const before = line.slice(0, m.index);
      const after = line.slice(m.index + m[0].length);
      const name = cleanName(before).length >= 2 ? before : after;
      const f = service(name, p.price, priceTypeOf(line, p.range), line, url);
      if (f) {
        out.push(f);
        used.add(i);
      }
      continue;
    }
    if (looksLikeServiceName(line)) {
      const f = service(line, null, 'fixed', line, url);
      if (f) out.push(f);
    }
  }
  // One entry per service name; a priced entry wins.
  const byName = new Map<string, Fact<SiteService>>();
  for (const f of out) {
    const k = serviceKey(f.value.name);
    const cur = byName.get(k);
    if (!cur || (cur.value.priceNis == null && f.value.priceNis != null)) byName.set(k, f);
  }
  return [...byName.values()].slice(0, 120);
}

// ---------- images ----------

const IMG_EXT = /\.(jpe?g|png|webp)(\?|#|$)/i;
const IMG_HOST_OK = /(wixstatic\.com|squarespace-cdn\.com|shopify|cloudinary\.com|imgix\.net|wp-content\/uploads|googleusercontent\.com\/(?!.*=s\d{2}-)|cdn|images?|media|uploads|static)/i;
const IMG_BAD = /(sprite|icon|favicon|placeholder|spinner|loader|pixel|blank|spacer|avatar|emoji|flag|payment|visa|mastercard|paypal|bit-logo|google-play|app-store|whatsapp|facebook|instagram|tiktok|waze|accessib|nagish|captcha|banner-ad|\/ads?\/|gravatar|1x1|\.svg|\.gif|data:)/i;
const LOGO_HINT = /logo|לוגו/i;

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return m ? decode(m[1]).trim() : null;
}

function bestFromSrcset(srcset: string): string | null {
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(',')) {
    const [u, d] = part.trim().split(/\s+/);
    const w = d?.endsWith('w') ? Number(d.slice(0, -1)) : d?.endsWith('x') ? Number(d.slice(0, -1)) * 1000 : 0;
    if (u && (!best || w > best.w)) best = { url: u, w };
  }
  return best?.url ?? null;
}

function images(html: string, url: string, ldImages: string[], ldLogo: string | null) {
  const logos: Fact[] = [];
  const photos: Fact[] = [];
  const add = (list: Fact[], raw: string | null, evidence: string) => {
    if (!raw) return;
    const abs = absolute(raw, url);
    if (!/^https?:\/\//i.test(abs) || IMG_BAD.test(abs)) return;
    if (!list.some(x => x.value === abs) && !logos.some(x => x.value === abs) && !photos.some(x => x.value === abs)) list.push({ value: abs, url, evidence });
  };
  if (ldLogo) add(logos, ldLogo, 'JSON-LD logo');
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attr(tag, 'data-src') ?? attr(tag, 'data-lazy-src') ?? (attr(tag, 'srcset') ? bestFromSrcset(attr(tag, 'srcset')!) : null) ?? attr(tag, 'src');
    if (!src) continue;
    const hint = `${attr(tag, 'class') ?? ''} ${attr(tag, 'id') ?? ''} ${attr(tag, 'alt') ?? ''} ${src}`;
    if (LOGO_HINT.test(hint)) {
      if (logos.length < 3) add(logos, src, `img ${attr(tag, 'alt') ?? 'logo'}`.slice(0, 120));
      continue;
    }
    const w = Number(attr(tag, 'width') ?? 0);
    const h = Number(attr(tag, 'height') ?? 0);
    if ((w && w < 250) || (h && h < 200)) continue; // thumbnails and icons
    if (!IMG_EXT.test(src) && !IMG_HOST_OK.test(src)) continue;
    if (photos.length < 20) add(photos, src, `img ${attr(tag, 'alt') ?? ''}`.trim().slice(0, 120));
  }
  // Hero and section backgrounds set inline (common in Wix and Elementor pages).
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
    const u = decode(m[1]);
    if (IMG_EXT.test(u) && photos.length < 20 && !LOGO_HINT.test(u)) add(photos, u, 'background image');
  }
  // Social preview image and structured data images come last among photos (often a logo or banner).
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::url)?["'][^>]*>/gi)) add(photos, attr(m[0], 'content'), 'og:image');
  for (const i of ldImages) add(photos, i, 'JSON-LD image');
  // Touch icons are square logos at a usable size.
  for (const m of html.matchAll(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/gi)) {
    const href = attr(m[0], 'href');
    if (href && !IMG_BAD.test(href.replace(/icon/gi, ''))) {
      const abs = absolute(href, url);
      if (!logos.some(x => x.value === abs)) logos.push({ value: abs, url, evidence: 'apple-touch-icon' });
    }
  }
  return { logos: logos.slice(0, 4), photos: photos.slice(0, 20) };
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

  const { logos, photos } = images(html, url, ld.images, ld.logo);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const ogSite = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const siteName = ld.name ?? (ogSite ? decode(ogSite).trim() : null) ?? (title ? decode(title).replace(/\s+/g, ' ').trim().slice(0, 120) : null);

  // Services from structured data first, then from the page text.
  const ldServices: Fact<SiteService>[] = [];
  for (const o of ld.offers) {
    const m = matchService(o.name);
    ldServices.push({ value: { name: o.name.slice(0, 80), priceNis: o.price, priceType: o.from ? 'from' : 'fixed', currency: 'ILS', category: m?.category ?? null, isMedical: m?.isMedical ?? false, durationMin: null }, url, evidence: o.evidence });
  }
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

  const outLinks: string[] = [];
  for (const h of hrefs) {
    try {
      const u = new URL(h, url);
      if (/^https?:$/.test(u.protocol) && u.hostname.replace(/^www\./, '') !== siteHost && !outLinks.includes(u.toString())) outLinks.push(u.toString());
    } catch {
      /* bad href */
    }
  }

  return {
    outLinks: outLinks.slice(0, 40),
    emails,
    agencyEmails: [...agency],
    phones,
    whatsapp,
    socials,
    booking,
    hours: ld.hours ? { value: ld.hours, url, evidence: 'JSON-LD openingHoursSpecification' } : null,
    address: ld.address ? { value: ld.address, url, evidence: 'JSON-LD address' } : null,
    services: mergeServices([...ldServices, ...priceLines(text, url)]),
    logos,
    photos,
    siteName,
    links: [...new Set(links)],
    text,
  };
}

export function mergeServices(list: Fact<SiteService>[]): Fact<SiteService>[] {
  const byName = new Map<string, Fact<SiteService>>();
  for (const f of list) {
    const k = serviceKey(f.value.name);
    const cur = byName.get(k);
    if (!cur || (cur.value.priceNis == null && f.value.priceNis != null)) byName.set(k, f);
  }
  return [...byName.values()];
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


/** Best email for a branch: own-domain on a contact page, then own-domain, then contact page, then any. */
export function rankEmails(facts: Fact[], website: string | null): Fact[] {
  const score = (f: Fact) => (sameDomain(f.value, website) ? 2 : 0) + (f.onContactPage ? 1 : 0);
  return [...facts].sort((a, b) => score(b) - score(a));
}
