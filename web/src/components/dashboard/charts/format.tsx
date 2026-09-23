// Number, date and Hebrew-plural helpers for the dashboard tabs (overview, analytics, billing).
// Anything that renders a number inside Hebrew text puts it in a `.ltr` span.

/** 1,284 style. */
export const nf = (n: number) => Math.round(n).toLocaleString('en-US');

/** Whole percent of part in whole, 0 when whole is 0. */
export const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** U+2212 minus, as the design prints negative deltas. */
export const signed = (n: number, suffix = '%') => (n > 0 ? `+${n}${suffix}` : n < 0 ? `−${Math.abs(n)}${suffix}` : `0${suffix}`);

export type Forms = { one: string; two: string; many: string };

/**
 * Hebrew singular / dual / plural, with the number in an isolated LTR span.
 * `many` is the noun phrase that follows the number: 5 → "5 ימים", 2 → "יומיים".
 */
export function Count({ n, ...f }: { n: number } & Forms) {
  if (n === 1) return <>{f.one}</>;
  if (n === 2) return <>{f.two}</>;
  return (
    <>
      <span className="ltr">{nf(n)}</span> {f.many}
    </>
  );
}

export const REVIEWS: Forms = { one: 'ביקורת אחת', two: 'שתי ביקורות', many: 'ביקורות' };
export const BRANCHES: Forms = { one: 'סניף אחד', two: 'שני סניפים', many: 'סניפים' };
export const TREATMENTS: Forms = { one: 'טיפול אחד', two: 'שני טיפולים', many: 'טיפולים' };
export const BUSINESSES: Forms = { one: 'עסק אחד', two: 'שני עסקים', many: 'עסקים' };

const TZ = 'Asia/Jerusalem';

/** 1.10.2026 in Israel time, as the design writes dates. */
export function dateIL(d: Date) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(d);
  const get = (t: string) => p.find(x => x.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}

/** 15.8 (day.month) in Israel time, for chart ticks. */
export function dayMonthIL(d: Date) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'numeric' }).formatToParts(d);
  const get = (t: string) => p.find(x => x.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}`;
}

const MONTHS_SHORT = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

/** Short Hebrew month name in Israel time (ספט׳, מרץ ...). */
export function monthIL(d: Date) {
  const m = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'numeric' }).format(d));
  return MONTHS_SHORT[m - 1] ?? '';
}
