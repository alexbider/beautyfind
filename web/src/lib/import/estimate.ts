// Dry-run cost estimator. No network. Gross prices from pricing.ts; every assumption is shown.

import { CITIES } from '../catalog';
import { NEARBY_TYPES, TEXT_QUERIES } from './categories';
import { boxTouchesIsrael, cityBox, ISRAEL_BOX, tileBox } from './geo';
import { pricing, type Pricing } from './pricing';
import type { RunScope } from './rules';

export interface EstimateAssumptions {
  pageSize: number; // records requested per DataForSEO page (<= 1,000)
  pageFullness: number; // share of each page actually returned (0..1)
  duplicateShare: number; // returned records that are repeats across areas/categories
  websiteShare: number; // unique records with a website
  pagesPerSite: number; // average website requests per site (cap is the crawl setting)
  usableShare: number; // unique records that end up publishable
  googleCallsPerRecord: number; // optional admin lookups (0 when Google is off)
  googleSkuPer1000: number;
  photoShare: number; // records with one optional photo lookup
  llmShare: number; // records sent to the optional LLM (0 when off)
}

export const DEFAULT_ASSUMPTIONS: EstimateAssumptions = {
  pageSize: 1000,
  pageFullness: 0.9,
  duplicateShare: 0.1,
  websiteShare: 0.6,
  pagesPerSite: 3,
  usableShare: 0.5,
  googleCallsPerRecord: 0,
  googleSkuPer1000: 17,
  photoShare: 0,
  llmShare: 0,
};

export interface EstimateRow {
  businesses: number;
  dfsRequests: number;
  dfsRecords: number;
  dfsUsd: number;
  websiteRequests: number;
  googleUsd: number;
  photoUsd: number;
  llmUsd: number;
  totalUsd: number;
  usable: number;
  perUsableUsd: number;
}

/** Gross external cost for N unique businesses. Website requests have no vendor charge (compute only). */
export function estimateFor(n: number, a: EstimateAssumptions = DEFAULT_ASSUMPTIONS, p: Pricing = pricing()): EstimateRow {
  const perPage = Math.max(1, Math.round(a.pageSize * a.pageFullness));
  const rawNeeded = Math.ceil(n / (1 - a.duplicateShare));
  const dfsRequests = Math.max(1, Math.ceil(rawNeeded / perPage));
  const dfsRecords = rawNeeded;
  const dfsUsd = dfsRequests * p.dataforseo.businessListingsSearch.perRequestUsd + dfsRecords * p.dataforseo.businessListingsSearch.perItemUsd;
  const websiteRequests = Math.round(n * a.websiteShare * a.pagesPerSite);
  const googleUsd = (n * a.googleCallsPerRecord * a.googleSkuPer1000) / 1000;
  const photoUsd = (n * a.photoShare * p.google.placePhotoPer1000) / 1000;
  const llmUsd = n * a.websiteShare * a.llmShare * p.llm.perRecordUsd;
  const totalUsd = dfsUsd + googleUsd + photoUsd + llmUsd;
  const usable = Math.round(n * a.usableShare);
  return { businesses: n, dfsRequests, dfsRecords, dfsUsd, websiteRequests, googleUsd, photoUsd, llmUsd, totalUsd, usable, perUsableUsd: usable ? totalUsd / usable : 0 };
}

export const estimateTable = (a?: EstimateAssumptions) => [100, 1000, 10000].map(n => estimateFor(n, a));

/** Legacy Google grid estimate (kept for the old provider). */
export function estimateRun(scope: RunScope) {
  let nearby = 0;
  let text = 0;
  if (scope.nearby) {
    nearby += NEARBY_TYPES.length;
    for (const slug of scope.cities) {
      const b = cityBox(slug);
      if (b) nearby += tileBox(b, 2).length;
    }
    if (scope.all) nearby += tileBox(ISRAEL_BOX, 6).filter(boxTouchesIsrael).length;
  }
  if (scope.text) {
    const cities = scope.all ? CITIES.length : scope.cities.length;
    const queries = scope.categories.reduce((n, c) => n + (TEXT_QUERIES[c]?.length ?? 0), 0);
    text = cities * queries;
  }
  const min = nearby + text;
  const likely = Math.round(nearby * 1.8 + text * 1.6);
  const usd = Number(process.env.PLACES_USD_PER_1000 ?? 40);
  return { min, likely, usdMin: Math.round((min * usd) / 1000), usdLikely: Math.round((likely * usd) / 1000) };
}

/** Gross DataForSEO maximum for one run: every page at the configured size. */
export function dfsRunMaxUsd(recordLimit: number, pageSize: number, p: Pricing = pricing()): { pages: number; usd: number } {
  const pages = Math.max(1, Math.ceil(recordLimit / Math.min(pageSize, 1000)));
  const perItem = p.dataforseo.businessListingsSearch.perItemUsd;
  return { pages, usd: pages * p.dataforseo.businessListingsSearch.perRequestUsd + Math.min(recordLimit, pages * pageSize) * perItem };
}
