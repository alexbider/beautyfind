// Alt text for business images: the stored alt when the business or staff wrote one, otherwise the SEO
// name and the city ("{seoName} ב{city}") for the cover and card, and "{seoName}: {tag}" for gallery
// photos, numbered only when several share the same words.

import { normalizeHebrew } from '../import/textRules';
import { seoCityName, seoName } from './seoName';

export const coverAlt = (b: { name: string; cityName: string; coverAlt?: string | null }) => normalizeHebrew(b.coverAlt?.trim() || `${seoName(b.name)} ב${seoCityName(b.cityName)}`);

/** Gallery alts in order: stored alt, else "{seoName}: {tag}" with a running number only when the words repeat. */
export function galleryAlts(name: string, photos: Array<{ alt?: string | null; tag?: string | null }>, fallbackTag = 'תמונה'): string[] {
  const base = photos.map(g => normalizeHebrew(g.alt?.trim() || `${seoName(name)}: ${g.tag?.trim() || fallbackTag}`));
  const total = new Map<string, number>();
  for (const a of base) total.set(a, (total.get(a) ?? 0) + 1);
  const seen = new Map<string, number>();
  return base.map(a => {
    if ((total.get(a) ?? 0) < 2) return a;
    const n = (seen.get(a) ?? 0) + 1;
    seen.set(a, n);
    return `${a} ${n}`;
  });
}
