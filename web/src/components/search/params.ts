import { BOOKING_LIVE } from '@/lib/features';
// Search URL state: parse, serialize, and map to the listing filter.
// Shared by the server page and the client islands, so it must stay free of server-only imports.

import { CITIES, REGIONS, categoryBySlug, regionBySlug, type RegionSlug } from '@/lib/catalog';
import type { ListingFilter, Sort } from '@/lib/server/public';

export type ViewKey = 'list' | 'grid' | 'map';
export type FeatureKey = 'verified' | 'online' | 'parking' | 'accessible';

export interface SearchState {
  q: string;
  region: RegionSlug | null;
  city: string | null; // city slug
  t: string | null; // category slug
  f: FeatureKey[];
  price: number | null; // max "from" price in shekels
  sort: Sort;
  view: ViewKey;
  page: number; // 1-based, each page adds PER_LOAD cards
}

/** Design props (BeautyFind Search.dc.html data-props). */
export const PER_LOAD = 6;
export const MAP_VIEW = true;
/** Upper bound for "load more" so one URL never asks for an unbounded list. */
export const MAX_PAGE = 20;

// Only the features the data model has. The design also lists free consult, doctor on site,
// injecting nurses, evening hours and Friday hours; those need new Branch fields.
// 'online' stays hidden until booking is live (lib/features.ts).
export const FEATURES: Array<{ key: FeatureKey; name: string }> = [
  { key: 'verified', name: 'עסקים מאומתים בלבד' },
  { key: 'online', name: 'קביעת תור אונליין' },
  { key: 'parking', name: 'חניה חינם' },
  { key: 'accessible', name: 'נגיש לכיסא גלגלים' },
].filter(f => BOOKING_LIVE || f.key !== 'online') as Array<{ key: FeatureKey; name: string }>;

// Price tiers: filter by the lowest published price ("from"). The same thresholds label the cards.
export const PRICE_TIERS = [
  { max: 300, sym: '₪', name: 'חסכוני' },
  { max: 700, sym: '₪₪', name: 'בינוני' },
  { max: 1500, sym: '₪₪₪', name: 'פרימיום' },
] as const;

export const SORTS: Array<{ key: Sort; name: string; short: string }> = [
  { key: 'recommended', name: 'התאמה', short: 'התאמה' },
  { key: 'rating', name: 'דירוג גבוה', short: 'דירוג' },
  { key: 'reviews', name: 'הכי מבוקרים', short: 'ביקורות' },
  { key: 'price', name: 'מחיר מהזול', short: 'מחיר' },
];

export const DEFAULT_STATE: SearchState = { q: '', region: null, city: null, t: null, f: [], price: null, sort: 'recommended', view: 'list', page: 1 };

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? '';

export function parseSearch(sp: Raw): SearchState {
  const q = one(sp.q).slice(0, 80);
  let region = (regionBySlug(one(sp.region))?.slug ?? null) as RegionSlug | null;
  const cityRow = CITIES.find(c => c.slug === one(sp.city));
  let city: string | null = null;
  if (cityRow && (!region || cityRow.region === region)) {
    city = cityRow.slug;
    region = cityRow.region;
  }
  const t = categoryBySlug(one(sp.t))?.slug ?? null;
  const fKeys = new Set(one(sp.f).split(','));
  const f = FEATURES.filter(x => fKeys.has(x.key)).map(x => x.key);
  const priceN = parseInt(one(sp.price), 10);
  const price = Number.isFinite(priceN) && priceN >= 50 && priceN <= 100000 ? priceN : null;
  const sort = (SORTS.find(s => s.key === one(sp.sort))?.key ?? 'recommended') as Sort;
  const viewRaw = one(sp.view);
  const view: ViewKey = viewRaw === 'grid' || (viewRaw === 'map' && MAP_VIEW) ? viewRaw : 'list';
  const pageN = parseInt(one(sp.page), 10);
  const page = Number.isFinite(pageN) ? Math.min(Math.max(pageN, 1), MAX_PAGE) : 1;
  return { q, region, city, t, f, price, sort, view, page };
}

/** Canonical-order query string; defaults are omitted so equal states share one URL. */
export function searchHref(s: SearchState): string {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  if (s.region) p.set('region', s.region);
  if (s.city) p.set('city', s.city);
  if (s.t) p.set('t', s.t);
  if (s.f.length) p.set('f', FEATURES.filter(x => s.f.includes(x.key)).map(x => x.key).join(','));
  if (s.price != null) p.set('price', String(s.price));
  if (s.sort !== 'recommended') p.set('sort', s.sort);
  if (s.view !== 'list') p.set('view', s.view);
  if (s.page > 1) p.set('page', String(s.page));
  const qs = p.toString();
  return qs ? `/search?${qs}` : '/search';
}

export function toFilter(s: SearchState): ListingFilter {
  return {
    q: s.q || undefined,
    region: s.region ?? undefined,
    citySlug: s.city ?? undefined,
    category: s.t ?? undefined,
    verifiedOnly: s.f.includes('verified') || undefined,
    onlineBooking: (BOOKING_LIVE && s.f.includes('online')) || undefined,
    freeParking: s.f.includes('parking') || undefined,
    accessible: s.f.includes('accessible') || undefined,
    maxPriceShekels: s.price ?? undefined,
    sort: s.sort,
  };
}

/** Filters in the panel (the query text is not one of them). */
export const hasPanelFilters = (s: SearchState) => !!(s.region || s.city || s.t || s.f.length || s.price != null);
export const clearedFilters = (s: SearchState): SearchState => ({ ...s, region: null, city: null, t: null, f: [], price: null, page: 1 });

export const cityName = (slug: string | null) => (slug ? CITIES.find(c => c.slug === slug)?.name ?? null : null);
export const regionName = (slug: string | null) => (slug ? regionBySlug(slug)?.name ?? null : null);
export const categoryName = (slug: string | null) => (slug ? categoryBySlug(slug)?.name ?? null : null);

export const placeName = (s: Pick<SearchState, 'city' | 'region'>) => cityName(s.city) ?? regionName(s.region) ?? 'ישראל';

/** H1 and <title>: "הסרת שיער בחיפה", "בוטוקס בתל אביב–יפו", "מכוני יופי ואסתטיקה בישראל". */
export function headline(s: SearchState): string {
  const what = s.q || categoryName(s.t);
  return what ? `${what} ב${placeName(s)}` : `מכוני יופי ואסתטיקה ב${placeName(s)}`;
}

export function priceTier(from: number | null) {
  if (from == null) return null;
  return PRICE_TIERS.find(t => from <= t.max) ?? PRICE_TIERS[PRICE_TIERS.length - 1];
}

export function priceOptionParts(max: number) {
  const tier = PRICE_TIERS.find(t => t.max === max);
  const last = PRICE_TIERS[PRICE_TIERS.length - 1];
  return { amount: '₪' + max.toLocaleString('en-US'), tier: tier && tier !== last ? tier.name : null };
}

/** Plain-text price option ("עד ₪300 · חסכוני"), for aria labels. */
export function priceOptionName(max: number) {
  const p = priceOptionParts(max);
  return p.tier ? `עד ${p.amount} · ${p.tier}` : `עד ${p.amount}`;
}

/**
 * Resolves the free-text "where" box to a city or region from the catalog.
 * Returns null when nothing matches, so the caller can fall back to text search.
 */
export function resolveWhere(text: string): { region: RegionSlug | null; city: string | null } | null {
  const t = text.trim();
  if (!t) return { region: null, city: null };
  const norm = (x: string) => x.replace(/[־–-]/g, ' ').replace(/\s+/g, ' ').trim();
  const n = norm(t);
  const city = CITIES.find(c => norm(c.name) === n) ?? (n.length >= 2 ? CITIES.find(c => norm(c.name).startsWith(n) || n.includes(norm(c.name))) : undefined);
  if (city) return { region: city.region, city: city.slug };
  const region = REGIONS.find(r => r.name === n || n.includes(r.name) || n === `אזור ${r.name}`);
  return region ? { region: region.slug, city: null } : null;
}

/** Datalist options for the "where" box: regions first, then every city. */
// Some cities share a name with their region (חיפה, ירושלים); each name is listed once.
export const WHERE_OPTIONS = [...new Set([...REGIONS.map(r => r.name), ...CITIES.map(c => c.name)])];

// ---------- Hebrew plurals (text form, for aria labels and titles) ----------

export const bizText = (n: number) => (n === 1 ? 'עסק אחד' : n === 2 ? 'שני עסקים' : `${n} עסקים`);
export const resultsText = (n: number) => (n === 1 ? 'תוצאה אחת' : n === 2 ? 'שתי תוצאות' : `${n} תוצאות`);
