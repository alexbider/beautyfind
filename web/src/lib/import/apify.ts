// Apify actors as extra enrichment sources, next to DataForSEO and the business's own website.
// Pure mapping code: actor inputs, and the facts we take from each actor's output. The HTTP client is
// scripts/import/providers/apify.ts; the worker stage is scripts/import/stages/apify.ts.
//
// Four actors, each for the gaps it can fill:
//   maps       Google Maps place details (hours, phone, website, wheelchair access, parking, the owner's
//              own description, profile photos, rating): for records with a Google place id or cid.
//   instagram  the business's Instagram profile (bio, link in bio, profile picture, recent posts):
//              verifies the account when the bio links to the business site or shows its phone.
//   facebook   the business's Facebook page (about text, email, phone, website, hours, pictures).
//   render     Apify's website crawler with a real browser, only for sites our own crawler could not
//              read because they need JavaScript. Never for sites that blocked us or forbid crawling
//              in robots.txt: Apify is asked to respect robots.txt as well.

import { extractEmails } from './email';
import { normalizeIlPhone } from './phone';
import type { DayHours } from './rules';
import { socialOf } from './websiteKind';

export type ApifyActorKind = 'maps' | 'instagram' | 'facebook' | 'render';

/** Actor ids in the API form (owner~name). Overridable through IMPORT_PRICING_JSON (pricing.apify.actors). */
export const DEFAULT_ACTORS: Record<ApifyActorKind, string> = {
  maps: 'compass~crawler-google-places',
  instagram: 'apify~instagram-profile-scraper',
  facebook: 'apify~facebook-pages-scraper',
  render: 'apify~website-content-crawler',
};

/** Items per actor run: small batches keep one failed run cheap and resumable. */
export const BATCH: Record<ApifyActorKind, number> = { maps: 50, instagram: 50, facebook: 20, render: 5 };

/** Provider names used on observations and provenance records. */
export const APIFY_PROVIDER: Record<ApifyActorKind, string> = { maps: 'apify_google_maps', instagram: 'apify_instagram', facebook: 'apify_facebook', render: 'apify_site' };

// ---------- inputs ----------

export interface MapsTarget {
  id: string; // import record id
  placeId: string | null; // Google place id (ChIJ...)
  cid: string | null; // Google cid (numeric)
}

export function mapsInput(targets: MapsTarget[], opts: { maxImages: number }): Record<string, unknown> {
  const placeIds = targets.map(t => t.placeId).filter((x): x is string => !!x);
  const startUrls = targets.filter(t => !t.placeId && t.cid).map(t => ({ url: `https://maps.google.com/?cid=${t.cid}` }));
  return {
    ...(placeIds.length ? { placeIds } : {}),
    ...(startUrls.length ? { startUrls } : {}),
    language: 'en', // stable field labels ("Wheelchair accessible entrance"); the owner's description keeps its own language
    maxImages: opts.maxImages,
    maxReviews: 0, // review texts are never collected
    scrapeReviewsPersonalData: false,
    additionalInfo: true,
    skipClosedPlaces: false,
    maxCrawledPlacesPerSearch: 1,
  };
}

export function instagramInput(usernames: string[]): Record<string, unknown> {
  return { usernames };
}

export function facebookInput(urls: string[]): Record<string, unknown> {
  return { startUrls: urls.map(url => ({ url })) };
}

export function renderInput(urls: string[], opts: { maxPages: number }): Record<string, unknown> {
  return {
    startUrls: urls.map(url => ({ url })),
    maxCrawlPages: opts.maxPages * urls.length,
    maxCrawlDepth: 2,
    crawlerType: 'playwright:adaptive',
    saveHtml: true,
    saveMarkdown: false,
    htmlTransformer: 'none',
    respectRobotsTxtFile: true, // same rule as our own crawler
    proxyConfiguration: { useApifyProxy: true },
  };
}

// ---------- Google Maps output ----------

export interface MapsItem {
  placeId?: string | null;
  cid?: string | null;
  title?: string | null;
  url?: string | null;
  address?: string | null;
  phone?: string | null;
  phoneUnformatted?: string | null;
  website?: string | null;
  totalScore?: number | null;
  reviewsCount?: number | null;
  description?: string | null;
  categoryName?: string | null;
  categories?: string[] | null;
  imageUrls?: string[] | null;
  openingHours?: Array<{ day?: string; hours?: string }> | null;
  additionalInfo?: Record<string, Array<Record<string, boolean>>> | null;
  location?: { lat?: number; lng?: number } | null;
  permanentlyClosed?: boolean | null;
  temporarilyClosed?: boolean | null;
  claimThisBusiness?: boolean | null; // true when Google still shows "Claim this business" (unclaimed)
  bookingLinks?: string[] | null;
  price?: string | null;
}

const DAY_INDEX: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

/** "9 AM", "9:30 PM", "12 AM", "18:30" to HH:MM. */
export function parseClock(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ?? '00';
  const ap = m[3]?.toUpperCase();
  if (ap === 'AM' && h === 12) h = 0;
  else if (ap === 'PM' && h < 12) h += 12;
  if (h > 24 || Number(min) > 59) return null;
  return `${String(h).padStart(2, '0')}:${min}`;
}

/**
 * Google Maps opening hours as the actor returns them ("9 AM to 6 PM", "9 AM to 1 PM, 4 to 8 PM",
 * "Closed", "Open 24 hours") to our seven Sunday-first entries. Split shifts collapse to the first
 * opening and the last closing. A day that is missing from the list is unknown, not closed.
 */
export function hoursFromMaps(list: MapsItem['openingHours']): DayHours[] | null {
  if (!list?.length) return null;
  const days: DayHours[] = Array.from({ length: 7 }, () => ({ open: '', close: '', closed: false, unknown: true }));
  let any = false;
  for (const e of list) {
    const d = DAY_INDEX[(e.day ?? '').trim().toLowerCase()];
    const text = (e.hours ?? '').trim();
    if (d == null || !text) continue;
    if (/^closed$/i.test(text)) {
      days[d] = { open: '', close: '', closed: true };
      any = true;
      continue;
    }
    if (/open 24 hours/i.test(text)) {
      days[d] = { open: '00:00', close: '23:59', closed: false };
      any = true;
      continue;
    }
    const ranges = text.split(/\s*,\s*/).map(r => r.split(/\s+to\s+|\s*[–-]\s*/));
    const opens: string[] = [];
    const closes: string[] = [];
    for (const [a, b] of ranges) {
      if (!a || !b) continue;
      // "4 to 8 PM": the first clock borrows the meridiem of the second.
      const bAp = b.match(/(AM|PM)$/i)?.[1];
      const open = parseClock(/AM|PM/i.test(a) || !bAp ? a : `${a} ${bAp}`);
      const close = parseClock(b);
      if (open && close) {
        opens.push(open);
        closes.push(close);
      }
    }
    if (!opens.length) continue;
    const close = closes.sort().at(-1)!;
    days[d] = { open: opens.sort()[0], close: close === '00:00' ? '23:59' : close, closed: false };
    any = true;
  }
  return any ? days : null;
}

/** Tri-state attributes from the "additionalInfo" groups. Absent means unknown, never false. */
export function attributesFromMaps(info: MapsItem['additionalInfo']): { accessible: boolean | null; freeParking: boolean | null; appointmentRequired: boolean | null } {
  const out = { accessible: null as boolean | null, freeParking: null as boolean | null, appointmentRequired: null as boolean | null };
  if (!info) return out;
  for (const [group, entries] of Object.entries(info)) {
    for (const e of entries ?? []) {
      for (const [label, value] of Object.entries(e ?? {})) {
        const l = label.toLowerCase();
        if (/wheelchair accessible entrance/.test(l)) out.accessible = out.accessible || value === true;
        if (/^free (street )?parking|free parking lot|free parking garage/.test(l) && group.toLowerCase() === 'parking') out.freeParking = out.freeParking || value === true;
        if (/appointment required|appointments? recommended/.test(l)) out.appointmentRequired = value === true;
      }
    }
  }
  return out;
}

export interface MapsFacts {
  placeId: string | null;
  cid: string | null;
  name: string | null;
  phone: string | null; // E.164
  website: string | null;
  hours: DayHours[] | null;
  description: string | null; // the owner's text on the profile ("From the business")
  rating: { value: number; count: number } | null;
  photos: string[];
  accessible: boolean | null;
  freeParking: boolean | null;
  appointmentRequired: boolean | null;
  closed: 'permanently' | 'temporarily' | null;
  claimedOnProvider: boolean | null;
  bookingLinks: string[];
  sourceUrl: string | null;
}

export function mapsFacts(it: MapsItem, opts: { maxPhotos: number }): MapsFacts {
  const attrs = attributesFromMaps(it.additionalInfo);
  const desc = (it.description ?? '').replace(/\s+/g, ' ').trim();
  return {
    placeId: it.placeId ?? null,
    cid: it.cid ? String(it.cid) : null,
    name: it.title?.trim() || null,
    phone: normalizeIlPhone(it.phoneUnformatted ?? it.phone ?? null),
    website: it.website?.trim() || null,
    hours: hoursFromMaps(it.openingHours),
    description: desc.length >= 40 ? desc.slice(0, 2000) : null,
    rating: typeof it.totalScore === 'number' && it.totalScore > 0 ? { value: it.totalScore, count: it.reviewsCount ?? 0 } : null,
    photos: [...new Set((it.imageUrls ?? []).filter(u => /^https?:\/\//.test(u)))].slice(0, opts.maxPhotos),
    accessible: attrs.accessible,
    freeParking: attrs.freeParking,
    appointmentRequired: attrs.appointmentRequired,
    closed: it.permanentlyClosed ? 'permanently' : it.temporarilyClosed ? 'temporarily' : null,
    claimedOnProvider: typeof it.claimThisBusiness === 'boolean' ? !it.claimThisBusiness : null,
    bookingLinks: (it.bookingLinks ?? []).filter(u => /^https?:\/\//.test(u)).slice(0, 3),
    sourceUrl: it.url ?? (it.cid ? `https://maps.google.com/?cid=${it.cid}` : null),
  };
}

// ---------- Instagram output ----------

export interface InstagramItem {
  username?: string | null;
  fullName?: string | null;
  biography?: string | null;
  externalUrl?: string | null;
  externalUrls?: Array<{ url?: string }> | null;
  followersCount?: number | null;
  postsCount?: number | null;
  profilePicUrlHD?: string | null;
  profilePicUrl?: string | null;
  isBusinessAccount?: boolean | null;
  businessCategoryName?: string | null;
  businessEmail?: string | null;
  publicEmail?: string | null;
  businessPhoneNumber?: string | null;
  publicPhoneNumber?: string | null;
  private?: boolean | null;
  latestPosts?: Array<{ type?: string; url?: string; displayUrl?: string; caption?: string; timestamp?: string; images?: string[] }> | null;
  error?: string | null; // the actor reports a missing or private profile this way
}

export interface ProfileFacts {
  handle: string | null;
  url: string | null;
  name: string | null;
  bio: string | null;
  links: string[]; // every outbound link the profile shows
  email: string | null;
  phone: string | null;
  logo: string | null; // profile picture
  cover: string | null; // Facebook cover photo
  photos: Array<{ url: string; pageUrl: string | null; caption: string | null }>; // recent image posts
  followers: number | null;
  category: string | null;
  hours: DayHours[] | null;
  unavailable: boolean; // private, missing or not scraped
}

const phonesIn = (text: string): string | null => {
  for (const m of text.matchAll(/(?:\+972|0)[\d\s().-]{7,14}\d/g)) {
    const p = normalizeIlPhone(m[0]);
    if (p) return p;
  }
  return null;
};

export function instagramFacts(it: InstagramItem, opts: { maxPosts: number }): ProfileFacts {
  const bio = (it.biography ?? '').trim();
  const links = [...new Set([it.externalUrl, ...(it.externalUrls ?? []).map(x => x?.url)].filter((u): u is string => !!u && /^https?:\/\//.test(u)))];
  const email = [it.businessEmail, it.publicEmail].find(e => e && /@/.test(e)) ?? extractEmails(bio)[0] ?? null;
  const phone = normalizeIlPhone(it.businessPhoneNumber ?? it.publicPhoneNumber ?? null) ?? phonesIn(bio);
  const posts = (it.latestPosts ?? [])
    .filter(p => (p.type ?? 'Image') !== 'Video' && (p.displayUrl || p.images?.[0]))
    .map(p => ({ url: (p.displayUrl ?? p.images?.[0])!, pageUrl: p.url ?? null, caption: p.caption?.slice(0, 200) ?? null }))
    .slice(0, opts.maxPosts);
  return {
    handle: it.username?.toLowerCase() ?? null,
    url: it.username ? `https://www.instagram.com/${it.username}` : null,
    name: it.fullName?.trim() || null,
    bio: bio || null,
    links,
    email: email ? email.toLowerCase() : null,
    phone,
    logo: it.profilePicUrlHD ?? it.profilePicUrl ?? null,
    cover: null,
    photos: posts,
    followers: typeof it.followersCount === 'number' ? it.followersCount : null,
    category: it.businessCategoryName ?? null,
    hours: null,
    unavailable: !!it.error || it.private === true || !it.username,
  };
}

// ---------- Facebook output ----------

export interface FacebookItem {
  pageUrl?: string | null;
  facebookUrl?: string | null;
  title?: string | null;
  pageName?: string | null;
  categories?: string[] | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  websites?: string[] | null;
  intro?: string | null;
  about_me?: { text?: string } | null;
  about?: string | null;
  info?: string[] | null;
  address?: string | null;
  followers?: number | null;
  likes?: number | null;
  profilePictureUrl?: string | null;
  profilePhoto?: string | null;
  coverPhotoUrl?: string | null;
  workHours?: Array<{ day?: string; hours?: string }> | Record<string, string> | null;
  error?: string | null;
}

/** Facebook hours come either as the Maps-like list or as { Monday: "09:00 - 18:00" }. */
export function hoursFromFacebook(w: FacebookItem['workHours']): DayHours[] | null {
  if (!w) return null;
  if (Array.isArray(w)) return hoursFromMaps(w);
  return hoursFromMaps(Object.entries(w).map(([day, hours]) => ({ day, hours: String(hours).replace(/\s*-\s*/, ' to ') })));
}

export function facebookFacts(it: FacebookItem): ProfileFacts {
  const about = [it.intro, it.about_me?.text, it.about, ...(it.info ?? [])].filter((s): s is string => !!s && s.trim().length > 0).map(s => s.trim());
  const bio = [...new Set(about)].join('\n').trim();
  const links = [...new Set([it.website, ...(it.websites ?? [])].filter((u): u is string => !!u && /^https?:\/\//.test(u)))];
  const url = it.pageUrl ?? it.facebookUrl ?? null;
  const email = it.email && /@/.test(it.email) ? it.email.toLowerCase() : extractEmails(bio)[0] ?? null;
  return {
    handle: url ? socialOf(url)?.url.split('/').filter(Boolean).at(-1) ?? null : null,
    url: url ? socialOf(url)?.url ?? url : null,
    name: (it.title ?? it.pageName)?.trim() || null,
    bio: bio || null,
    links,
    email,
    phone: normalizeIlPhone(it.phone ?? null) ?? phonesIn(bio),
    logo: it.profilePictureUrl ?? it.profilePhoto ?? null,
    cover: it.coverPhotoUrl ?? null,
    photos: it.coverPhotoUrl ? [{ url: it.coverPhotoUrl, pageUrl: url, caption: null }] : [],
    followers: it.followers ?? it.likes ?? null,
    category: it.categories?.[0] ?? null,
    hours: hoursFromFacebook(it.workHours),
    unavailable: !!it.error || !url,
  };
}

// ---------- verification of a social account from its own profile ----------

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Does the scraped profile belong to this business? Yes when the profile links to the business's own
 * website (a backlink from the account itself) or shows the business's phone. A matching name alone is
 * not enough: same-name accounts are common.
 */
export function profileMatches(f: ProfileFacts, biz: { domain: string | null; phone: string | null; whatsapp?: string | null }): 'links_site' | 'shows_phone' | null {
  const domain = biz.domain?.replace(/^www\./, '').toLowerCase() ?? null;
  if (domain && f.links.some(l => hostOf(l) === domain)) return 'links_site';
  const phones = [biz.phone, biz.whatsapp].filter(Boolean);
  if (f.phone && phones.includes(f.phone)) return 'shows_phone';
  return null;
}

// ---------- website crawler output ----------

export interface RenderItem {
  url?: string;
  crawl?: { loadedUrl?: string; httpStatusCode?: number };
  metadata?: { title?: string };
  html?: string | null;
  text?: string | null;
}

/** Pages grouped by the site they belong to (the crawler returns every site's pages in one dataset). */
export function groupRenderPages(items: RenderItem[]): Map<string, Array<{ url: string; html: string; status: number }>> {
  const out = new Map<string, Array<{ url: string; html: string; status: number }>>();
  for (const it of items) {
    const url = it.crawl?.loadedUrl ?? it.url;
    if (!url || !it.html) continue;
    const host = hostOf(url);
    if (!host) continue;
    out.set(host, [...(out.get(host) ?? []), { url, html: it.html, status: it.crawl?.httpStatusCode ?? 200 }]);
  }
  return out;
}

// ---------- errors and costs ----------

/** Why an actor run could not start or finish, from Apify's error type or message. */
export function apifyErrorKind(status: number | null, message: string): 'funds' | 'auth' | 'transient' | 'other' {
  const m = message.toLowerCase();
  if (status === 401 || /token|not authorized|unauthorized|authentication/.test(m)) return 'auth';
  if (status === 402 || /usage.?limit|insufficient|credit|balance|payment|billing|exceeded/.test(m)) return 'funds';
  if ((status != null && status >= 500) || status === 429 || /rate.?limit|timeout|temporar/.test(m)) return 'transient';
  return 'other';
}

/** Which Instagram handle a profile URL names. */
export function instagramHandle(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = socialOf(url);
  if (!s || s.network !== 'instagram') return null;
  return s.url.split('/').filter(Boolean).at(-1)?.toLowerCase() ?? null;
}
