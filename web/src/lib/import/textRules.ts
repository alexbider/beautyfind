// Text rules for published Hebrew copy (descriptions, FAQs, summaries): no sentences about missing or
// unverified information, no generator language, no references to the page or the data, no record
// language (רשומה, מצוין, נרשם, מופיע כ), no street words in Latin script (St, Rd, Derech), no Latin
// words inside Hebrew sentences (business and brand names excepted), no em dashes, no emoji, no empty
// quotes, and the house spellings. Pure, so the writer's checks, the cleanup script and the tests share it.

/** Phrases that mean "we did not have this" or that talk about the data instead of the business (the brief's list). */
export const MISSING_INFO_PATTERNS: RegExp[] = [
  /חבילת המידע/u, /בחבילת/u, /בדחיפה/u, /השדות והנתונים/u, /במקורות/u, /במידע שנבדק/u, /נכון לעת בדיקה/u,
  /שסופק/u, /לא צוינו/u, /לא צוין/u, /לא פורסמו/u, /לא פורסם/u, /לא נמצאו/u, /אין תיעוד/u, /אין מידע/u,
  /עמוד העסק כולל/u, /הפרופיל כולל/u, /תיאור זה/u, /''/u,
];

/** The same idea in other words: the writer is held to these too; interface copy that names the profile is not. */
export const MISSING_INFO_EXTRA: RegExp[] = [
  /לא ידוע/u, /לא נמסר/u, /טרם פורסם/u, /טרם עודכן/u, /אין פירוט/u, /ללא פירוט/u, /לא זמין/u, /מידע חסר/u, /חסר מידע/u,
  /במידע שהתקבל/u, /בנתונים שהתקבלו/u, /על פי הנתונים/u, /לפי הנתונים/u, /הנתונים הזמינים/u, /המידע הזמין/u,
  /בעמוד זה/u, /בעמוד העסק/u, /בעמוד הזה/u, /בפרופיל זה/u, /בפרופיל העסק/u, /בכרטיס העסק/u, /בתיאור זה/u,
];

/**
 * Record language: words that describe a database row, a listing or a form instead of the business
 * ("ברשומה מצוין", "נרשמה כ", "מופיעה ב", "תוארו", "אינה מפרטת"). The text speaks about the business
 * directly ("הסלון מתמחה ב..."), never about a record, list or listing. JavaScript's \b does not bound
 * Hebrew letters, so each pattern carries its own Hebrew boundaries; common prefixes (ו, ש, ה, ב, כ, ל, מ)
 * are part of the match.
 */
export const RECORD_PATTERNS: RegExp[] = [
  /(?<![א-ת])(?:[ושבכלמ]?ה?)רשומ(?:ה|ת|ות)(?![א-ת])/u, // רשומה, ברשומה, ברשומת, הרשומות
  /(?<![א-ת])(?:[וש]|כש|ה)?(?:מצוין|מצוינ(?:ת|ים|ות))(?![א-ת])/u, // מצוין, מצוינת, שמצוין (the praise sense is generic anyway)
  /(?<![א-ת])(?:[וש]|כש|ה)?(?:מציין|מציינ(?:ת|ים|ות))(?![א-ת])/u, // מציין, מציינת
  /(?<![א-ת])(?:[וש]|כש)?(?:נרשם|נרשמ(?:ה|ו|ים|ות))(?![א-ת])/u, // נרשם, נרשמה, נרשמו
  // מופיע כ, מופיעה ב, מופיעים גם: a business or a service "appears" only in a record, so every form is out
  /(?<![א-ת])(?:[וש]|כש)?מופיע(?:ה|ים|ות)?(?![א-ת])/u,
  /(?<![א-ת])(?:[וש]|כש)?תואר(?:ו|ה)(?![א-ת])/u, // תוארו, תוארה
  /(?<![א-ת])(?:[וש]|כש|ה)?מתואר(?:ת|ים|ות)?(?![א-ת])/u, // מתואר כ
  /(?<![א-ת])אינ(?:ה|ו|ם|ן|נה)\s+מפרט(?:ת|ים|ות)?(?![א-ת])/u, // איננה מפרטת, אינה מפרטת, אינו מפרט
  /(?<![א-ת])(?:ו|ש)?אין\s+פירוט(?![א-ת])/u,
  /(?<![א-ת])לא\s+מפורט(?:ת|ים|ות)?(?![א-ת])/u,
];

/**
 * Street words in Latin script: an address that reached the text untranslated ("Herzl St 5", "Derech
 * Raziel", "Sderot Rothschild"). Addresses are written in Hebrew (src/lib/import/address.ts).
 */
export const LATIN_ADDRESS = /(?<![A-Za-z])(?:St|Rd|Ave|Blvd|Hwy|Street|Road|Avenue|Boulevard|Highway|Derech|Derekh|Rehov|Rechov|Rekhov|Sderot|Shderot|Sd|Kikar|Simtat|Shkhuna|Shikun)\.?(?![A-Za-z])/;

/**
 * Wording banned sitewide (templates, generated text and stored content alike): the formal fillers במידה ו,
 * הינו and its forms, אשר (כאשר and באשר are other words) and כמו כן; "אמצעי" in the sense of an average
 * (the word is ממוצע; "אמצעי יצירת קשר" is a different word); "דירוג Google" and "ב־Google" (בגוגל); the
 * old city spelling with an en dash; a shekel sign before the number ("180 ₪" is the house style); חציון.
 */
export const WORDING_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /(?<![א-ת])במידה\s+ו/u, label: 'במידה ו' },
  { re: /(?<![א-ת])(?:ו|ש|כש)?הינ(?:ו|ה|ם|ן)(?![א-ת])/u, label: 'הינו' },
  { re: /(?<![א-ת])(?:ו|ש)?אשר(?![א-ת])/u, label: 'אשר' },
  { re: /(?<![א-ת])כמו\s+כן(?![א-ת])/u, label: 'כמו כן' },
  { re: /(?<![א-ת])(?:ה?מחיר(?:ים)?|ה?דירוג(?:ים)?|ה?פער(?:ים)?|ה?עלות)\s+(?:Google\s+)?ה?אמצעי(?:ים|ת|ות)?(?![א-ת])/u, label: 'אמצעי' },
  { re: /דירוג\s+Google/u, label: 'דירוג Google' },
  { re: /ב[־-]Google(?![A-Za-z])/u, label: 'ב־Google' },
  { re: /תל אביב–יפו/u, label: 'תל אביב–יפו' },
  { re: /₪\s?\d/u, label: '₪ לפני המספר' },
  { re: /(?<![א-ת])(?:ו|ש|ה|ב|ל|מ)?חציו(?:ן|נ(?:י|ים|יים|ית|יות))(?![א-ת])/u, label: 'חציון' },
];

/** House spellings. */
export const SPELLING_PATTERNS: Array<{ re: RegExp; fix: string }> = [
  { re: /המצויין/gu, fix: 'המצוין' },
  { re: /מצויין/gu, fix: 'מצוין' },
  { re: /ווטסאפ|(?<![וא])וטסאפ/gu, fix: 'וואטסאפ' },
];

const DASH = /[–—]/u;
const EMOJI = /(?![©®™])\p{Extended_Pictographic}/u;
const HEBREW = /[א-ת]/u;
// Latin or Cyrillic: a word in either script inside Hebrew prose is foreign.
const LATIN_WORD = /^[A-Za-zЀ-ӿ][A-Za-zЀ-ӿ'’.&-]*$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Brands that stay in Latin script inside Hebrew text. */
export const LATIN_BRANDS = ['beautyfind', 'google', 'waze', 'instagram', 'facebook', 'tiktok', 'youtube', 'whatsapp'];

export type TextProblem =
  | { code: 'missing_info'; match: string }
  | { code: 'record'; match: string }
  | { code: 'address'; match: string }
  | { code: 'wording'; match: string }
  | { code: 'latin'; match: string }
  | { code: 'dash'; match: string }
  | { code: 'emoji'; match: string }
  | { code: 'spelling'; match: string };

const strip = (t: string) => t.replace(/^[^A-Za-zЀ-ӿא-ת0-9]+|[^A-Za-zЀ-ӿא-ת0-9]+$/g, '');

/**
 * Latin words that sit between Hebrew words. A word is allowed when it is part of an allowed name (the
 * business name, its domain, a service or a team member as the packet spells them) or a known brand.
 */
export function latinInsideHebrew(text: string, allow: string[] = []): string[] {
  const allowed = new Set([...LATIN_BRANDS, ...allow.flatMap(a => a.toLowerCase().split(/[\s,/|()]+/).map(strip).filter(Boolean))]);
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    // A maqaf glues a Hebrew prefix to a foreign word ("ב־BeautyFind", "ו־Microneedling"): the word is checked on its own.
    const tokens = line.split(/[\s־]+/).filter(Boolean);
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

/**
 * Every rule the text breaks. Empty means the text may be published. `strict: false` (interface copy, which
 * may name the profile and say "מצוין") keeps only the brief's missing-information list; the default adds
 * the writer's wider list, the record language and the Latin street words.
 */
export function textProblems(text: string, allow: string[] = [], opts: { strict?: boolean } = {}): TextProblem[] {
  const out: TextProblem[] = [];
  for (const re of opts.strict === false ? MISSING_INFO_PATTERNS : [...MISSING_INFO_PATTERNS, ...MISSING_INFO_EXTRA]) {
    const m = text.match(re);
    if (m) out.push({ code: 'missing_info', match: m[0] });
  }
  if (opts.strict !== false) {
    for (const re of RECORD_PATTERNS) {
      const m = text.match(re);
      if (m) out.push({ code: 'record', match: m[0].trim() });
    }
    const a = text.match(LATIN_ADDRESS);
    if (a) out.push({ code: 'address', match: a[0] });
  }
  // The banned wording applies to interface copy as well as to generated text.
  for (const w of WORDING_PATTERNS) {
    const m = text.match(w.re);
    if (m) out.push({ code: 'wording', match: w.label });
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

/**
 * Hebrew typography that is safe to fix in place, applied to every generated or stored Hebrew text before
 * it is published: a straight or curly double quote (or two single quotes) inside a Hebrew word becomes
 * gershayim (דוא"ל -> דוא״ל, אא"ג -> אא״ג, ד"ר -> ד״ר, ד''ר -> ד״ר), a straight or curly single quote
 * inside or at the end of a Hebrew word becomes a geresh (ג'ל -> ג׳ל, דק' -> דק׳), and the house
 * spellings are applied. Quotes around a word ("גזום") are left alone.
 */
export function normalizeHebrew(text: string): string {
  let t = text
    .replace(/([א-ת])(?:"|''|“|”|״)([א-ת])/gu, '$1״$2')
    .replace(/([א-ת])(?:'|‘|’)(?=[א-ת\s,.;:)!?]|$)/gu, '$1׳');
  for (const s of SPELLING_PATTERNS) t = t.replace(s.re, s.fix);
  return t;
}

/** A straight-quote abbreviation that normalizeHebrew would fix: ד"ר, דוא"ל, ג'ל, דק'. */
export const STRAIGHT_QUOTE_ABBREVIATION = /[א-ת](?:"|''|“|”)[א-ת]|[א-ת](?:'|‘|’)(?=[א-ת\s,.;:)!?]|$)/u;

/** Short codes for violation lists and reports: text:missing_info:לא פורסם */
export const problemCode = (p: TextProblem) => `text:${p.code}:${p.match}`;
