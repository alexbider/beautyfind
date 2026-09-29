// The <title> of a business profile. Built to win the searches people make for the business itself:
// the exact business name first, then the city, then the main category and the words a searcher adds
// (prices, reviews, opening hours). Deterministic, so every listing gets the same shape and a rewrite
// never drifts. The site's layout appends " | BeautyFind".

export const TITLE_MAX = 60;

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
 * Title candidates from the fullest to the shortest; the first within `max` characters wins. The city
 * and the category are skipped when the name already contains them, so "מספרת חיפה" never becomes
 * "מספרת חיפה חיפה".
 */
export function listingTitle(b: { name: string; city: string | null; category: string | null }, max = TITLE_MAX): string {
  const name = b.name.replace(/\s+/g, ' ').trim();
  const city = b.city && !nameSays(name, b.city) ? b.city.replace(/\s+/g, ' ').trim() : null;
  const cat = b.category && !nameSays(name, b.category) ? b.category.trim() : null;
  const head = city ? `${name} ${city}` : name;
  const tiers = [
    cat ? `${head}: ${cat} | מחירים, ביקורות ושעות פתיחה` : `${head} | מחירים, ביקורות ושעות פתיחה`,
    cat ? `${head}: ${cat} | מחירים וביקורות` : `${head} | מחירים וביקורות`,
    cat ? `${head}: ${cat}` : `${head} | ביקורות`,
    head,
    name,
  ];
  for (const t of tiers) if (t.length <= max) return t;
  return name.slice(0, max).replace(/\s+\S*$/, '').trim() || name.slice(0, max);
}
