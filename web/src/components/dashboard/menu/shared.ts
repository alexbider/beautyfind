// Price menu: row shape, unit labels and validation, shared by the client editor and the server action.

import type { PriceType } from '@prisma/client';

/**
 * Unit labels from the design mapped to Treatment.priceType.
 * למפגש (per session) has no enum of its own; it uses `per_unit` (price per counted unit of the treatment).
 */
export const UNITS: Array<{ type: PriceType; label: string }> = [
  { type: 'fixed', label: 'לטיפול' },
  { type: 'per_unit', label: 'למפגש' },
  { type: 'per_area', label: 'לאזור' },
  { type: 'per_ml', label: 'למ״ל' },
  { type: 'from', label: 'החל מ־' },
  { type: 'package', label: 'לחבילה' },
  // No published price: the profile shows "המחיר לא פורסם" with a quote action. The price field stays empty.
  { type: 'on_request', label: 'לפי הצעת מחיר' },
];
export const PRICE_TYPES = UNITS.map(u => u.type) as [PriceType, ...PriceType[]];
export const unitLabel = (t: PriceType) => UNITS.find(u => u.type === t)?.label ?? 'לטיפול';

export const MAX_ROWS = 150;
export const MAX_PRICE_NIS = 200_000;

export interface MenuRow {
  /** Stable client key. Equals `id` for saved rows. */
  key: string;
  id: string | null;
  name: string;
  categorySlug: string | null;
  priceType: PriceType;
  /** Whole shekels as typed, before VAT. */
  price: string;
  /** Minutes as typed, optional. */
  duration: string;
  isPublished: boolean;
}

export type RowErrors = Partial<Record<'name' | 'price' | 'duration' | 'category', string>>;

export function parsePrice(v: string): number | null {
  const t = v.replace(/[,\s₪]/g, '');
  if (!/^\d{1,6}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= MAX_PRICE_NIS ? n : null;
}

export function parseDuration(v: string): number | null {
  const t = v.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= 600 ? n : null;
}

/** `allowedCats`: the branch's categories. A row may also keep the category it was saved with. */
export function validateMenu(rows: MenuRow[], allowedCats: string[], savedCats: Record<string, string | null> = {}) {
  const byKey: Record<string, RowErrors> = {};
  for (const r of rows) {
    const e: RowErrors = {};
    const name = r.name.trim();
    if (name.length < 2 || name.length > 120) e.name = 'נדרש שם טיפול, בין 2 ל־120 תווים';
    if (r.priceType === 'on_request' ? r.price.trim() !== '' : parsePrice(r.price) === null) e.price = r.priceType === 'on_request' ? 'לפי הצעת מחיר: השאירו את המחיר ריק' : 'מחיר בשקלים שלמים, גדול מאפס';
    if (r.duration.trim() && parseDuration(r.duration) === null) e.duration = 'משך בדקות, עד 600';
    if (r.categorySlug && !allowedCats.includes(r.categorySlug) && !(r.id && savedCats[r.id] === r.categorySlug)) {
      e.category = 'הקטגוריה אינה ברשימת הקטגוריות של העסק';
    }
    if (Object.keys(e).length) byKey[r.key] = e;
  }
  return { ok: Object.keys(byKey).length === 0 && rows.length <= MAX_ROWS, byKey };
}
