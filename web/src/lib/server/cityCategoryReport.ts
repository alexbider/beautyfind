import 'server-only';
import { CATEGORIES, CITIES } from '@/lib/catalog';
import { db } from './db';
import { PUBLIC_WHERE } from './public';

// How many businesses each city + category page lists, under the old rule (primary category only) and
// the current one (every business that offers the category), bucketed into empty, one business and two
// or more. One read over the live category rows, so the same numbers come from the script
// (scripts/seo-city-category-report.ts) and the preview route (/api/seo/city-category).

export interface CityCategoryBuckets {
  pages: number;
  empty: number;
  single: number;
  twoPlus: number;
}

export interface CityCategoryReport {
  at: string;
  liveBranches: number;
  /** All city + category combinations in the catalog. */
  pages: number;
  primaryOnly: CityCategoryBuckets;
  anyCategory: CityCategoryBuckets;
  /** Pages that were empty under the old rule and have content now. */
  filled: number;
  /** Pages with one business under the old rule and two or more now. */
  singleToMany: number;
  rows: Array<{ city: string; category: string; primary: number; any: number }>;
}

function buckets(counts: Map<string, number>, pages: number): CityCategoryBuckets {
  let single = 0;
  let twoPlus = 0;
  for (const n of counts.values()) {
    if (n === 1) single++;
    else if (n >= 2) twoPlus++;
  }
  return { pages, empty: pages - single - twoPlus, single, twoPlus };
}

export async function cityCategoryReport(): Promise<CityCategoryReport> {
  const [rows, liveBranches] = await Promise.all([
    db.branchCategory.findMany({ where: { branch: { ...PUBLIC_WHERE, cityId: { not: null } } }, select: { categorySlug: true, isPrimary: true, branch: { select: { city: { select: { slug: true } } } } } }),
    db.branch.count({ where: PUBLIC_WHERE }),
  ]);
  const known = new Set(CATEGORIES.map(c => c.slug));
  const primary = new Map<string, number>();
  const any = new Map<string, number>();
  for (const r of rows) {
    const city = r.branch.city?.slug;
    if (!city || !known.has(r.categorySlug)) continue;
    const key = `${city}|${r.categorySlug}`;
    any.set(key, (any.get(key) ?? 0) + 1);
    if (r.isPrimary) primary.set(key, (primary.get(key) ?? 0) + 1);
  }
  const pages = CITIES.length * CATEGORIES.length;
  let filled = 0;
  let singleToMany = 0;
  const out: CityCategoryReport['rows'] = [];
  for (const c of CITIES) {
    for (const cat of CATEGORIES) {
      const key = `${c.slug}|${cat.slug}`;
      const p = primary.get(key) ?? 0;
      const a = any.get(key) ?? 0;
      if (p === 0 && a > 0) filled++;
      if (p === 1 && a >= 2) singleToMany++;
      if (a > 0) out.push({ city: c.slug, category: cat.slug, primary: p, any: a });
    }
  }
  return { at: new Date().toISOString(), liveBranches, pages, primaryOnly: buckets(primary, pages), anyCategory: buckets(any, pages), filled, singleToMany, rows: out };
}
