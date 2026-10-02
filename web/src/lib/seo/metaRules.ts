// What a meta description may say. The pattern for a business profile and a city + category page: what
// the business does (or what the page lists), the top two or three treatments in Hebrew, the rating with
// its review count when there is one, then a short action. Never a sentence about missing data, booking
// availability, contact channels or "phone only", never the "Google rating and BeautyFind reviews
// separately" line, 130 to 155 characters. Pure, shared by the page metadata, the writer's checks, the
// stored-override check and scripts/seo-verify.ts.

import { MISSING_INFO_EXTRA, MISSING_INFO_PATTERNS } from '../import/textRules';
import { DESCRIPTION_MAX, DESCRIPTION_MIN, composeDescription } from './meta';

export type MetaProblem = 'missing_info' | 'booking' | 'contact' | 'phone_only' | 'ratings_line' | 'title_repeat' | 'short' | 'long';

/** Sentences about booking: whether, where or how a visit can be booked. */
export const BOOKING_PATTERNS: RegExp[] = [
  /קביעת\s*תור/u, /לקבוע\s*תור/u, /קבעו\s*תור/u, /קבע\s*תור/u, /הזמנת\s*תור/u, /להזמין\s*תור/u, /הזמינו\s*תור/u, /תור\s*אונליין/u, /תורים\s*אונליין/u, /לתאם\s*תור/u, /תיאום\s*תור/u, /תאמו\s*תור/u,
  /זימון\s*תור/u, /booking/i, /book\s*now/i, /appointment/i,
];

/** Contact channels: phone, WhatsApp, email, navigation, contact details, social accounts. */
export const CONTACT_PATTERNS: RegExp[] = [
  /טלפון/u, /בטלפון/u, /טלפוני/u, /וואטסאפ/u, /ווטסאפ/u, /whatsapp/i, /דוא[״"]ל/u, /אימייל/u, /מייל\b/u, /e-?mail/i, /ניווט/u, /נווטו/u, /\bwaze\b/i, /\bוויז\b/u, /פרטי\s*קשר/u, /פרטי\s*התקשרות/u, /יצירת\s*קשר/u, /צרו\s*קשר/u,
  /ליצור\s*קשר/u, /התקשרו/u, /חייגו/u, /פנייה\s*ישירה/u, /פנו\s*ישירות/u, /\bsms\b/i, /אינסטגרם/u, /instagram/i, /פייסבוק/u, /facebook/i, /\d{2,3}-?\d{7}/,
];

/** "Phone only" and its forms. */
export const PHONE_ONLY_PATTERNS: RegExp[] = [/טלפון\s*בלבד/u, /בטלפון\s*בלבד/u, /רק\s*בטלפון/u, /רק\s*טלפונית/u, /ללא\s*טלפון/u, /phone\s*only/i, /by\s*phone\s*only/i];

/** The line that was pasted into every directory description. */
export const RATINGS_LINE = /דירוג\s*Google\s*וביקורות\s*BeautyFind\s*בנפרד/u;

const first = (text: string, patterns: RegExp[]) => patterns.find(re => re.test(text));

/** Every rule the description breaks; empty means it may be published. */
export function metaDescriptionProblems(text: string, opts: { min?: number; max?: number; title?: string | null } = {}): Array<{ code: MetaProblem; match: string }> {
  const out: Array<{ code: MetaProblem; match: string }> = [];
  const t = text.replace(/\s+/g, ' ').trim();
  const add = (code: MetaProblem, re: RegExp | undefined) => {
    if (re) out.push({ code, match: t.match(re)?.[0] ?? '' });
  };
  add('missing_info', first(t, [...MISSING_INFO_PATTERNS, ...MISSING_INFO_EXTRA]));
  add('phone_only', first(t, PHONE_ONLY_PATTERNS));
  add('booking', first(t, BOOKING_PATTERNS));
  add('contact', first(t, CONTACT_PATTERNS));
  if (RATINGS_LINE.test(t)) out.push({ code: 'ratings_line', match: t.match(RATINGS_LINE)![0] });
  if (opts.title && repeatsTitle(t, opts.title)) out.push({ code: 'title_repeat', match: titleHead(opts.title) });
  const len = [...t].length;
  if (len < (opts.min ?? DESCRIPTION_MIN)) out.push({ code: 'short', match: String(len) });
  if (len > (opts.max ?? DESCRIPTION_MAX)) out.push({ code: 'long', match: String(len) });
  return out;
}

/** True when the description follows the rules and sits within the length range. */
export const metaDescriptionOk = (text: string, opts?: { min?: number; max?: number; title?: string | null }) => metaDescriptionProblems(text, opts).length === 0;

/** The closing action of a description: one short Hebrew sentence that is not a booking or contact claim. */
export const META_ACTION = 'השוו מחירים וביקורות ב־BeautyFind.';

/** The part of a title before the brand and before ":" ("מספרת רון בחיפה" of "מספרת רון בחיפה: מספרה | BeautyFind"). */
export const titleHead = (title: string) => title.replace(/\s*\|\s*BeautyFind\s*$/u, '').split(':')[0].replace(/\s+/g, ' ').trim();

/** A description that opens with the title's own words. */
export function repeatsTitle(description: string, title: string): boolean {
  const head = titleHead(title);
  if (head.length < 8) return false;
  const d = description.replace(/\s+/g, ' ').trim();
  return d.startsWith(head) || d.startsWith(head.replace(/^[בל]/u, ''));
}

/** "א, ב וג": a Hebrew list; a last item in another script takes a maqaf after the ו. */
export function joinHe(items: string[]): string {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  const last = list[list.length - 1];
  return `${list.slice(0, -1).join(', ')} ${/^[א-ת]/u.test(last) ? 'ו' : 'ו־'}${last}`;
}

/** "ב" glued to a Hebrew name, with a maqaf before a name in another script ("ב־Glow Clinic"). */
export const inHe = (name: string) => (/^[א-ת]/u.test(name) ? `ב${name}` : `ב־${name}`);

const KIND_WORDS = /^(מספרת|מספרה|סטודיו|קליניקה|קליניקת|מרפאה|מרפאת|ספא|מכון|סלון|בית|המרכז|מרכז|ד״ר|דר׳|פרופ׳)(?=\s|$)|\b(clinic|clinique|salon|studio|spa|nails|lab|center|centre|bar|dental|cosmetics)\b/iu;
/** "במספרת רון" for a name without a kind word; a name that carries one (מספרת רון, Glow Clinic) is used as is. */
const at = (kind: string, name: string) => (KIND_WORDS.test(name) ? inHe(name) : `ב${kind} ${name}`);

type Lead = (name: string, city: string, t: string) => string;

// The opening sentence per category, with treatments ({t} is the Hebrew list) and without, so the
// description leads with what the business offers in its city and no two categories share a shape.
const LEADS: Record<string, { withTreatments: Lead; without: Lead }> = {
  facials: { withTreatments: (n, c, t) => `טיפולי פנים ב${c}: ${t} אצל ${n}.`, without: (n, c) => `קוסמטיקה וטיפולי פנים ב${c} אצל ${n}.` },
  'medical-aesthetics': { withTreatments: (n, c, t) => `${t} ${at('קליניקת', n)} ב${c}, מרפאה לאסתטיקה רפואית.`, without: (n, c) => `${at('קליניקת', n)} ב${c}: הזרקות וטיפולי אסתטיקה רפואית.` },
  'plastic-surgery': { withTreatments: (n, c, t) => `ניתוחים אסתטיים ב${c}: ${t} אצל ${n}.`, without: (n, c) => `ניתוחים אסתטיים וכירורגיה פלסטית ב${c} אצל ${n}.` },
  'dental-aesthetics': { withTreatments: (n, c, t) => `אסתטיקה דנטלית ב${c}: ${t} ${at('מרפאת', n)}.`, without: (n, c) => `אסתטיקה דנטלית והלבנת שיניים ב${c} ${at('מרפאת', n)}.` },
  'hair-restoration': { withTreatments: (n, c, t) => `השתלות שיער וטיפול בנשירה ב${c}: ${t} ${inHe(n)}.`, without: (n, c) => `השתלות שיער וטיפול בנשירה ב${c} ${inHe(n)}.` },
  'hair-salons': { withTreatments: (n, c, t) => `${t} ${at('מספרת', n)} ב${c}.`, without: (n, c) => `תספורות, צבע ועיצוב שיער ${at('מספרת', n)} ב${c}.` },
  'hair-removal': { withTreatments: (n, c, t) => `הסרת שיער ב${c}: ${t} ${inHe(n)}.`, without: (n, c) => `הסרת שיער בלייזר ובשיטות נוספות ב${c} ${inHe(n)}.` },
  'brows-lashes': { withTreatments: (n, c, t) => `גבות וריסים ב${c}: ${t} ${at('סטודיו', n)}.`, without: (n, c) => `עיצוב גבות וטיפולי ריסים ב${c} ${at('סטודיו', n)}.` },
  makeup: { withTreatments: (n, c, t) => `איפור ב${c}: ${t} עם ${n}.`, without: (n, c) => `איפור מקצועי לאירועים ב${c} עם ${n}.` },
  'permanent-makeup': { withTreatments: (n, c, t) => `איפור קבוע ב${c}: ${t} ${at('סטודיו', n)}.`, without: (n, c) => `איפור קבוע ומיקרופיגמנטציה ב${c} ${at('סטודיו', n)}.` },
  nails: { withTreatments: (n, c, t) => `${t} ${at('סטודיו', n)} ב${c}.`, without: (n, c) => `מניקור, פדיקור ובניית ציפורניים ${at('סטודיו', n)} ב${c}.` },
  'spa-massage': { withTreatments: (n, c, t) => `${t} ${at('ספא', n)} ב${c}.`, without: (n, c) => `עיסויים וטיפולי ספא ${at('ספא', n)} ב${c}.` },
  'body-contouring': { withTreatments: (n, c, t) => `עיצוב וחיטוב הגוף ב${c}: ${t} ${inHe(n)}.`, without: (n, c) => `טיפולי עיצוב וחיטוב הגוף ב${c} ${inHe(n)}.` },
  tanning: { withTreatments: (n, c, t) => `שיזוף ב${c}: ${t} ${inHe(n)}.`, without: (n, c) => `שיזוף במיטה או בהתזה ב${c} ${inHe(n)}.` },
};
const DEFAULT_LEAD: { withTreatments: Lead; without: Lead } = { withTreatments: (n, c, t) => `${t} ${inHe(n)}, ${c}.`, without: (n, c) => `מכון יופי ב${c}: ${n}.` };

/** The opening sentence of a business description: what it offers (the treatments in Hebrew) in its city, phrased by category. */
export function metaLead(category: string | null | undefined, name: string, city: string, treatments: string[]): string {
  const lead = (category && LEADS[category]) || DEFAULT_LEAD;
  return treatments.length ? lead.withTreatments(name, city, joinHe(treatments)) : lead.without(name, city, '');
}

/**
 * A description in the pattern: one sentence that leads with what the business offers (the lead, built
 * from the treatments), the rating line, then the action; when the text is short, real facts are added
 * one by one. The treatment list shrinks (three, two, one, none) until the action fits inside the range,
 * so every description ends with the action.
 */
export function composeMetaDescription(input: { lead: (treatments: string[]) => string; treatments: string[]; rating?: string | null; facts?: string[] }): string {
  let best = '';
  for (let n = input.treatments.length; n >= 0; n--) {
    const text = composeDescription([input.lead(input.treatments.slice(0, n)), input.rating ?? null, META_ACTION], input.facts ?? []);
    if (!best) best = text;
    if (text.endsWith(META_ACTION) || text.includes(`${META_ACTION} `)) return text;
  }
  return best;
}
