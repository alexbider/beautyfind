// Consumer prices and VAT. Treatment prices are stored as the business published or entered them, with
// `taxIncluded` saying whether VAT is inside (null = not stated). With PRICES_INCLUDE_VAT on (the default)
// every public page shows the consumer price including VAT at the stored platform rate (/ops/settings,
// "מע״מ להצגה") and labels it "כולל מע״מ". BeautyFind's own subscription prices are not touched by this:
// they are billed without Israeli VAT (src/lib/pricing.ts).
//
// Open point for the lawyer: Israeli consumer price law requires the price shown to a consumer to include
// VAT. This module makes the site comply by default; the switch exists so the display can be turned back
// to "before VAT" with NEXT_PUBLIC_PRICES_INCLUDE_VAT=0 if the advice says otherwise.

import { PRICES_INCLUDE_VAT } from './features';
import { VAT_RATE } from './pricing';

export const DEFAULT_VAT_PCT = Math.round(VAT_RATE * 100);

export interface StoredPrice {
  priceAgorot: number | null;
  priceMaxAgorot?: number | null;
  taxIncluded?: boolean | null;
  source?: string | null;
}

/**
 * Whether a stored amount already includes VAT. A stated flag wins. Without one, a price the owner typed
 * in the menu editor is before VAT (the editor says so), and an imported consumer price list includes it
 * (Israeli consumer prices are quoted with VAT).
 */
export const storedIncludesVat = (t: Pick<StoredPrice, 'taxIncluded' | 'source'>): boolean => t.taxIncluded ?? t.source !== 'owner';

/** The amount to show a consumer, in agorot. */
export function consumerAgorot(agorot: number, t: Pick<StoredPrice, 'taxIncluded' | 'source'>, ratePct = DEFAULT_VAT_PCT): number {
  if (!PRICES_INCLUDE_VAT || storedIncludesVat(t)) return agorot;
  return Math.round(agorot * (1 + ratePct / 100));
}

/** The same treatment row with consumer amounts, flagged as including VAT when the display includes it. */
export function withConsumerPrices<T extends StoredPrice>(t: T, ratePct = DEFAULT_VAT_PCT): T {
  if (!PRICES_INCLUDE_VAT) return t;
  return {
    ...t,
    priceAgorot: t.priceAgorot != null ? consumerAgorot(t.priceAgorot, t, ratePct) : t.priceAgorot,
    priceMaxAgorot: t.priceMaxAgorot != null ? consumerAgorot(t.priceMaxAgorot, t, ratePct) : t.priceMaxAgorot,
    taxIncluded: true,
  };
}
