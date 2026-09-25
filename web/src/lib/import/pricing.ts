// Versioned provider prices, in USD. These are reference rates, not constants: verify them on the
// source pages before any live run, and override with IMPORT_PRICING_JSON (same shape) when they change.
// Costs are budgeted at the gross rate; free allowances are shared across the billing account and are
// shown only as a separate, optional estimate.

export interface Pricing {
  version: string;
  dataforseo: {
    businessListingsSearch: { perRequestUsd: number; perItemUsd: number };
    source: string;
    checked: string;
    note: string;
    minimumPaymentNote: string;
  };
  google: {
    // Place Details (New), per 1,000 calls, by the highest-tier field requested.
    placeDetailsPer1000: Record<GoogleSku, number>;
    placePhotoPer1000: number;
    source: string;
    checked: string;
    note: string;
  };
  llm: { perRecordUsd: number; note: string };
}

export type GoogleSku = 'essentials_ids_only' | 'essentials' | 'pro' | 'enterprise' | 'enterprise_atmosphere';

export const DEFAULT_PRICING: Pricing = {
  version: '2026-09-25',
  dataforseo: {
    businessListingsSearch: { perRequestUsd: 0.012, perItemUsd: 0.00036 },
    source: 'https://dataforseo.com/pricing/business-data/business-listings-api',
    checked: '2026-09-25',
    note: 'Reference rate supplied by the product owner on 2026-09-25. The pricing page was not reachable from the build environment; confirm before a live run.',
    minimumPaymentNote: 'DataForSEO requires a minimum account top-up (https://dataforseo.com/help-center/minimum-payment). Not included in per-run estimates.',
  },
  google: {
    placeDetailsPer1000: { essentials_ids_only: 0, essentials: 5, pro: 17, enterprise: 20, enterprise_atmosphere: 25 },
    placePhotoPer1000: 7,
    source: 'https://developers.google.com/maps/billing-and-pricing/pricing',
    checked: 'unverified',
    note: 'List prices recalled, not fetched (the pricing page was not reachable from the build environment). Confirm, including volume tiers and the monthly free usage per SKU, before enabling Google.',
  },
  llm: { perRecordUsd: 0.05, note: 'Rough gross estimate per website read by the optional LLM step; off by default.' },
};

export function pricing(): Pricing {
  const raw = process.env.IMPORT_PRICING_JSON;
  if (!raw) return DEFAULT_PRICING;
  try {
    const o = JSON.parse(raw) as Partial<Pricing>;
    return { ...DEFAULT_PRICING, ...o, dataforseo: { ...DEFAULT_PRICING.dataforseo, ...o.dataforseo }, google: { ...DEFAULT_PRICING.google, ...o.google } } as Pricing;
  } catch {
    return DEFAULT_PRICING;
  }
}

export const USD = 1_000_000; // micro-dollars per dollar
export const toMicros = (usd: number) => BigInt(Math.ceil(usd * USD));
export const fromMicros = (m: bigint | number) => Number(m) / USD;

/** Gross maximum for one DataForSEO search page: request fee plus a full page of items. */
export function dfsPageMaxUsd(limit: number, p: Pricing = pricing()): number {
  return p.dataforseo.businessListingsSearch.perRequestUsd + p.dataforseo.businessListingsSearch.perItemUsd * limit;
}
