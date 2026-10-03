// Which category a business belongs to first. A record often carries several categories (Google's
// primary and additional types, categories the site's services imply), and the first one decides the
// profile address (/:region/:category/:slug) and the listing card. Google's "beauty salon" is generic,
// so it must not outrank a specific signal: a name that says מספרה, a Google type of hair_salon, or a
// price list full of haircuts makes a hair salon, whatever Google's first label was.

import { CATEGORIES } from '../catalog';

export interface CategoryEvidence {
  name: string;
  candidates: string[]; // our category slugs already on the record, in their current order
  googlePrimary?: string[]; // our slugs for Google's primary type
  googleAdditional?: string[]; // our slugs for Google's additional types
  googleGeneric?: boolean; // Google's primary type is a generic "beauty salon"
  services?: Record<string, { n: number; priced: number }>; // matched services per category
}

// What a business name says about its category. Specific words only; "יופי" and "beauty" say nothing.
const NAME_HINTS: Array<[RegExp, string]> = [
  [/מספר(?:ה|ות|ת)|עיצוב\s*שיער|סלון\s*שיער|ספרית|\bספר\b|תוספות\s*שיער|(?<![א-ת])החלק(?:ה|ות)(?![א-ת])|(?<![א-ת])פאות(?![א-ת])|hair\s*(salon|studio|design|stylist)|barber|coiffure|coiffeur|\bhair\b/i, 'hair-salons'],
  [/השתלת\s*שיער|hair\s*(transplant|restoration|clinic)/i, 'hair-restoration'],
  [/הסרת\s*שיער|לייזר\s*להסרת|laser\s*hair|hair\s*removal|waxing/i, 'hair-removal'],
  [/ציפורני|מניקור|פדיקור|\bnails?\b|manicure|pedicure/i, 'nails'],
  [/ריסים|גבות|\blash|\bbrow/i, 'brows-lashes'],
  [/איפור\s*קבוע|מיקרובליידינג|microblading|permanent\s*make/i, 'permanent-makeup'],
  [/מאפר|איפור(?!\s*קבוע)|make\s*-?up\s*(artist|studio)|\bmakeup\b/i, 'makeup'],
  [/כירורג(?:יה)?\s*פלסטי|מנתח\s*פלסטי|plastic\s*surg|cosmetic\s*surg/i, 'plastic-surgery'],
  [/אסתטיקה\s*רפואית|רפואה\s*אסתטית|בוטוקס|הזרקות|נגעי\s*עור|הסרת\s*שומות|נקודות\s*חן|medical\s*aesthetic|aesthetic\s*(clinic|medicine)|botox|filler/i, 'medical-aesthetics'],
  [/שיניים|דנטל|dental|\bdent(al|ist)\b|חיוך/i, 'dental-aesthetics'],
  [/\bספא\b|\bspa\b|מסאז|עיסוי|massage/i, 'spa-massage'],
  [/קוסמטי|טיפולי\s*פנים|facial|skin\s*care|skincare|esthetic|cosmet/i, 'facials'],
];

const order = new Map(CATEGORIES.map((c, i) => [c.slug, i]));

/** Categories that the name alone names, strongest first: the word that comes first in the name leads. */
export function categoriesFromName(name: string): string[] {
  const hits = new Map<string, number>();
  for (const [re, slug] of NAME_HINTS) {
    const m = re.exec(name);
    if (m && order.has(slug) && !hits.has(slug)) hits.set(slug, m.index);
  }
  return [...hits.entries()].sort((a, b) => a[1] - b[1]).map(([slug]) => slug);
}

/**
 * Orders the record's categories by evidence: the name (4 points per hit), Google's primary type (5, or 1
 * when generic), Google's additional types (2 per category, however many labels map to it), and the site's
 * services in that category (1 each, up to 5, plus 1 when any is priced). A category named by the business name or by three services joins even
 * when Google did not list it. Ties keep catalog order. Unknown slugs are dropped.
 */
export function rankCategories(e: CategoryEvidence): string[] {
  const score = new Map<string, number>();
  const bump = (slug: string, by: number) => {
    if (order.has(slug)) score.set(slug, (score.get(slug) ?? 0) + by);
  };
  for (const c of e.candidates) bump(c, 0.5); // present on the record
  for (const c of e.googlePrimary ?? []) bump(c, e.googleGeneric ? 1 : 5);
  for (const c of new Set(e.googleAdditional ?? [])) bump(c, 2);
  categoriesFromName(e.name).forEach((c, i) => bump(c, i === 0 ? 4 : 2));
  for (const [c, s] of Object.entries(e.services ?? {})) bump(c, Math.min(5, s.n) + (s.priced > 0 ? 1 : 0));
  const known = new Set(e.candidates.filter(c => order.has(c)));
  const own = (c: string) => {
    const i = e.candidates.indexOf(c);
    return i < 0 ? 1000 + order.get(c)! : i; // ties: the record's own order, then catalog order
  };
  return [...score.entries()]
    .filter(([c, s]) => known.has(c) || s >= 4)
    .sort((a, b) => b[1] - a[1] || own(a[0]) - own(b[0]))
    .map(([c]) => c);
}
