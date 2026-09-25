// How complete an imported record is against the listing template, and a factual fallback description.

import { CATEGORIES } from '../catalog';
import type { DayHours, ImportedTreatment } from './rules';

export interface TemplateInput {
  name: string;
  address: string;
  lat: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
  hours: unknown;
  logoUrl: string | null;
  photoUrls: string[];
  description: string | null;
  categories: string[];
  treatments: unknown;
  googleRating: number | null;
  accessible: boolean | null;
  freeParking: boolean | null;
  faqs: unknown;
}

export const TEMPLATE_FIELDS: Array<{ key: string; label: string; ok: (p: TemplateInput) => boolean }> = [
  { key: 'name', label: 'שם', ok: p => !!p.name.trim() },
  { key: 'location', label: 'כתובת ומיקום', ok: p => !!p.address && p.lat != null },
  { key: 'phone', label: 'טלפון', ok: p => !!p.phone },
  { key: 'email', label: 'דוא״ל', ok: p => !!p.email },
  { key: 'website', label: 'אתר או פרופיל', ok: p => !!p.website },
  { key: 'social', label: 'וואטסאפ או רשת חברתית', ok: p => !!(p.whatsapp || p.instagram || p.facebook) },
  { key: 'hours', label: 'שעות פתיחה', ok: p => Array.isArray(p.hours) && (p.hours as DayHours[]).some(d => d && !d.closed) },
  { key: 'logo', label: 'לוגו', ok: p => !!p.logoUrl },
  { key: 'cover', label: 'תמונת שער', ok: p => p.photoUrls.length > 0 },
  { key: 'gallery', label: 'גלריה (3 תמונות ומעלה)', ok: p => p.photoUrls.length >= 3 },
  { key: 'description', label: 'תיאור', ok: p => !!p.description && p.description.length >= 40 },
  { key: 'categories', label: 'תחומים', ok: p => p.categories.length > 0 },
  { key: 'services', label: 'טיפולים', ok: p => Array.isArray(p.treatments) && p.treatments.length > 0 },
  { key: 'prices', label: 'מחירים', ok: p => Array.isArray(p.treatments) && (p.treatments as ImportedTreatment[]).some(t => t.priceNis != null) },
  { key: 'rating', label: 'דירוג Google', ok: p => p.googleRating != null },
  { key: 'accessible', label: 'נגישות', ok: p => p.accessible != null },
  { key: 'parking', label: 'חניה', ok: p => p.freeParking != null },
  { key: 'faqs', label: 'שאלות נפוצות', ok: p => Array.isArray(p.faqs) && p.faqs.length > 0 },
];

export function completeness(p: TemplateInput): { score: number; missing: Array<{ key: string; label: string }> } {
  const missing = TEMPLATE_FIELDS.filter(f => !f.ok(p)).map(({ key, label }) => ({ key, label }));
  return { score: Math.round(((TEMPLATE_FIELDS.length - missing.length) / TEMPLATE_FIELDS.length) * 100), missing };
}

/**
 * A short, factual description built only from the record's own data (categories, city, services,
 * rating). Used when neither the Google profile nor the business's site gives one; the owner can
 * replace it after claiming.
 */
export function composeDescription(p: { name: string; cityName: string | null; categories: string[]; treatments: unknown; googleRating: number | null; googleReviewCount: number | null }): string | null {
  const cats = p.categories.map(c => CATEGORIES.find(x => x.slug === c)?.name).filter((x): x is string => !!x);
  if (!cats.length) return null;
  const where = p.cityName ? ` ב${p.cityName}` : '';
  const parts = [`${p.name} הוא עסק בתחום ${cats.slice(0, 3).join(', ')}${where}.`];
  const names = (Array.isArray(p.treatments) ? (p.treatments as ImportedTreatment[]) : []).map(t => t.name).filter(Boolean);
  if (names.length) parts.push(`בין השירותים: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ' ועוד' : ''}.`);
  if (p.googleRating != null && (p.googleReviewCount ?? 0) > 0) parts.push(`דירוג ${p.googleRating.toFixed(1)} ב־Google על סמך ${p.googleReviewCount} ביקורות.`);
  return parts.join(' ');
}
