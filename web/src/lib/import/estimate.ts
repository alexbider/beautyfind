// Rough Google cost of a run before it starts. Dense cities split cells into quarters, so the
// real count lands between the minimum and roughly twice it; the run's cap is the hard limit.

import { CITIES } from '../catalog';
import { NEARBY_TYPES, TEXT_QUERIES } from './categories';
import { boxTouchesIsrael, cityBox, ISRAEL_BOX, tileBox } from './geo';
import type { RunScope } from './rules';

/** USD per 1,000 Places calls with the fields we request. Check Google's current price list. */
export const USD_PER_1000 = Number(process.env.PLACES_USD_PER_1000 ?? 40);

export function estimateRun(scope: RunScope) {
  let nearby = 0;
  let text = 0;
  if (scope.nearby) {
    nearby += NEARBY_TYPES.length; // type check at the start
    for (const slug of scope.cities) {
      const b = cityBox(slug);
      if (b) nearby += tileBox(b, 2).length;
    }
    if (scope.all) nearby += tileBox(ISRAEL_BOX, 6).filter(boxTouchesIsrael).length;
  }
  if (scope.text) {
    const cities = scope.all ? CITIES.length : scope.cities.length;
    const queries = scope.categories.reduce((n, c) => n + (TEXT_QUERIES[c]?.length ?? 0), 0);
    text = cities * queries;
  }
  const min = nearby + text;
  const likely = Math.round(nearby * 1.8 + text * 1.6);
  return { min, likely, usdMin: Math.round((min * USD_PER_1000) / 1000), usdLikely: Math.round((likely * USD_PER_1000) / 1000) };
}
