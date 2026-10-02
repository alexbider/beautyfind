// The <title> of a business profile: "{seoName} ב{city}: {short category} | BeautyFind", under 60
// characters with the brand. Deterministic, so every listing gets the same shape and a rewrite never
// drifts. The site's layout appends " | BeautyFind"; this module returns the part before it.

import { capWords, seoCityName, seoName } from './seoName';
import { BRAND_SUFFIX, TITLE_MAX } from './terms';

export { TITLE_MAX };

/** Letters only, lower case, for "does the name already say this" checks. */
const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9א-ת]+/g, ' ').trim();

/** The name already carries the city ("מספרת חיפה") or the category ("קליניקה לאסתטיקה רפואית"). */
export function nameSays(name: string, what: string | null | undefined): boolean {
  if (!what) return false;
  const n = ` ${bare(name)} `;
  const w = bare(what);
  if (!w) return false;
  if (n.includes(` ${w} `)) return true;
  // Hebrew prefixes (ב, ל, ה, ו) glued to the word: "בחיפה".
  if (new RegExp(`(^| )[בלהומכש]?${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(n)) return true;
  // A multi-word category: one of its distinctive words is enough (קוסמטיקה וטיפולי פנים -> קוסמטיקה).
  const words = w.split(' ').filter(x => x.length >= 5 && !['וטיפולי', 'טיפולי', 'ועיצוב', 'רפואית'].includes(x));
  return words.some(x => n.includes(` ${x} `) || n.includes(` ב${x} `) || n.includes(` ל${x} `) || n.includes(` ה${x} `));
}

/**
 * "{seoName} ב{city}: {category}", then without the category, then without the city, each tried until
 * the whole title with the brand suffix fits TITLE_MAX. The city and the category are skipped when the
 * name already says them, so "מספרת חיפה" never becomes "מספרת חיפה בחיפה".
 */
export function listingTitle(b: { name: string; city: string | null; category: string | null }, max = TITLE_MAX): string {
  const room = max - BRAND_SUFFIX.length;
  const name = seoName(b.name);
  const city = b.city && !nameSays(name, b.city) ? seoCityName(b.city.replace(/\s+/g, ' ').trim()) : null;
  const cat = b.category && !nameSays(name, b.category) ? b.category.trim() : null;
  const head = city ? `${name} ב${city}` : name;
  const tiers = [cat ? `${head}: ${cat}` : head, head, name];
  for (const t of tiers) if (t.length <= room) return t;
  return capWords(name, room) || name.slice(0, room);
}
