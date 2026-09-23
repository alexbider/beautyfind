// URL state of the directory list. Shared by the server page (parse + fetch) and the
// client island (build the next URL). Filters and sort are applied server-side only.

import { BOOKING_LIVE } from '@/lib/features';

const ALL_FILTER_KEYS = ['verified', 'online', 'parking', 'accessible'] as const;
// 'online' stays hidden until booking is live (lib/features.ts).
export const FILTER_KEYS = ALL_FILTER_KEYS.filter(k => BOOKING_LIVE || k !== 'online');
export type FilterKey = (typeof ALL_FILTER_KEYS)[number];

export const FILTER_LABELS: Record<FilterKey, string> = {
  verified: 'עסק מאומת',
  online: 'קביעת תור אונליין',
  parking: 'חניה חינם',
  accessible: 'נגיש לכיסא גלגלים',
};

export type SortKey = 'recommended' | 'rating' | 'reviews' | 'price';

export const SORTS: Array<{ key: SortKey; name: string }> = [
  { key: 'recommended', name: 'מומלצים' },
  { key: 'rating', name: 'דירוג גבוה' },
  { key: 'reviews', name: 'הכי מבוקרים' },
  { key: 'price', name: 'מחיר נמוך' },
];

/** Cards per "show more" step. */
export const PAGE = 12;
/** Upper bound for ?show= so a crafted URL cannot ask for the whole table. */
export const MAX_SHOW = 240;

export interface DirQuery {
  filters: FilterKey[];
  sort: SortKey;
  show: number;
}

type SP = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseQuery(sp: SP): DirQuery {
  const filters = FILTER_KEYS.filter(k => first(sp[k]) === '1');
  const s = first(sp.sort);
  const sort: SortKey = SORTS.some(o => o.key === s) ? (s as SortKey) : 'recommended';
  const n = Number.parseInt(first(sp.show) ?? '', 10);
  const show = Number.isFinite(n) && n > PAGE ? Math.min(MAX_SHOW, Math.ceil(n / PAGE) * PAGE) : PAGE;
  return { filters, sort, show };
}

export function dirHref(base: string, q: DirQuery): string {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) if (q.filters.includes(k)) p.set(k, '1');
  if (q.sort !== 'recommended') p.set('sort', q.sort);
  if (q.show > PAGE) p.set('show', String(q.show));
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

/** Any URL state beyond the plain listing (used for noindex; the canonical never carries params). */
export const hasParams = (q: DirQuery) => q.filters.length > 0 || q.sort !== 'recommended' || q.show > PAGE;
