import type { Kpi } from '../charts/Charts';
import { dayMonthIL, monthIL, nf, signed } from '../charts/format';
import type { RangeKey } from './data';

// Copy and chart geometry per range (design RANGES / SERIES).

export const RANGE_TITLE: Record<RangeKey, string> = {
  30: 'שלושים הימים האחרונים',
  90: 'תשעים הימים האחרונים',
  365: 'השנה האחרונה',
};

/** Points on the traffic chart: 3-day, 6-day and roughly monthly buckets. */
export const SERIES_POINTS: Record<RangeKey, number> = { 30: 10, 90: 15, 365: 12 };

export const SERIES_NOTE: Record<RangeKey, string> = {
  30: 'נקודה כל שלושה ימים · צפיות מול פניות',
  90: 'נקודה כל שישה ימים · צפיות מול פניות',
  365: 'נקודה לכל חודש · צפיות מול פניות',
};

/** Five evenly spaced labels, oldest first (rendered right to left). */
export function seriesTicks(range: RangeKey, start: Date, end: Date) {
  const span = end.getTime() - start.getTime();
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(start.getTime() + (span * i) / 4);
    return range === 365 ? monthIL(d) : dayMonthIL(d);
  });
}

/** "+18%" style change against the previous period; null when there is nothing to compare with. */
export function change(cur: number, prev: number) {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** A KPI tile for a count, compared with the previous period of the same length. */
export function countKpi(label: string, cur: number, prev: number): Kpi {
  const d = change(cur, prev);
  if (d === null && cur === 0) return { label, value: '0', delta: '0%', tone: 'none', note: 'מול התקופה הקודמת' };
  if (d === null) return { label, value: nf(cur), delta: 'חדש', tone: 'up', note: 'אין נתון לתקופה הקודמת' };
  return { label, value: nf(cur), delta: signed(d), tone: d < 0 ? 'down' : 'up', note: 'מול התקופה הקודמת' };
}
