// Search query understanding: spelling variants, city and treatment detection, light typo correction.
// Pure functions with no server imports, shared by the search page (which turns detected parts into
// visible filter chips) and the listing query (which matches the remaining words one by one).

import { CATEGORIES, CITIES, REGIONS, type RegionSlug } from '@/lib/catalog';

/** Everyday words people type, mapped to the catalog's treatment fields. Longest phrases win. */
const SYNONYMS: Record<string, string[]> = {
  nails: ["לק ג'ל", 'לק גל', 'לק', "ג'ל", 'מניקור', 'פדיקור', 'ציפורניים', 'ציפורן', 'בניית ציפורניים', 'מניקוריסטית', 'פדיקור רפואי', 'אקריל', 'פוליג\'ל', 'nails', 'manicure', 'pedicure'],
  'medical-aesthetics': ['בוטוקס', 'חומצה היאלורונית', 'היאלורונית', 'מילוי שפתיים', 'עיבוי שפתיים', 'מילוי קמטים', 'פילר', 'פילרים', 'הזרקות', 'רפואה אסתטית', 'אסתטיקה רפואית', 'מזותרפיה', 'סקינבוסטר', 'botox'],
  'plastic-surgery': ['ניתוח פלסטי', 'ניתוחים פלסטיים', 'מנתח פלסטי', 'כירורג פלסטי', 'כירורגיה פלסטית', 'הגדלת חזה', 'הרמת חזה', 'הקטנת חזה', 'ניתוח אף', 'שאיבת שומן', 'מתיחת בטן', 'מתיחת פנים', 'הרמת עפעפיים'],
  'dental-aesthetics': ['הלבנת שיניים', 'ציפוי שיניים', 'ציפויי חרסינה', 'למינייט', 'אסתטיקה דנטלית', 'רופא שיניים', 'רופאת שיניים', 'יישור שיניים'],
  'hair-restoration': ['השתלת שיער', 'השתלות שיער', 'נשירת שיער', 'נשירה'],
  'hair-salons': ['מספרה', 'מספרות', 'ספר', 'ברבר', 'ברברשופ', 'תספורת', 'תספורות', 'צבע לשיער', 'צביעת שיער', 'גוונים', 'החלקה', 'החלקת שיער', 'החלקה יפנית', 'קרטין', 'פן', 'תסרוקת', 'תסרוקות', 'עיצוב שיער', 'מעצב שיער', 'מעצבת שיער', 'barber', 'barbershop'],
  'hair-removal': ['הסרת שיער', 'הסרת שיער בלייזר', 'לייזר הסרת שיער', 'לייזר', 'אפילציה', 'שעווה', 'שעוות', 'אלקטרוליזה'],
  'brows-lashes': ['גבות', 'עיצוב גבות', 'ריסים', 'הרמת ריסים', 'הדבקת ריסים', 'תוספות ריסים', 'למינציה', 'למינציה לגבות', 'lashes', 'brows'],
  makeup: ['איפור', 'מאפרת', 'איפור כלות', 'איפור ערב', 'makeup'],
  'permanent-makeup': ['איפור קבוע', 'מיקרובליידינג', 'פודר גבות', 'גבות קבועות', 'שפתיים קבועות'],
  'spa-massage': ['ספא', 'עיסוי', 'עיסויים', "מסאז'", "מסאג'", 'מסאז', 'עיסוי שוודי', 'רפלקסולוגיה', 'spa', 'massage'],
  'body-contouring': ['חיטוב', 'חיטוב גוף', 'עיצוב גוף', 'הצרת היקפים', 'צלוליט', 'הקפאת שומן', 'הידוק עור'],
  tanning: ['שיזוף', 'שיזוף בהתזה', 'ספריי טן', 'מכון שיזוף', 'tanning'],
  facials: ['קוסמטיקה', 'קוסמטיקאית', 'קוסמטיקאיות', 'טיפול פנים', 'טיפולי פנים', 'ניקוי פנים', 'פילינג', 'אקנה', 'facial'],
};

/** Words that describe the search rather than narrow it ("the best salon near me"). */
const STOPWORDS = new Set(['ב', 'ל', 'ו', 'ה', 'של', 'עם', 'את', 'ליד', 'באזור', 'אזור', 'קרוב', 'הכי', 'טוב', 'טובה', 'מומלץ', 'מומלצת', 'מומלצים', 'זול', 'זולה', 'מכון', 'מכוני', 'קליניקה', 'קליניקות', 'סלון', 'יופי', 'טיפול', 'טיפולי', 'טיפולים', 'גברים', 'לגברים', 'נשים', 'לנשים', 'in', 'near', 'best']);

const APOS = /[\u05F3'\u2019\u2018`\u00B4]/g; // ׳ ' ’ ‘ ` ´
const QUOTES = /[\u05F4"\u201C\u201D]/g; // ״ " “ ”

/** One spelling for comparison: one apostrophe, one quote mark, spaces for dashes, lower case. */
export function normalizeQuery(s: string): string {
  return s
    .replace(APOS, "'")
    .replace(QUOTES, '"')
    .replace(/[\u05BE\-–—_/,.!?;:()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// City aliases: the catalog name, the short form before a dash (תל אביב-יפו → תל אביב), קרית/קריית.
const CITY_ALIASES: Array<{ alias: string; slug: string; region: RegionSlug }> = (() => {
  const out: Array<{ alias: string; slug: string; region: RegionSlug }> = [];
  const add = (alias: string, slug: string, region: RegionSlug) => {
    const a = normalizeQuery(alias);
    if (a && !out.some(o => o.alias === a)) out.push({ alias: a, slug, region });
  };
  for (const c of CITIES) {
    add(c.name, c.slug, c.region);
    const short = c.name.split(/[-\u05BE]/)[0];
    if (short !== c.name) add(short, c.slug, c.region);
    if (c.name.includes('קריית')) add(c.name.replace('קריית', 'קרית'), c.slug, c.region);
    add(c.slug.replace(/-/g, ' '), c.slug, c.region);
  }
  const tlv = CITIES.find(c => c.slug === 'tel-aviv');
  if (tlv) for (const a of ['ת"א', 'תא', 'תל אביב יפו', 'tlv']) add(a, tlv.slug, tlv.region);
  return out.sort((x, y) => y.alias.length - x.alias.length);
})();

const REGION_ALIASES: Array<{ alias: string; slug: RegionSlug }> = REGIONS.filter(r => !CITIES.some(c => c.slug === r.slug))
  .flatMap(r => [{ alias: normalizeQuery(r.name), slug: r.slug }, { alias: normalizeQuery('ה' + r.name), slug: r.slug }])
  .concat([{ alias: 'מרכז', slug: 'dan' as RegionSlug }])
  .sort((x, y) => y.alias.length - x.alias.length);

const SYN_LIST: Array<{ phrase: string; slug: string }> = Object.entries(SYNONYMS)
  .flatMap(([slug, list]) => list.map(p => ({ phrase: normalizeQuery(p), slug })))
  .concat(CATEGORIES.map(c => ({ phrase: normalizeQuery(c.name), slug: c.slug })))
  .sort((x, y) => y.phrase.length - x.phrase.length);

/** Every single word the site knows, for typo correction. */
const VOCAB: string[] = [...new Set([...SYN_LIST.map(s => s.phrase), ...CITY_ALIASES.map(c => c.alias)].flatMap(p => p.split(' ')).filter(w => w.length >= 5))];

function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Fix a word that is one or two letters away from a word the site knows (בוטקס → בוטוקס). */
function correctWord(w: string): string {
  if (w.length < 5 || VOCAB.includes(w) || /[a-z0-9]/.test(w)) return w;
  const max = w.length >= 8 ? 2 : 1;
  let best: { word: string; d: number } | null = null;
  for (const v of VOCAB) {
    const d = distance(w, v, max);
    if (d <= max && (!best || d < best.d)) best = { word: v, d };
  }
  return best ? best.word : w;
}

/** Find a phrase as whole words, optionally after one Hebrew prefix letter (ב/ל/ה/ו/מ). */
function findPhrase(text: string, phrase: string): RegExpExecArray | null {
  return new RegExp(`(^| )([בלהומ]?)${esc(phrase)}(?= |$)`).exec(text);
}

export interface Understood {
  q: string;
  city: string | null;
  region: RegionSlug | null;
  t: string | null;
}

/**
 * Split a free-text query into the parts the filters understand (city, region, treatment field) and the
 * words left to match. Filters the user already set are respected: nothing already chosen is overridden.
 */
export function understand(raw: string, have: { city: string | null; region: RegionSlug | null; t: string | null }): Understood {
  const norm = normalizeQuery(raw);
  let text = norm.split(' ').map(correctWord).join(' ');
  const fixed = text !== norm;
  let city: string | null = null;
  let region: RegionSlug | null = null;
  let t: string | null = null;
  const cut = (m: RegExpExecArray) => {
    text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  };

  if (!have.city) {
    for (const c of CITY_ALIASES) {
      if (have.region && c.region !== have.region) continue;
      const m = findPhrase(text, c.alias);
      if (m) { city = c.slug; region = c.region; cut(m); break; }
    }
  }
  if (!have.city && !city && !have.region) {
    for (const r of REGION_ALIASES) {
      const m = findPhrase(text, r.alias);
      if (m) { region = r.slug; cut(m); break; }
    }
  }
  if (!have.t) {
    for (const s of SYN_LIST) {
      const m = findPhrase(text, s.phrase);
      if (m) { t = s.slug; cut(m); break; }
    }
  }
  // Without a detected part the query stays as typed (only typo-corrected), so names still match.
  if (!city && !region && !t) return { q: fixed ? text : raw.trim(), city: null, region: null, t: null };
  const rest = text.split(' ').filter(w => w && !STOPWORDS.has(w)).join(' ');
  return { q: rest, city, region, t };
}

/**
 * The words of a query, each with the spellings worth matching: both apostrophe styles and none
 * (ג'ל, ג׳ל, גל), both quote styles (ד"ר, ד״ר), and the word without a leading prefix letter (בלייזר → לייזר).
 */
export function queryTokens(q: string): string[][] {
  const words = normalizeQuery(q).split(' ').filter(Boolean);
  const kept = words.filter(w => !STOPWORDS.has(w));
  return (kept.length ? kept : words).filter(w => w.length >= 2).map(w => {
    const forms = new Set<string>();
    const addForms = (x: string) => {
      forms.add(x);
      if (x.includes("'")) { forms.add(x.replace(/'/g, '\u05F3')); forms.add(x.replace(/'/g, '\u2019')); if (x.replace(/'/g, '').length >= 2) forms.add(x.replace(/'/g, '')); }
      if (x.includes('"')) { forms.add(x.replace(/"/g, '\u05F4')); forms.add(x.replace(/"/g, '')); }
    };
    addForms(w);
    if (/^[בלהומ]/.test(w) && w.length - 1 >= 4) addForms(w.slice(1));
    return [...forms];
  });
}

/**
 * Core terms of each treatment field. On the search page a field chip also lists businesses whose name or
 * published treatments use one of these terms, so a clinic that offers permanent makeup is found under
 * איפור קבוע even when its main category is cosmetics. Ambiguous words (פן, לייזר) are left out on purpose.
 */
const FIELD_TERMS: Record<string, string[]> = {
  nails: ['מניקור', 'פדיקור', 'לק', 'ציפורניים'],
  'medical-aesthetics': ['בוטוקס', 'היאלורונית', 'מילוי'],
  'plastic-surgery': ['ניתוח פלסטי', 'כירורגיה פלסטית'],
  'dental-aesthetics': ['הלבנת שיניים', 'ציפוי שיניים', 'ציפויי חרסינה'],
  'hair-restoration': ['השתלת שיער', 'השתלות שיער', 'נשירה'],
  'hair-salons': ['תספורת', 'צביעת שיער', 'צבע לשיער', 'החלקה', 'גוונים', 'מספרה'],
  'hair-removal': ['הסרת שיער', 'אפילציה', 'שעווה'],
  'brows-lashes': ['גבות', 'ריסים'],
  makeup: ['איפור ערב', 'איפור כלות', 'איפור מקצועי', 'מאפרת'],
  'permanent-makeup': ['איפור קבוע', 'מיקרובליידינג'],
  'spa-massage': ['ספא', 'עיסוי', 'מסאז', "מסאז'", 'מסאג׳'],
  'body-contouring': ['חיטוב', 'צלוליט', 'הצרת היקפים'],
  tanning: ['שיזוף'],
  facials: ['טיפול פנים', 'טיפולי פנים', 'ניקוי פנים', 'פילינג'],
};

export function fieldTerms(slug: string | null | undefined): string[] {
  return slug ? FIELD_TERMS[slug] ?? [] : [];
}
