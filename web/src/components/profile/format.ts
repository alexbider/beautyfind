// Pure helpers for the public Business Profile and Practitioner pages. Safe on server and client.
// Time is always Asia/Jerusalem; the week starts Sunday (index 0), as stored in Branch.hours.

import { nisFromAgorot } from '@/lib/format';

export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] as const;
const DAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export interface DayHours {
  open: string; // HH:MM
  close: string; // HH:MM
  closed: boolean;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Branch.hours JSON → exactly 7 entries (Sunday first), or null when the business never set hours. */
export function parseHours(json: unknown): DayHours[] | null {
  if (!Array.isArray(json) || json.length !== 7) return null;
  return json.map(d => {
    const o = (d ?? {}) as Record<string, unknown>;
    const open = typeof o.open === 'string' ? o.open : '';
    const close = typeof o.close === 'string' ? o.close : '';
    const closed = o.closed === true || !HHMM.test(open) || !HHMM.test(close);
    return { open, close, closed };
  });
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Day index (Sunday = 0) and minutes since midnight, in Asia/Jerusalem. */
export function jerusalemNow(now = new Date()): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day: Math.max(0, day), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export type OpenState = { open: boolean; label: string } | null;

/** "פתוח עד 19:00" / "סגור כרגע" / "סגור היום", as in the design. Null when hours are unknown. */
export function openState(hours: DayHours[] | null, now = new Date()): OpenState {
  if (!hours) return null;
  const { day, minutes } = jerusalemNow(now);
  const h = hours[day];
  if (h.closed) return { open: false, label: 'סגור היום' };
  const a = toMin(h.open);
  const b = toMin(h.close);
  const inside = b > a ? minutes >= a && minutes < b : minutes >= a || minutes < b; // overnight hours wrap
  return inside ? { open: true, label: `פתוח עד ${h.close}` } : { open: false, label: 'סגור כרגע' };
}

/** schema.org openingHoursSpecification, grouping consecutive days with identical hours. */
export function openingHoursSpec(hours: DayHours[] | null) {
  if (!hours) return undefined;
  const out: Array<{ '@type': 'OpeningHoursSpecification'; dayOfWeek: string | string[]; opens: string; closes: string }> = [];
  hours.forEach((h, i) => {
    if (h.closed) return;
    const last = out[out.length - 1];
    const prev = hours[i - 1];
    if (last && prev && !prev.closed && prev.open === h.open && prev.close === h.close) {
      last.dayOfWeek = [...(Array.isArray(last.dayOfWeek) ? last.dayOfWeek : [last.dayOfWeek]), DAY_EN[i]];
    } else {
      out.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: DAY_EN[i], opens: h.open, closes: h.close });
    }
  });
  return out.length ? out : undefined;
}

/** "ראשון עד חמישי" for a consecutive run of open days, otherwise a comma list. */
export function openDaysLabel(hours: DayHours[] | null): string | null {
  if (!hours) return null;
  const open = hours.map((h, i) => (h.closed ? -1 : i)).filter(i => i >= 0);
  if (open.length === 0) return null;
  if (open.length === 7) return 'כל ימות השבוע';
  const consecutive = open.every((d, k) => k === 0 || d === open[k - 1] + 1);
  if (consecutive && open.length >= 3) return `${DAY_NAMES[open[0]]} עד ${DAY_NAMES[open[open.length - 1]]}`;
  return open.map(i => DAY_NAMES[i]).join(', ');
}

// ---------- Relative dates (Hebrew singular / dual / plural) ----------

function unit(n: number, one: string, two: string, many: string) {
  if (n === 1) return one;
  if (n === 2) return two;
  return `${n} ${many}`;
}

/** "לפני שבועיים", "לפני 3 חודשים", "היום". */
export function relHe(date: Date, now = new Date()): string {
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'היום';
  if (days === 1) return 'אתמול';
  if (days < 7) return `לפני ${unit(days, 'יום', 'יומיים', 'ימים')}`;
  if (days < 30) return `לפני ${unit(Math.floor(days / 7), 'שבוע', 'שבועיים', 'שבועות')}`;
  if (days < 365) return `לפני ${unit(Math.floor(days / 30), 'חודש', 'חודשיים', 'חודשים')}`;
  return `לפני ${unit(Math.floor(days / 365), 'שנה', 'שנתיים', 'שנים')}`;
}

/** 16 בספטמבר 2026 */
export const longDateHe = (d: Date) => new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long', year: 'numeric' }).format(d);

/** 14/09/2026 */
export const shortDate = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

// ---------- Prices (before VAT) ----------

export type PriceType = 'fixed' | 'from' | 'per_unit' | 'per_ml' | 'per_area';

/** Hebrew text around the amount. The amount itself always renders in an LTR span. */
export function priceParts(type: PriceType, agorot: number): { pre: string; amount: string; post: string } {
  const amount = nisFromAgorot(agorot);
  switch (type) {
    case 'from':
      return { pre: 'החל מ־', amount, post: '' };
    case 'per_unit':
      return { pre: '', amount, post: ' ליחידה' };
    case 'per_ml':
      return { pre: '', amount, post: ' למ״ל' };
    case 'per_area':
      return { pre: '', amount, post: ' לאזור' };
    default:
      return { pre: '', amount, post: '' };
  }
}

export const priceText = (type: PriceType, agorot: number) => {
  const p = priceParts(type, agorot);
  return p.pre + p.amount + p.post;
};

// ---------- Contact links ----------

/** https://wa.me/9725… with a prefilled Hebrew message. */
export function waHref(e164: string, businessName: string): string {
  const text = `שלום ${businessName}, הגעתי אליכם דרך BeautyFind ואשמח לקבל פרטים.`;
  return `https://wa.me/${e164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

export const mapsHref = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
export const googleSearchHref = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

export function instagramHref(handle: string): string {
  const h = handle.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '');
  return `https://instagram.com/${encodeURIComponent(h)}`;
}

/** Display form of a website URL: no scheme, no www, no trailing slash. */
export const displayUrl = (url: string) => url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');

/** Two leading letters of the first two words, for the logo placeholder ("רוטשילד אסתטיקה" → "רא"). */
export function initials(name: string): string {
  // Titles aren't part of the name: "ד״ר נועה לוי" → "נל".
  const words = name.replace(/^\s*(ד["״]ר|פרופ['׳]?|dr\.?)\s+/i, '').replace(/[״"׳'.]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 2);
  return words[0][0] + words[1][0];
}

// ---------- People ----------

export type PractitionerProfession = 'doctor' | 'nurse' | 'cosmetician' | 'technician';

export const PROFESSION_NAME: Record<PractitionerProfession, string> = {
  doctor: 'רופא/ה',
  nurse: 'אח/ות מוסמך/ת',
  cosmetician: 'קוסמטיקאי/ת',
  technician: 'טכנאי/ת טיפולים',
};

export const isMedicalProfession = (p: string) => p === 'doctor' || p === 'nurse';

// ---------- Ratings ----------

/** Rounded to one decimal, shown with a dot (4.9). */
export const ratingText = (r: number) => (Math.round(r * 10) / 10).toFixed(1);
