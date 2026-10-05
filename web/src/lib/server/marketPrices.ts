import 'server-only';
import { MARKET_PRICES_SEED, publicItems, type MarketPrices, type PublicPriceItem } from '@/lib/marketPrices';
import { platformSettings } from './platformSettings';

// The market price ranges the public pages show: the platform setting when staff saved one, the seed otherwise.

export async function marketPrices(): Promise<MarketPrices> {
  const s = await platformSettings();
  return s.marketPrices ?? MARKET_PRICES_SEED;
}

/** One category for a public page: the meta block and the rows without the staff fields. */
export async function marketPricesFor(category: string): Promise<{ meta: MarketPrices['meta']; items: PublicPriceItem[] }> {
  const data = await marketPrices();
  return { meta: data.meta, items: publicItems(data.categories[category] ?? []) };
}
