// Coverage of the import per city and category: how many businesses the provider lists (a paid count,
// one request per city and category), how many the import has already found, and how many are
// published. Pure arithmetic over rows the server loads; the new-import form shows the result next to
// every city and category so the same city and service is not crawled twice.

import { CATEGORIES, CITIES } from '../catalog';
import { pricing, type Pricing } from './pricing';

export interface CoverageCell {
  city: string; // city slug
  category: string; // category slug
  total: number | null; // provider's matching records; null when never counted (or the count failed)
  checkedAt: string | null; // ISO date of the last count
  found: number; // import records in any state except rejected or duplicate
  published: number; // approved or merged into a live listing
}

export interface CoverageSummary {
  total: number; // sum of known provider totals for the counted pairs
  counted: number; // pairs with a provider total
  pairs: number; // pairs asked about
  found: number;
  published: number;
  /** all counted pairs are covered: found >= total (with a small tolerance for provider churn) */
  done: boolean;
  /** how far the crawl got, 0..1, over the counted pairs; null without a count */
  share: number | null;
}

/** A pair counts as covered when the import found at least this share of the provider's total. */
export const DONE_SHARE = 0.9;

const key = (city: string, category: string) => `${city}\u0000${category}`;

export function coverageIndex(cells: CoverageCell[]): Map<string, CoverageCell> {
  return new Map(cells.map(c => [key(c.city, c.category), c]));
}

/** Coverage of one city over the chosen categories (or of one category over the chosen cities). */
export function summarize(index: Map<string, CoverageCell>, cities: string[], categories: string[]): CoverageSummary {
  let total = 0;
  let counted = 0;
  let found = 0;
  let published = 0;
  let foundCounted = 0;
  let pairs = 0;
  for (const city of cities)
    for (const category of categories) {
      pairs++;
      const c = index.get(key(city, category));
      if (!c) continue;
      found += c.found;
      published += c.published;
      if (c.total != null) {
        counted++;
        total += c.total;
        foundCounted += Math.min(c.found, c.total);
      }
    }
  const share = counted ? (total ? foundCounted / total : 1) : null;
  return { total, counted, pairs, found, published, done: counted > 0 && counted === pairs && share != null && share >= DONE_SHARE, share };
}

/** Which (city, category) pairs a count run should ask about: those never counted or counted before `staleBefore`. */
export function pairsToCount(cells: CoverageCell[], cities: string[], categories: string[], staleBefore: Date, recount = false): Array<{ city: string; category: string }> {
  const index = coverageIndex(cells);
  const out: Array<{ city: string; category: string }> = [];
  for (const city of cities)
    for (const category of categories) {
      const c = index.get(key(city, category));
      if (recount || !c || c.total == null || !c.checkedAt || new Date(c.checkedAt) < staleBefore) out.push({ city, category });
    }
  return out;
}

/** One request of one record per pair: the request fee plus one record. */
export function countRequestUsd(p: Pricing = pricing()): number {
  return p.dataforseo.businessListingsSearch.perRequestUsd + p.dataforseo.businessListingsSearch.perItemUsd;
}

export const ALL_CITY_SLUGS = CITIES.map(c => c.slug);
export const ALL_CATEGORY_SLUGS = CATEGORIES.map(c => c.slug);
