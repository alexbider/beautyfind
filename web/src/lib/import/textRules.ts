// Text rules for published Hebrew copy (descriptions, FAQs, summaries): no sentences about missing or
// unverified information, no generator language, no references to the page or the data, no Latin words
// inside Hebrew sentences (business and brand names excepted), no em dashes, no emoji, no empty quotes,
// and the house spellings. Pure, so the writer's checks, the cleanup script and the tests share it.

/** Phrases that mean "we did not have this" or that talk about the data instead of the business. */
export const MISSING_INFO_PATTERNS: RegExp[] = [
  /חבילת המידע/u, /בחבילת/u, /בדחיפה/u, /השדות והנתונים/u, /במקורות/u, /במידע שנבדק/u, /נכון לעת בדיקה/u,
  /שסופק/u, /לא צוינו/u, /לא צוין/u, /לא פורסמו/u, /לא פורסם/u, /לא נמצאו/u, /אין תיעוד/u, /אין מידע/u,
  /עמוד העסק כולל/u, /הפרופיל כולל/u, /תיאור זה/u, /''/u,
  // the same idea in other words
  /לא ידוע/u, /לא נמסר/u, /טרם פורסם/u, /טרם עודכן/u, /אין פירוט/u, /ללא פירוט/u, /לא זמין/u, /מידע חסר/u, /חסר מידע/u,
  /במידע שהתקבל/u, /בנתונים שהתקבלו/u, /על פי הנתונים/u, /לפי הנתונים/u, /הנתונים הזמינים/u, /המידע הזמין/u,
  /בעמוד זה/u, /בעמוד העסק/u, /בעמוד הזה/u, /בפרופיל זה/u, /בפרופיל העסק/u, /בכרטיס העסק/u, /בתיאור זה/u,
];

/** House spellings. */
export const SPELLING_PATTERNS: Array<{ re: RegExp; fix: string }> = [
  { re: /המצויין/gu, fix: 'המצוין' },
  { re: /מצויין/gu, fix: 'מצוין' },
  { re: /ווטסאפ|(?<![וא])וטסאפ/gu, fix: 'וואטסאפ' },
];

const DASH = /[–—]/u;
const EMOJI = /\p{Extended_Pictographic}/u;
const HEBREW = /[א-ת]/u;
const LATIN_WORD = /^[A-Za-z][A-Za-z'’.&-]*$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Brands that stay in Latin script inside Hebrew text. */
export const LATIN_BRANDS = ['beautyfind', 'google', 'waze', 'instagram', 'facebook', 'tiktok', 'youtube', 'whatsapp'];

export type TextProblem =
  | { code: 'missing_info'; match: string }
  | { code: 'latin'; match: string }
  | { code: 'dash'; match: string }
  | { code: 'emoji'; match: string }
  | { code: 'spelling'; match: string };

const strip = (t: string) => t.replace(/^[^A-Za-zא-ת0-9]+|[^A-Za-zא-ת0-9]+$/g, "");

/**
 * Latin words that sit between Hebrew words. A word is allowed when it is part of an allowed name (the
 * business name, its domain, a service or a team member as the packet spells them) or a known brand.
 */
export function latinInsideHebrew(text: string, allow: string[] = []): string[] {
  const allowed = new Set([...LATIN_BRANDS, ...allow.flatMap(a => a.toLowerCase().split(/[\s,/|()]+/).map(strip).filter(Boolean))]);
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    const tokens = line.split(/\s+/).filter(Boolean);
    // A run of consecutive non-Hebrew tokens ("Derech Raziel 5, Netanya") counts as one span: it is inside
    // Hebrew prose when a Hebrew word stands right before or right after it.
    let i = 0;
    while (i < tokens.length) {
      if (HEBREW.test(tokens[i])) {
        i++;
        continue;
      }
      let j = i;
      while (j < tokens.length && !HEBREW.test(tokens[j])) j++;
      const before = tokens[i - 1];
      const after = tokens[j];
      if ((before && HEBREW.test(before)) || (after && HEBREW.test(after))) {
        for (const raw of tokens.slice(i, j)) {
          const w = strip(raw);
          if (!LATIN_WORD.test(w) || w.length < 2 || DOMAIN.test(w) || allowed.has(w.toLowerCase())) continue;
          out.push(w);
        }
      }
      i = j;
    }
  }
  return [...new Set(out)];
}

/** Every rule the text breaks. Empty means the text may be published. */
export function textProblems(text: string, allow: string[] = []): TextProblem[] {
  const out: TextProblem[] = [];
  for (const re of MISSING_INFO_PATTERNS) {
    const m = text.match(re);
    if (m) out.push({ code: 'missing_info', match: m[0] });
  }
  for (const w of latinInsideHebrew(text, allow)) out.push({ code: 'latin', match: w });
  const d = text.match(DASH);
  if (d) out.push({ code: 'dash', match: d[0] });
  const e = text.match(EMOJI);
  if (e) out.push({ code: 'emoji', match: e[0] });
  for (const s of SPELLING_PATTERNS) {
    const m = text.match(s.re);
    if (m) out.push({ code: 'spelling', match: m[0] });
  }
  return out;
}

/** Hebrew typography that is safe to fix in place: ASCII quotes inside Hebrew words become gershayim and geresh, house spellings applied. */
export function normalizeHebrew(text: string): string {
  let t = text.replace(/([א-ת])"([א-ת])/gu, '$1״$2').replace(/([א-ת])'(?=[א-ת\s,.;:)]|$)/gu, '$1׳');
  for (const s of SPELLING_PATTERNS) t = t.replace(s.re, s.fix);
  return t;
}

/** Short codes for violation lists and reports: text:missing_info:לא פורסם */
export const problemCode = (p: TextProblem) => `text:${p.code}:${p.match}`;
