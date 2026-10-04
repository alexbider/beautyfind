// Averages for the price and rating aggregates. The site shows a trimmed mean: prices beyond 1.5 times the
// interquartile range are left out, then the rest are averaged, and nothing is shown under three prices.
// Pure, shared by the pages, the dashboards and the tests (the SQL in src/lib/server/public.ts does the
// same for the category aggregates).

export const AVERAGE_MIN_PRICES = 3;

export function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** The values inside 1.5 times the interquartile range (Tukey's rule), as percentile_cont would place the quartiles. */
export function trimOutliers(xs: number[]): number[] {
  if (xs.length < 4) return [...xs];
  const s = [...xs].sort((a, b) => a - b);
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  const iqr = q3 - q1;
  return s.filter(x => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
}

/** The average after the outliers are removed; null under `min` values. */
export function trimmedMean(xs: number[], min = AVERAGE_MIN_PRICES): number | null {
  const kept = trimOutliers(xs);
  return kept.length >= min ? mean(kept) : null;
}
