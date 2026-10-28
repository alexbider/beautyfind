// Sponsored placements, the shared rules (client and server). Sold by the month, one card in the
// sponsored slider of one page:
//   city_list       a city + category list   /dan/tel-aviv/nails        pageKey "list:dan/tel-aviv/nails"
//   treatment_page  a national treatment page /treatments/nails         pageKey "treatment:nails"
//   homepage        the homepage slider       /                         pageKey "home"
// Prices and the number of slots per page come from platform settings (/ops/settings); the defaults
// here are what a fresh database uses.

import type { CampaignPlacement } from '@prisma/client';

export const DEFAULT_LIST_MONTHLY_NIS = 499;
export const DEFAULT_HOME_MONTHLY_NIS = 999;
export const DEFAULT_SLOTS_PER_PAGE = 10;
/** Businesses whose first placement month is free (the launch offer). */
export const DEFAULT_FREE_MONTH_QUOTA = 50;
/** Fewer profile visits from the card than this in a billing month = 50% off the next month. 0 turns it off. */
export const DEFAULT_MAKE_GOOD_VISITS = 20;
/** Hours a placement waiting for review keeps its slot. */
export const HOLD_HOURS = 24;
/** A placement cancelled at least this many hours before it starts is refunded in full. */
export const FULL_REFUND_HOURS = 48;

export type Placement = CampaignPlacement;

export const PLACEMENT_NAME: Record<Placement, string> = {
  city_list: 'רשימת עיר ותחום',
  treatment_page: 'עמוד תחום הטיפול',
  homepage: 'עמוד הבית',
};

export const PLACEMENT_HINT: Record<Placement, string> = {
  city_list: 'בראש רשימת העסקים בעיר שלכם, בתחום שבחרתם',
  treatment_page: 'בעמוד התחום הארצי, לפני הרשימות לפי אזור ועיר',
  homepage: 'בעמוד הבית, מתחת לחיפוש, מול כל מי שנכנס לאתר',
};

export type PageTarget =
  | { placement: 'homepage' }
  | { placement: 'treatment_page'; category: string }
  | { placement: 'city_list'; region: string; city: string; category: string };

export function pageKeyOf(t: PageTarget): string {
  if (t.placement === 'homepage') return 'home';
  if (t.placement === 'treatment_page') return `treatment:${t.category}`;
  return `list:${t.region}/${t.city}/${t.category}`;
}

export function parsePageKey(key: string): PageTarget | null {
  if (key === 'home') return { placement: 'homepage' };
  const t = /^treatment:([a-z0-9-]+)$/.exec(key);
  if (t) return { placement: 'treatment_page', category: t[1] };
  const l = /^list:([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(key);
  if (l) return { placement: 'city_list', region: l[1], city: l[2], category: l[3] };
  return null;
}

/** The public URL of a page key. */
export function pathOfPageKey(key: string): string {
  const t = parsePageKey(key);
  if (!t || t.placement === 'homepage') return '/';
  if (t.placement === 'treatment_page') return `/treatments/${t.category}`;
  return `/${t.region}/${t.city}/${t.category}`;
}

export interface SponsoredPrices { listMonthlyNis: number; homeMonthlyNis: number }

export const monthlyNisFor = (placement: Placement, p: SponsoredPrices) => (placement === 'homepage' ? p.homeMonthlyNis : p.listMonthlyNis);

/** Hebrew month count: חודש · חודשיים · N חודשים. */
export const monthsHe = (n: number) => (n === 1 ? 'חודש' : n === 2 ? 'חודשיים' : `${n} חודשים`);

/** Hebrew free-slot count: אין מקום פנוי · מקום אחד פנוי · שני מקומות פנויים · N מקומות פנויים. */
export function freeSlotsHe(n: number): string {
  if (n <= 0) return 'אין מקום פנוי';
  if (n === 1) return 'מקום אחד פנוי';
  if (n === 2) return 'שני מקומות פנויים';
  return `${n} מקומות פנויים`;
}

/** Fisher–Yates on a copy. The slider shuffles once per page load so every advertiser gets the first position equally. */
export function shuffled<T>(items: readonly T[], rnd: () => number = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** One calendar month after a date (the 31st rolls to the last day of a shorter month). */
export function addMonth(d: Date, n = 1): Date {
  const out = new Date(d);
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + n);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

/** The card a visitor sees in a sponsored slider. Built on the server, rendered by SponsoredSlider. */
export interface SponsoredCardData {
  campaignId: string;
  branchId: string;
  href: string;
  name: string;
  line: string;
  featured: string | null;
  categoryName: string | null;
  cityName: string;
  coverUrl: string | null;
  coverAlt: string;
  google: { rating: number; count: number } | null;
  beautyfind: { rating: number; count: number } | null;
  verified: boolean;
  priceFromShekels: number | null;
}
