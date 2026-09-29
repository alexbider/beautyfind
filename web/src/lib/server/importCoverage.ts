// Coverage rows for the import screen: the provider's total per city and category (import_coverage)
// joined with what the import has found and published there (import_places).

import type { CoverageCell } from '@/lib/import/coverageCounts';
import { db } from './db';

export async function loadCoverage(): Promise<CoverageCell[]> {
  const [totals, counts] = await Promise.all([
    db.importCoverage.findMany(),
    db.$queryRaw<Array<{ city: string; category: string; found: bigint; published: bigint }>>`
      SELECT p.city_slug AS city, c AS category,
             count(*) FILTER (WHERE p.status NOT IN ('rejected', 'duplicate')) AS found,
             count(*) FILTER (WHERE p.status IN ('approved', 'merged')) AS published
      FROM import_places p, unnest(p.categories) AS c
      WHERE p.city_slug IS NOT NULL
      GROUP BY p.city_slug, c`,
  ]);
  const map = new Map<string, CoverageCell>();
  const key = (city: string, category: string) => `${city}\u0000${category}`;
  for (const t of totals) map.set(key(t.citySlug, t.categorySlug), { city: t.citySlug, category: t.categorySlug, total: t.providerTotal, checkedAt: t.checkedAt.toISOString(), found: 0, published: 0 });
  for (const c of counts) {
    const k = key(c.city, c.category);
    const cur = map.get(k) ?? { city: c.city, category: c.category, total: null, checkedAt: null, found: 0, published: 0 };
    cur.found = Number(c.found);
    cur.published = Number(c.published);
    map.set(k, cur);
  }
  return [...map.values()];
}
