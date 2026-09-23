// Pure waitlist helpers shared by the join form, the offer page and the clinic queue.
// No 'server-only' marker: nothing here touches the database or secrets.

export type TimeRange = 'morning' | 'noon' | 'evening';
export type SpanKey = '2w' | '1m' | '2m';

/** Days 0..5 (Sunday..Friday). Shabbat is never offered. */
export const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'] as const;
export const DAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'] as const;

export const TIMES: { key: TimeRange; name: string; range: string; from: number; to: number }[] = [
  { key: 'morning', name: 'בוקר', range: '08–12', from: 8, to: 12 },
  { key: 'noon', name: 'צהריים', range: '12–16', from: 12, to: 16 },
  { key: 'evening', name: 'ערב', range: '16–20', from: 16, to: 20 },
];

export const SPANS: { key: SpanKey; name: string; days: number }[] = [
  { key: '2w', name: 'שבועיים', days: 14 },
  { key: '1m', name: 'חודש', days: 30 },
  { key: '2m', name: 'חודשיים', days: 61 },
];

export const isTimeRange = (v: unknown): v is TimeRange => TIMES.some(t => t.key === v);
export const isSpan = (v: unknown): v is SpanKey => SPANS.some(s => s.key === v);

/** Raw offer tokens are base64url (randomToken(24) = 32 chars). Checked before any DB lookup. */
export const OFFER_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
/** Signed entry ids for the leave link: 32 hex id + "." + 32 hex mac. */
export const ENTRY_TOKEN_RE = /^[0-9a-f]{32}\.[0-9a-f]{32}$/;

export const leavePath = (entryToken: string) => `/waitlist/leave/${entryToken}`;

/* ---------- Hebrew plurals ---------- */

/** 30 דקות. The hold is always ≥5 minutes, but keep the singular and dual forms right. */
export const plMinutes = (n: number) => (n === 1 ? 'דקה' : n === 2 ? 'שתי דקות' : `${n} דקות`);

export const plWaiting = (n: number) =>
  n === 0 ? 'אין ממתינות' : n === 1 ? 'ממתינה אחת' : n === 2 ? 'שתי ממתינות' : `${n} ממתינות`;

export const plMatching = (n: number) =>
  n === 0 ? 'אין ממתינה מתאימה.' : n === 1 ? 'ממתינה אחת מתאימה.' : n === 2 ? 'שתי ממתינות מתאימות.' : `${n} ממתינות מתאימות.`;

/** פנויה אחת · שתיים פנויות · N פנויות */
export const plFree = (n: number) => (n === 1 ? 'פנויה אחת' : n === 2 ? 'שתיים פנויות' : `${n} פנויות`);

/** היום · אתמול · לפני יומיים · לפני N ימים · לפני שבוע · לפני שבועיים · לפני N שבועות */
export function since(days: number): string {
  if (days < 1) return 'היום';
  if (days < 2) return 'אתמול';
  if (days < 3) return 'לפני יומיים';
  if (days < 7) return `לפני ${Math.floor(days)} ימים`;
  if (days < 14) return 'לפני שבוע';
  if (days < 21) return 'לפני שבועיים';
  return `לפני ${Math.floor(days / 7)} שבועות`;
}

/* ---------- Preferences ---------- */

/** Joins sorted indexes, collapsing consecutive runs with an en dash: [3,4] → ה׳–ו׳. */
function runs(idx: number[], label: (i: number) => string): string {
  const s = [...new Set(idx)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j - i >= 1 ? `${label(s[i])}–${label(s[j])}` : label(s[i]));
    i = j + 1;
  }
  return out.join(', ');
}

export function daysShort(days: number[]): string {
  const d = days.filter(x => x >= 0 && x <= 5);
  if (d.length === 6) return 'כל יום';
  return runs(d, i => DAY_SHORT[i]);
}

export function rangesShort(ranges: string[]): string {
  const idx = ranges.map(r => TIMES.findIndex(t => t.key === r)).filter(i => i >= 0);
  if (idx.length === 3) return 'כל שעה';
  return runs(idx, i => TIMES[i].name);
}

/** "ה׳–ו׳ · צהריים–ערב · שירן" as in the clinic queue. */
export const prefText = (e: { days: number[]; timeRanges: string[] }, practitioner: string | null) =>
  [daysShort(e.days), rangesShort(e.timeRanges), practitioner ?? 'כל מטפלת'].join(' · ');

/** "ימי ראשון, שני, בוקר או ערב" for the join confirmation. */
export function whenText(days: number[], ranges: string[]): string {
  const d = [...days].sort((a, b) => a - b).map(i => DAYS[i]);
  const r = TIMES.filter(t => ranges.includes(t.key)).map(t => t.name);
  return `${d.length === 1 ? 'יום' : 'ימי'} ${d.join(', ')}, ${r.join(' או ')}`;
}

/** Does an entry's preference cover a slot (Israel day of week and hour)? */
export function entryMatches(e: { days: number[]; timeRanges: string[]; practitionerId: string | null }, slot: { dow: number; hh: number; practitionerId: string | null }) {
  if (!e.days.includes(slot.dow)) return false;
  const inRange = e.timeRanges.some(r => {
    const t = TIMES.find(x => x.key === r);
    return !!t && slot.hh >= t.from && slot.hh < t.to;
  });
  return inRange && (!e.practitionerId || e.practitionerId === slot.practitionerId);
}

/** "S. Cohen" style for the clinic banner: first initial + last name. */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return full.trim();
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

/* ---------- Countdown ---------- */

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function clock(secondsLeft: number): string {
  const s = Math.max(0, Math.floor(secondsLeft));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

/** Spoken once a minute by the aria-live region. */
export function minutesLeftText(secondsLeft: number): string {
  const m = Math.ceil(Math.max(0, secondsLeft) / 60);
  if (m <= 0) return 'הזמן לשמירת התור עבר';
  return m === 1 ? 'נותרה דקה אחת לשמירת התור' : m === 2 ? 'נותרו שתי דקות לשמירת התור' : `נותרו ${m} דקות לשמירת התור`;
}
