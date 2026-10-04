// Names and places as they go into <title>, meta descriptions and structured data. The stored business
// name is kept for display; the SEO name is the clean short form of it: no "| keywords" tails, no
// " - slogan" tails (a hyphen glued to one side counts too: " -מומחה", "- מומחה"), no keyword lists, no
// Latin or Cyrillic copy of a name that is also written in Hebrew ("מספרת רון | Ron Hair Salon"), capped
// at about 35 characters on a word boundary.

import { CATEGORIES } from '../catalog';
import { matchService } from '../import/services';
import { normalizeHebrew } from '../import/textRules';
import { CATEGORY_SHORT, SEO_TERM } from './terms';

export const SEO_NAME_MAX = 35;

const HEBREW = /[א-ת]/;
const LATIN = /[A-Za-z]/;
const CYRILLIC = /[Ѐ-ӿ]/;
/** A word in another script: Latin or Cyrillic. */
const FOREIGN = /[A-Za-zЀ-ӿ]/;

const words = (s: string) => s.split(/\s+/).filter(Boolean);
/** Kinds of business that stand alone before a separator ("מספרה - אנה"): kept together with the name after it. */
const GENERIC = new Set(['מספרה', 'מספרת', 'קוסמטיקאית', 'קוסמטיקה', 'קליניקה', 'קליניקת', 'סטודיו', 'מכון', 'סלון', 'ספא', 'מרפאה', 'מרפאת', 'ציפורניים', 'איפור', 'מאפרת', 'ספר']);
const letters = (s: string) => (s.match(/[A-Za-zא-תЀ-ӿ]/g) ?? []).length;

/** Cut at a word boundary so the result is at most `max` characters. */
export function capWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.5 ? cut.slice(0, at) : s.slice(0, max)).replace(/[\s,:;·|/-]+$/u, '').trim();
}

// Which Hebrew letters a Latin or Cyrillic initial is usually written with, for "is this the same name
// in another script" (Glow = גלואו, Rivky = רבקי, Анна = אנה). An initial match on most of the words of
// the shorter run is taken as the same name.
const INITIALS: Record<string, string> = {
  a: 'אע', b: 'ב', c: 'קסכצש', d: 'ד', e: 'אעי', f: 'פ', g: 'ג', h: 'הח', i: 'איע', j: 'גי', k: 'קכ', l: 'ל', m: 'מ', n: 'נ', o: 'אעו', p: 'פ', q: 'ק', r: 'ר', s: 'סשצז', t: 'טת', u: 'אוי', v: 'וב', w: 'ו', x: 'קז', y: 'י', z: 'ז',
  а: 'אע', б: 'ב', в: 'וב', г: 'ג', д: 'ד', е: 'איע', ё: 'י', ж: 'ז', з: 'ז', и: 'איע', й: 'י', к: 'קכ', л: 'ל', м: 'מ', н: 'נ', о: 'אעו', п: 'פ', р: 'ר', с: 'סשצ', т: 'טת', у: 'אוי', ф: 'פ', х: 'חה', ц: 'צ', ч: 'צ', ш: 'ש', щ: 'ש', э: 'אע', ю: 'יו', я: 'י',
};

const initialOf = (w: string) => (w.match(/[A-Za-zЀ-ӿ]/)?.[0] ?? '').toLowerCase();
const hebrewInitial = (w: string) => w.match(/[א-ת]/)?.[0] ?? '';

/**
 * Whether a run of Latin or Cyrillic words reads as the same name as a run of Hebrew words: the initial
 * of most words on the shorter side (at least two, or the one word when a side has only one) matches a
 * Hebrew word's initial, each Hebrew word used once.
 */
export function sameNameAcrossScripts(foreign: string[], hebrew: string[]): boolean {
  const f = foreign.filter(w => FOREIGN.test(w));
  const h = hebrew.filter(w => HEBREW.test(w));
  if (!f.length || !h.length) return false;
  const pool = h.map(hebrewInitial);
  let score = 0;
  for (const w of f) {
    const allowed = INITIALS[initialOf(w)] ?? '';
    const at = pool.findIndex(i => i && allowed.includes(i));
    if (at >= 0) {
      pool[at] = '';
      score++;
    }
  }
  const need = Math.max(Math.min(f.length, h.length) === 1 ? 1 : 2, Math.ceil(Math.max(f.length, h.length) * 0.6));
  return score >= need;
}

/**
 * The name for titles and schema. Steps, in order: take the part before "|", " / " or a hyphen with a
 * space on at least one side (when that part is in Latin or Cyrillic and a later part is the same name
 * in Hebrew, the Hebrew part wins); drop a keyword list (three or more comma-separated items keep only
 * the first); when the name carries a Latin or Cyrillic copy of its Hebrew words, keep the Hebrew; fix
 * the Hebrew typography; cap at SEO_NAME_MAX.
 */
export function seoName(raw: string, max = SEO_NAME_MAX): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return s;
  // "Name | keywords", "Name - slogan", "Name- slogan", "Name -slogan", "Name / city"
  const parts = s
    .split(/\s*\|+\s*|\s+\/\s+|\s+[-–—]\s*|\s*[-–—]\s+/u)
    .map(p => p.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    let head = parts[0];
    if (!HEBREW.test(head)) {
      const he = parts.slice(1).find(p => HEBREW.test(p) && sameNameAcrossScripts(words(head), words(p)));
      if (he) head = he;
    }
    // "מספרה - אנה עיצוב שיער": a lone generic word before the separator is the kind of business, not the name.
    if (words(head).length === 1 && GENERIC.has(head) && HEBREW.test(parts[1])) head = `${head} ${parts[1]}`;
    if (letters(head) >= 3) s = head;
  }
  // "קוסמטיקאית Genin cosmotology", "מאפרת דנה לוי": a leading profession word before the brand is not the name
  // (a title such as ד״ר or Dr stays). The word goes only when a name of at least three letters remains.
  const prof = s.match(/^(?:קוסמטיקאית|קוסמטיקאי|מאפרת|מאפר|ספרית|מניקוריסטית|פדיקוריסטית|מעצבת שיער|מעצב שיער|מעצבת גבות|מעצב גבות|קוסמטיקאית רפואית)\s+(.+)$/u);
  if (prof && letters(prof[1]) >= 3) s = prof[1].trim();
  // "ניילס-בניית ציפורניים": a hyphen with no spaces whose tail names a treatment or a field is a tail too.
  const glued = s.match(/^(.+?\S)-(\S.+)$/u);
  if (glued && letters(glued[1]) >= 3 && namesTreatment(glued[2])) s = glued[1].trim();
  // "Name, keyword, keyword, keyword"
  const list = s.split(/\s*,\s*/);
  if (list.length >= 3 && letters(list[0]) >= 3) s = list[0];
  // "מספרת רון שיער Ron Hair Salon", "Rivky Blau רבקי בלאו": the same name twice; keep the Hebrew when the
  // two scripts form separate runs and the foreign run reads as the Hebrew one. A single brand word in
  // another script inside a Hebrew name ("סטודיו Glow") stays.
  if (HEBREW.test(s) && FOREIGN.test(s)) {
    const ws = words(s);
    const he = ws.filter(w => HEBREW.test(w));
    const fo = ws.filter(w => FOREIGN.test(w) && !HEBREW.test(w));
    const heText = he.join(' ');
    const foText = fo.join(' ');
    const separateRuns = s === `${heText} ${foText}` || s === `${foText} ${heText}`;
    if (separateRuns && sameNameAcrossScripts(fo, he)) s = heText;
  }
  s = normalizeHebrew(s).replace(/^[\s"'״׳“”‘’]+|[\s"'״׳“”‘’.,;:]+$/gu, '');
  return capWords(s, max) || raw.slice(0, max);
}

// Words a treatment or field tail starts with: the catalog's field names plus the heads of common treatment phrases.
const FIELD_WORDS = new Set([
  ...CATEGORIES.flatMap(c => c.name.split(/[\s,]+/)), ...Object.values(CATEGORY_SHORT).flatMap(x => x.split(/[\s,]+/)), ...Object.values(SEO_TERM).flatMap(x => x.split(/[\s,]+/)),
  'בניית', 'עיצוב', 'הסרת', 'הרמת', 'הארכת', 'החלקת', 'החלקות', 'הלבנת', 'השתלת', 'השתלות', 'טיפול', 'טיפולי', 'טיפולים', 'מניקור', 'פדיקור', 'לק', 'איפור', 'קוסמטיקה', 'קוסמטיקאית', 'קוסמטיקס', 'ציפורניים', 'גבות', 'ריסים', 'שיער', 'מספרה', 'מספרת', 'ספא',
  'עיסוי', 'עיסויים', 'בוטוקס', 'לייזר', 'שעווה', 'פילינג', 'ניקוי', 'תספורת', 'תספורות', 'צבע', 'פן', 'קרטין', 'מיקרובליידינג', 'שיזוף', 'חיטוב', 'אסתטיקה', 'קליניקה', 'סטודיו', 'מכון', 'סלון', 'יופי', 'מאפרת', 'ביוטי', 'ניילס',
].filter(w => w.length >= 2));
/** The text starts with a treatment or field word ("בניית ציפורניים", "עיצוב גבות", "קוסמטיקה מתקדמת"). */
function namesTreatment(text: string): boolean {
  const first = text.split(/\s+/)[0];
  return FIELD_WORDS.has(first) || FIELD_WORDS.has(first.replace(/^[והבל]/u, '')) || !!matchService(first);
}

/** City names for titles, meta and schema: the display name keeps its en dash (תל אביב–יפו), the SEO form uses a plain hyphen. */
export const seoCityName = (name: string) => name.replace(/–/g, '-');

export { LATIN };
