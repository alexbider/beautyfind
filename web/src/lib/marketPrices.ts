// Market price ranges per treatment category: the research data behind the "טווחי מחירים בשוק" section of the
// /treatments/{category} pages. The seed is src/content/market-prices.json; staff edits live in the platform
// setting `marketPrices` and win over the seed. Pure helpers only (formats, scales, badges); the server read is
// in src/lib/server/marketPrices.ts.

import { z } from 'zod';
import seed from '@/content/market-prices.json';

export const CONFIDENCE = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export const MarketPriceItemSchema = z
  .object({
    label: z.string().trim().min(2).max(80),
    min: z.number().int().min(0).max(1_000_000),
    max: z.number().int().min(0).max(1_000_000).nullable(),
    unit: z.string().trim().min(1).max(40),
    medical: z.boolean().default(false),
    note: z.string().trim().max(160).optional(),
    // Staff only: never rendered on a public page, in page data or in schema.
    sources: z.array(z.string().max(80)).max(8).optional(),
    sourceYear: z.number().int().min(2000).max(2100).optional(),
    confidence: z.enum(CONFIDENCE).optional(),
  })
  .refine(i => i.max == null || i.max >= i.min, { message: 'המקסימום חייב להיות לפחות המינימום', path: ['max'] });

export const MarketPricesMetaSchema = z.object({
  version: z.number().int().min(1),
  updated: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM'),
  currency: z.literal('ILS'),
  includesVat: z.boolean(),
  title: z.string().min(2).max(60),
  intro: z.string().min(10).max(400),
  footnote: z.string().min(10).max(400),
  wideRangeLabel: z.string().min(2).max(30),
  wideRangeTooltip: z.string().min(5).max(200),
  medicalLabel: z.string().min(2).max(30),
});

export const MarketPricesSchema = z.object({
  meta: MarketPricesMetaSchema,
  categories: z.record(z.string(), z.array(MarketPriceItemSchema).max(40)),
});

export type MarketPriceItem = z.infer<typeof MarketPriceItemSchema>;
export type MarketPricesMeta = z.infer<typeof MarketPricesMetaSchema>;
export type MarketPrices = z.infer<typeof MarketPricesSchema>;
/** What a public page may see: the staff fields are gone. */
export type PublicPriceItem = Pick<MarketPriceItem, 'label' | 'min' | 'max' | 'unit' | 'medical' | 'note'>;

export const MARKET_PRICES_SEED: MarketPrices = MarketPricesSchema.parse(seed);

/** The units already in the data, in first-seen order, for the staff form's dropdown. */
export function marketPriceUnits(data: MarketPrices): string[] {
  const seen = new Set<string>();
  for (const items of Object.values(data.categories)) for (const i of items) seen.add(i.unit);
  return [...seen];
}

export const publicItems = (items: MarketPriceItem[]): PublicPriceItem[] =>
  items.map(({ label, min, max, unit, medical, note }) => ({ label, min, max, unit, medical, ...(note ? { note } : {}) }));

const NBSP = ' ';
const num = (n: number) => n.toLocaleString('en-US');

/**
 * The displayed price: "250–350 ₪" (en dash between the numbers, a non-breaking space before the sign),
 * "כ־10,000 ₪" when min equals max, "מ־20,000 ₪" when there is no max. `plain` uses an ordinary space (meta tags).
 */
export function priceText(item: Pick<PublicPriceItem, 'min' | 'max'>, opts: { plain?: boolean } = {}): string {
  const sp = opts.plain ? ' ' : NBSP;
  if (item.max == null) return `מ־${num(item.min)}${sp}₪`;
  if (item.max === item.min) return `כ־${num(item.min)}${sp}₪`;
  return `${num(item.min)}–${num(item.max)}${sp}₪`;
}

/** The same price for screen readers: "בין 1,500 ל־3,800 שקלים", "כ־10,000 שקלים", "החל מ־20,000 שקלים". */
export function priceSpeech(item: Pick<PublicPriceItem, 'min' | 'max'>): string {
  if (item.max == null) return `החל מ־${num(item.min)} שקלים`;
  if (item.max === item.min) return `כ־${num(item.min)} שקלים`;
  return `בין ${num(item.min)} ל־${num(item.max)} שקלים`;
}

/** A range whose top is more than 2.5 times its bottom gets the "טווח רחב" badge. */
export const isWideRange = (item: Pick<PublicPriceItem, 'min' | 'max'>) => item.max != null && item.min > 0 && item.max > 2.5 * item.min;

export interface Bounds {
  lo: number;
  hi: number;
  /** Log scale when the category's highest price is more than ten times its lowest. */
  log: boolean;
}

/** The track every bar of a category shares: the lowest min to the highest max (a missing max counts as its min). */
export function categoryBounds(items: Array<Pick<PublicPriceItem, 'min' | 'max'>>): Bounds {
  const lo = Math.max(1, Math.min(...items.map(i => i.min)));
  const hi = Math.max(lo, ...items.map(i => i.max ?? i.min));
  return { lo, hi, log: hi > 10 * lo };
}

/** Position on the track, 0 to 100, under the category's scale. */
export function trackPosition(value: number, b: Bounds): number {
  if (b.hi <= b.lo) return 0;
  const v = Math.min(b.hi, Math.max(b.lo, value));
  const t = b.log ? (Math.log(v) - Math.log(b.lo)) / (Math.log(b.hi) - Math.log(b.lo)) : (v - b.lo) / (b.hi - b.lo);
  return Math.round(t * 1000) / 10;
}

export type BarShape = { kind: 'dot'; at: number } | { kind: 'open'; from: number } | { kind: 'range'; from: number; to: number };

/** The bar of one row: a dot when min equals max, a segment fading to the end when there is no max, a segment otherwise. */
export function barShape(item: Pick<PublicPriceItem, 'min' | 'max'>, b: Bounds): BarShape {
  const from = trackPosition(item.min, b);
  if (item.max == null) return { kind: 'open', from };
  if (item.max === item.min) return { kind: 'dot', at: from };
  return { kind: 'range', from, to: trackPosition(item.max, b) };
}

/** "עודכן באוקטובר 2026" from the data's YYYY-MM. */
export function updatedLabel(updated: string): string {
  const [y, m] = updated.split('-').map(Number);
  const month = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  return `עודכן ב${month}`;
}

/** The current month as YYYY-MM (Israel), written to meta.updated when staff save. */
export function currentMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Jerusalem' }).formatToParts(now);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`;
}

/** Staff view: a row to re-check first (low confidence, or a source older than 2024). */
export const needsRecheck = (item: Pick<MarketPriceItem, 'confidence' | 'sourceYear'>) => item.confidence === 'low' || (item.sourceYear != null && item.sourceYear < 2024);

/** The first (most common) treatment of a category, for the one-line summaries on the index, region and city pages. */
export function headlineRange(data: MarketPrices, category: string): { label: string; text: string; plain: string } | null {
  const first = data.categories[category]?.[0];
  return first ? { label: first.label, text: priceText(first), plain: priceText(first, { plain: true }) } : null;
}
