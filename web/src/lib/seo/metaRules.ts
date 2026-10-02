// What a meta description may say. The pattern for a business profile and a city + category page: what
// the business does (or what the page lists), the top two or three treatments in Hebrew, the rating with
// its review count when there is one, then a short action. Never a sentence about missing data, booking
// availability, contact channels or "phone only", never the "Google rating and BeautyFind reviews
// separately" line, 130 to 155 characters. Pure, shared by the page metadata, the writer's checks, the
// stored-override check and scripts/seo-verify.ts.

import { MISSING_INFO_EXTRA, MISSING_INFO_PATTERNS } from '../import/textRules';
import { DESCRIPTION_MAX, DESCRIPTION_MIN, composeDescription } from './meta';

export type MetaProblem = 'missing_info' | 'booking' | 'contact' | 'phone_only' | 'ratings_line' | 'short' | 'long';

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
export function metaDescriptionProblems(text: string, opts: { min?: number; max?: number } = {}): Array<{ code: MetaProblem; match: string }> {
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
  const len = [...t].length;
  if (len < (opts.min ?? DESCRIPTION_MIN)) out.push({ code: 'short', match: String(len) });
  if (len > (opts.max ?? DESCRIPTION_MAX)) out.push({ code: 'long', match: String(len) });
  return out;
}

/** True when the description follows the rules and sits within the length range. */
export const metaDescriptionOk = (text: string, opts?: { min?: number; max?: number }) => metaDescriptionProblems(text, opts).length === 0;

/** The closing action of a description: one short Hebrew sentence that is not a booking or contact claim. */
export const META_ACTION = 'השוו מחירים וביקורות ב־BeautyFind.';

/**
 * A description in the pattern: the lead (what the business is), its treatments, the rating line, then
 * the action, padded with the fillers when short. The treatment list shrinks (three, two, one, none)
 * until the action fits inside the range, so every description ends with the action.
 */
export function composeMetaDescription(input: { lead: string; treatments: string[]; moreTreatments?: boolean; rating?: string | null; fillers?: string[] }): string {
  let best = '';
  for (let n = input.treatments.length; n >= 0; n--) {
    const list = input.treatments.slice(0, n);
    const more = n > 0 && (input.moreTreatments || n < input.treatments.length);
    const text = composeDescription([input.lead, list.length ? `${list.join(', ')}${more ? ' ועוד' : ''}.` : null, input.rating ?? null, META_ACTION], input.fillers ?? []);
    if (!best) best = text;
    if (text.endsWith(META_ACTION) || text.includes(`${META_ACTION} `)) return text;
  }
  return best;
}
