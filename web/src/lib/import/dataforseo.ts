// DataForSEO Business Listings: request building and response mapping. Pure functions.
// Schema per the official client (dataforseo-client 2.1.7, BusinessDataBusinessListingsSearchLive*):
//   request  { categories?: string[] (<=10), title?, description?, is_claimed?, location_coordinate?:
//              "lat,lng,radiusKm" (radius >= 1), filters?: [...] (<=8), order_by?: string[] (<=3),
//              limit?: <=1000, offset?: (<=10,000 results), offset_token?, tag? }
//   response { status_code, tasks: [{ id, status_code, status_message, cost, result: [{ total_count, count,
//              offset, offset_token, items: [...] }] }] }
// Every item field is optional; unknown fields are ignored. The endpoint searches DataForSEO's existing
// database: a "live" request does not mean each business was freshly crawled (see last_updated_time).

import { CATEGORIES } from '../catalog';
import { normName } from './match';
import { classifyWebsite, KEEP_AS_WEBSITE, type WebsiteKind } from './websiteKind';
import { normalizeIlPhone } from './phone';
import type { DayHours } from './rules';

export const DFS_SEARCH_PATH = '/v3/business_data/business_listings/search/live';
export const DFS_MAX_LIMIT = 1000;
export const DFS_MAX_CATEGORIES = 10;
export const DFS_MAX_OFFSET = 10_000;

/**
 * Our categories to DataForSEO (Google business) category ids. All ids were checked against the
 * provider's category list on 2026-09-25 (`npm run import:dfs-categories`); re-run it after changes.
 */
export const DFS_CATEGORY_MAP: Record<string, string[]> = {
  facials: ['beauty_salon', 'skin_care_clinic', 'facial_spa', 'beautician'],
  'medical-aesthetics': ['medical_spa', 'skin_care_clinic', 'cosmetic_surgeon'],
  'plastic-surgery': ['plastic_surgeon', 'plastic_surgery_clinic', 'cosmetic_surgeon'],
  'dental-aesthetics': ['cosmetic_dentist', 'teeth_whitening_service'],
  'hair-restoration': ['hair_transplantation_clinic', 'hair_replacement_service'],
  'hair-salons': ['hair_salon', 'barber_shop', 'unisex_hairdresser'],
  'hair-removal': ['hair_removal_service', 'laser_hair_removal_service', 'waxing_hair_removal_service'],
  'brows-lashes': ['eyelash_salon', 'eyebrow_bar'],
  makeup: ['makeup_artist'],
  'permanent-makeup': ['permanent_make_up_clinic'],
  nails: ['nail_salon'],
  'spa-massage': ['day_spa', 'spa', 'massage_spa', 'massage_therapist'],
  'body-contouring': ['weight_loss_service'],
  tanning: ['tanning_studio'],
};

/** Hebrew names and aliases for matching DataForSEO category labels back to ours (original kept too). */
export const CATEGORY_ALIASES: Record<string, string[]> = Object.fromEntries(
  CATEGORIES.map(c => [c.slug, [c.name]]),
);

export function dfsCategoriesFor(slugs: string[]): string[] {
  return [...new Set(slugs.flatMap(s => DFS_CATEGORY_MAP[s] ?? []))];
}

/** Our categories from a DataForSEO item's category ids and labels. */
export function ourCategoriesFrom(item: DfsItem): string[] {
  const ids = new Set([...(item.category_ids ?? []), ...(item.additional_categories ?? []).map(snake)]);
  if (item.category) ids.add(snake(item.category));
  const out: string[] = [];
  for (const [slug, dfs] of Object.entries(DFS_CATEGORY_MAP)) if (dfs.some(id => ids.has(id))) out.push(slug);
  return out;
}

const snake = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export interface DfsSearchRequest {
  categories?: string[];
  location_coordinate?: string;
  filters?: unknown[];
  order_by?: string[];
  limit?: number;
  offset?: number;
  offset_token?: string;
  tag?: string;
}

/** One request body. Categories are chunked by the caller to 10; limit capped at 1,000. */
export function buildSearch(opts: { categories: string[]; lat: number; lng: number; radiusKm: number; limit: number; offset?: number; offsetToken?: string; tag?: string }): DfsSearchRequest {
  if (opts.categories.length > DFS_MAX_CATEGORIES) throw new Error('too_many_categories');
  const body: DfsSearchRequest = {
    categories: opts.categories,
    location_coordinate: `${opts.lat.toFixed(7)},${opts.lng.toFixed(7)},${Math.max(1, Math.ceil(opts.radiusKm))}`,
    // Documented filter syntax: [field, operator, value]; keeps results inside Israel.
    filters: [['address_info.country_code', '=', 'IL']],
    // Stable order so offset pagination does not reshuffle between pages.
    order_by: ['rating.votes_count,desc'],
    limit: Math.min(DFS_MAX_LIMIT, Math.max(1, opts.limit)),
    tag: opts.tag,
  };
  if (opts.offsetToken) body.offset_token = opts.offsetToken;
  else if (opts.offset) body.offset = opts.offset;
  return body;
}

// ---------- response ----------

export interface DfsItem {
  type?: string;
  title?: string;
  original_title?: string;
  description?: string;
  category?: string;
  category_ids?: string[];
  additional_categories?: string[];
  cid?: string;
  feature_id?: string;
  address?: string;
  address_info?: { borough?: string; address?: string; city?: string; zip?: string; region?: string; country_code?: string };
  place_id?: string;
  phone?: string;
  url?: string;
  domain?: string;
  logo?: string;
  main_image?: string;
  total_photos?: number;
  latitude?: number;
  longitude?: number;
  is_claimed?: boolean;
  rating?: { rating_type?: string; value?: number; votes_count?: number; rating_max?: number };
  work_time?: { work_hours?: { timetable?: Record<string, Array<{ open?: { hour?: number; minute?: number }; close?: { hour?: number; minute?: number } }> | null>; current_status?: string } };
  contact_info?: Array<{ type?: string; value?: string; source?: string }>;
  check_url?: string;
  last_updated_time?: string;
  first_seen?: string;
  [key: string]: unknown;
}

export interface DfsTask {
  id?: string;
  status_code?: number;
  status_message?: string;
  cost?: number;
  result?: Array<{ total_count?: number; count?: number; offset?: number; offset_token?: string; items?: DfsItem[] | null }> | null;
}
export interface DfsResponse {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: DfsTask[];
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const hm = (t?: { hour?: number; minute?: number }) => `${String(t?.hour ?? 0).padStart(2, '0')}:${String(t?.minute ?? 0).padStart(2, '0')}`;

/** DataForSEO timetable (day name -> ranges) to our 7 entries, Sunday first. Null when absent. */
export function hoursFromDfs(tt: NonNullable<NonNullable<DfsItem['work_time']>['work_hours']>['timetable'] | undefined): DayHours[] | null {
  if (!tt || !Object.keys(tt).length) return null;
  return DAYS.map(day => {
    const ranges = tt[day];
    if (!ranges || !ranges.length) return { open: '', close: '', closed: true };
    const open = ranges.map(r => hm(r.open)).sort()[0];
    const close = ranges.map(r => hm(r.close)).sort().at(-1)!;
    return { open, close: close === '00:00' ? '23:59' : close, closed: false };
  });
}

const parseTime = (s?: string) => {
  if (!s) return null;
  const d = new Date(s.replace(' +00:00', 'Z').replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
};

export interface MappedListing {
  sourceKey: string; // Google place id when present, else dfs:cid:...
  sourceId: string | null;
  name: string;
  nameNorm: string;
  address: string;
  locality: string | null;
  lat: number | null;
  lng: number | null;
  phoneRaw: string | null;
  phone: string | null;
  website: string | null; // own site, social profile or link page only
  websiteKind: WebsiteKind | null;
  rejectedWebsite: { url: string; kind: WebsiteKind } | null; // a directory or unrelated link the provider gave
  bookingUrl: string | null;
  whatsapp: string | null;
  social: { network: string; url: string } | null;
  siteDomain: string | null;
  googleMapsUrl: string | null; // the business's Google profile (Maps), used as the website when there is no other
  providerLogo: string | null; // Google profile logo (via DataForSEO)
  providerPhoto: string | null; // Google profile main photo (via DataForSEO)
  categories: string[];
  primaryType: string | null;
  types: string[];
  hours: DayHours[] | null;
  rating: { value: number; count: number } | null;
  claimedOnProvider: boolean | null; // informational only: never marks a listing claimed on our side
  sourceUrl: string | null;
  sourceUpdatedAt: Date | null;
  emails: string[]; // only from contact_info entries of type email
}

/** The business's Google Maps profile: by cid when known (stable), else by place id. */
export function googleMapsUrl(item: Pick<DfsItem, 'cid' | 'place_id' | 'title'>): string | null {
  if (item.cid && /^\d+$/.test(item.cid)) return `https://www.google.com/maps?cid=${item.cid}`;
  if (item.place_id) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.title ?? 'place')}&query_place_id=${encodeURIComponent(item.place_id)}`;
  return null;
}

/**
 * Google profile images come in small sizes (for example "=w408-h306-k-no" or "=s44-p-k-no"). Asks for
 * a larger rendition of the same image; other URLs are returned unchanged.
 */
export function largerGoogleImage(url: string, as: 'logo' | 'photo'): string {
  if (!/googleusercontent\.com/.test(url)) return url;
  const size = as === 'logo' ? 's400' : 'w1600-h1200';
  if (/=[swh]\d+[^/]*$/.test(url)) return url.replace(/=[swh]\d+[^/]*$/, `=${size}-k-no`);
  return `${url}=${size}-k-no`;
}

/** Maps one item. Returns null when it lacks the minimum identity (a name and an id). */
export function mapItem(item: DfsItem): MappedListing | null {
  const name = (item.title ?? item.original_title ?? '').trim();
  const sourceId = item.cid ?? item.feature_id ?? null;
  if (!name || (!item.place_id && !sourceId)) return null;
  const phoneRaw = item.phone ?? item.contact_info?.find(c => c.type === 'telephone' || c.type === 'phone')?.value ?? null;
  const w = classifyWebsite(item.url ?? (item.domain ? `https://${item.domain}` : null));
  const keep = w.url && KEEP_AS_WEBSITE.includes(w.kind);
  const website = keep ? w.url : null;
  const types = [item.category, ...(item.additional_categories ?? [])].filter((x): x is string => !!x);
  return {
    sourceKey: item.place_id ?? `dfs:cid:${sourceId}`,
    sourceId,
    name,
    nameNorm: normName(name),
    address: (item.address ?? item.address_info?.address ?? '').trim(),
    locality: item.address_info?.city?.trim() || null,
    lat: typeof item.latitude === 'number' ? item.latitude : null,
    lng: typeof item.longitude === 'number' ? item.longitude : null,
    phoneRaw,
    phone: normalizeIlPhone(phoneRaw),
    website,
    websiteKind: keep ? w.kind : null,
    rejectedWebsite: w.kind === 'directory' && w.url ? { url: w.url, kind: w.kind } : null,
    bookingUrl: w.kind === 'booking' ? w.url : null,
    whatsapp: w.kind === 'whatsapp' ? (w.phone ?? null) : null,
    social: w.kind === 'social' && w.url ? { network: w.network!, url: w.url } : null,
    siteDomain: w.kind === 'own' && w.url ? new URL(w.url).hostname.replace(/^www\./, '').toLowerCase() : null,
    googleMapsUrl: googleMapsUrl(item),
    providerLogo: typeof item.logo === 'string' && /^https?:\/\//.test(item.logo) ? item.logo : null,
    providerPhoto: typeof item.main_image === 'string' && /^https?:\/\//.test(item.main_image) ? item.main_image : null,
    categories: ourCategoriesFrom(item),
    primaryType: item.category_ids?.[0] ?? null,
    types,
    hours: hoursFromDfs(item.work_time?.work_hours?.timetable),
    rating: item.rating?.value != null ? { value: item.rating.value, count: item.rating.votes_count ?? 0 } : null,
    claimedOnProvider: item.is_claimed ?? null,
    sourceUrl: item.check_url ?? null,
    sourceUpdatedAt: parseTime(item.last_updated_time),
    emails: (item.contact_info ?? []).filter(c => c.type === 'mail' || c.type === 'email').map(c => c.value ?? '').filter(Boolean),
  };
}

/**
 * DataForSEO status codes that mean every further call will fail too: 401xx authorization,
 * 40200/40210 payment or balance, 403xx access. The provider's status_message is always shown with it.
 */
export function isFatalStatus(code: number | undefined): boolean {
  if (code == null) return false;
  return (code >= 40100 && code < 40200) || code === 40200 || code === 40210 || (code >= 40300 && code < 40400);
}
/** Rate limits and temporary server errors: worth a bounded retry with backoff. */
export function isTransientStatus(code: number | undefined): boolean {
  if (code == null) return false;
  return code === 40202 || code === 40209 || code >= 50000;
}
