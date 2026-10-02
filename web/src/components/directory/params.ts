// URL state of the directory list. Shared by the server page (parse + fetch) and the
// client island (build the next URL). Filters and sort are applied server-side only.
// The list is paged with real links (?page=N), every page server-rendered, so crawlers reach every business.

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
  { key: 'reviews', name: 'הכי הרבה ביקורות' },
  { key: 'price', name: 'מחיר נמוך' },
];

/** Cards per page. A city with more businesses gets numbered pages. */
export const PAGE = 48;
/** Upper bound for ?page= so a crafted URL cannot ask for an absurd offset. */
export const MAX_PAGE = 200;

export interface DirQuery {
  filters: FilterKey[];
  sort: SortKey;
  page: number;
}

type SP = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseQuery(sp: SP): DirQuery {
  const filters = FILTER_KEYS.filter(k => first(sp[k]) === '1');
  const s = first(sp.sort);
  const sort: SortKey = SORTS.some(o => o.key === s) ? (s as SortKey) : 'recommended';
  const n = Number.parseInt(first(sp.page) ?? '', 10);
  const page = Number.isFinite(n) && n > 1 ? Math.min(MAX_PAGE, n) : 1;
  return { filters, sort, page };
}

export function dirHref(base: string, q: DirQuery): string {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) if (q.filters.includes(k)) p.set(k, '1');
  if (q.sort !== 'recommended') p.set('sort', q.sort);
  if (q.page > 1) p.set('page', String(q.page));
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

/** Filters or a sort beyond the plain listing (noindex). Paging alone keeps the page indexable with its own canonical. */
export const hasParams = (q: DirQuery) => q.filters.length > 0 || q.sort !== 'recommended';

/** The canonical address of the current list: the base listing, or the page itself from page 2 on. */
export const canonicalHref = (base: string, q: DirQuery) => (q.page > 1 ? `${base}?page=${q.page}` : base);

export const pageCount = (total: number) => Math.max(1, Math.ceil(total / PAGE));

/** Page numbers to show in the pager: first, last, and a window around the current page; null marks a gap. */
export function pagerItems(current: number, pages: number, window = 2): Array<number | null> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const set = new Set<number>([1, pages]);
  for (let i = current - window; i <= current + window; i++) if (i >= 1 && i <= pages) set.add(i);
  const sorted = [...set].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  for (const [i, n] of sorted.entries()) {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(null);
    out.push(n);
  }
  return out;
}
