// Versioned provider prices, in USD. These are reference rates, not constants: verify them on the
// source pages before any live run, and override with IMPORT_PRICING_JSON (same shape) when they change.
// Costs are budgeted at the gross rate; free allowances are shared across the billing account and are
// shown only as a separate, optional estimate.

export interface Pricing {
  version: string;
  dataforseo: {
    businessListingsSearch: { perRequestUsd: number; perItemUsd: number };
    // Google business updates (posts with photos), per task. Unverified: reserved conservatively, the
    // cost DataForSEO reports is what is recorded.
    businessUpdates: { perTaskUsd: number };
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
  // Editorial writing per profile: one structured call on a compact evidence packet (about 3k input and
  // 1.5k output tokens) plus a 25% allowance for one repair call. Reserved at this gross rate; the
  // recorded cost comes from the tokens the API reports.
  editorial: { perProfileUsd: number; inputPer1MUsd: number; outputPer1MUsd: number; model: string; note: string };
  youtube: { quotaPerDay: number; note: string };
  mapsEmbed: { perLoadUsd: number; note: string };
  // ChatGPT (OpenAI): the research step (Responses API with web search) and, when chosen, the writer.
  openai: {
    model: string; // research and writer default (IMPORT_OPENAI_MODEL overrides)
    inputPer1MUsd: number;
    outputPer1MUsd: number;
    webSearchPer1kUsd: number; // per web search tool call
    research: { perRecordUsd: number; maxSearchCalls: number }; // gross hold per record
    source: string;
    checked: string;
    note: string;
  };
  // Apify actors, per item (place, profile, page). Reserved at twice the rate because most actors bill
  // per result plus platform usage; the recorded cost is the run's usageTotalUsd reported by Apify.
  apify: {
    actors: Record<'maps' | 'instagram' | 'facebook' | 'render', string>;
    maps: { perPlaceUsd: number };
    instagram: { perProfileUsd: number };
    facebook: { perPageUsd: number };
    render: { perPageUsd: number };
    reserveFactor: number;
    source: string;
    checked: string;
    note: string;
  };
}

export type GoogleSku = 'essentials_ids_only' | 'essentials' | 'pro' | 'enterprise' | 'enterprise_atmosphere';

export const DEFAULT_PRICING: Pricing = {
  version: '2026-09-25',
  dataforseo: {
    businessListingsSearch: { perRequestUsd: 0.012, perItemUsd: 0.00036 },
    businessUpdates: { perTaskUsd: 0.004 },
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
  editorial: {
    perProfileUsd: 0.06,
    inputPer1MUsd: 3,
    outputPer1MUsd: 15,
    model: 'claude-sonnet-5',
    note: 'Sonnet-class list prices recalled, not fetched. Override with IMPORT_PRICING_JSON and IMPORT_EDITORIAL_MODEL. Haiku 4.5 is several times cheaper for the same packet.',
  },
  youtube: { quotaPerDay: 10_000, note: 'YouTube Data API v3 default daily quota (units, no charge). oEmbed needs no key and no quota.' },
  mapsEmbed: { perLoadUsd: 0, note: 'Maps Embed API has no usage charge at the time of writing; needs its own browser key restricted to our domains.' },
  openai: {
    model: 'gpt-5-mini',
    inputPer1MUsd: 0.25,
    outputPer1MUsd: 2,
    webSearchPer1kUsd: 10,
    research: { perRecordUsd: 0.08, maxSearchCalls: 6 },
    source: 'https://openai.com/api/pricing',
    checked: 'unverified',
    note: 'OpenAI list prices recalled, not fetched: gpt-5-mini $0.25 per 1M input and $2 per 1M output tokens; web search tool calls about $10 per 1,000. A research call with up to six searches is held at $0.08 and settled from the reported usage. Confirm before a live run; override with IMPORT_PRICING_JSON and IMPORT_OPENAI_MODEL.',
  },
  apify: {
    actors: { maps: 'compass~crawler-google-places', instagram: 'apify~instagram-profile-scraper', facebook: 'apify~facebook-pages-scraper', render: 'apify~website-content-crawler' },
    maps: { perPlaceUsd: 0.004 },
    instagram: { perProfileUsd: 0.0025 },
    facebook: { perPageUsd: 0.004 },
    render: { perPageUsd: 0.002 },
    reserveFactor: 2,
    source: 'https://apify.com/pricing and each actor\'s page',
    checked: 'unverified',
    note: 'Apify Store rates recalled, not fetched (the pages were not reachable from the build environment): Google Maps Scraper about $4 per 1,000 places, Instagram Profile Scraper about $2.5 per 1,000 profiles, Facebook Pages Scraper about $4 per 1,000 pages, Website Content Crawler by compute (about $2 per 1,000 pages). Confirm on the actor pages before a live run; override with IMPORT_PRICING_JSON.',
  },
};

export function pricing(): Pricing {
  const raw = process.env.IMPORT_PRICING_JSON;
  if (!raw) return DEFAULT_PRICING;
  try {
    const o = JSON.parse(raw) as Partial<Pricing>;
    return {
      ...DEFAULT_PRICING, ...o,
      dataforseo: { ...DEFAULT_PRICING.dataforseo, ...o.dataforseo }, google: { ...DEFAULT_PRICING.google, ...o.google }, editorial: { ...DEFAULT_PRICING.editorial, ...o.editorial },
      apify: { ...DEFAULT_PRICING.apify, ...o.apify, actors: { ...DEFAULT_PRICING.apify.actors, ...o.apify?.actors } },
      openai: { ...DEFAULT_PRICING.openai, ...o.openai, research: { ...DEFAULT_PRICING.openai.research, ...o.openai?.research } },
    } as Pricing;
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

/** Gross per-item rate of an Apify actor. */
export function apifyItemUsd(kind: 'maps' | 'instagram' | 'facebook' | 'render', p: Pricing = pricing()): number {
  return kind === 'maps' ? p.apify.maps.perPlaceUsd : kind === 'instagram' ? p.apify.instagram.perProfileUsd : kind === 'facebook' ? p.apify.facebook.perPageUsd : p.apify.render.perPageUsd;
}

/** Cost of one editorial call from the tokens the API reported, at the writer's provider rates. */
export function editorialCostUsd(inputTokens: number, outputTokens: number, p: Pricing = pricing(), provider: 'anthropic' | 'openai' = 'anthropic'): number {
  const r = provider === 'openai' ? { inputPer1MUsd: p.openai.inputPer1MUsd, outputPer1MUsd: p.openai.outputPer1MUsd } : p.editorial;
  return (inputTokens * r.inputPer1MUsd + outputTokens * r.outputPer1MUsd) / 1_000_000;
}
