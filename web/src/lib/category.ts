// The one place that decides a listing's primary category. The primary category sets the canonical
// profile address (/:region/:category/:slug), the category badge on cards, the ItemList and breadcrumb
// entries and which city + category page lists the business. Pure, so the sitemap, the scripts, the
// tests and the server code all agree.

import { CATEGORIES } from './catalog';

export type CategoryRef = string | { categorySlug: string; isPrimary?: boolean | null };

const ORDER = new Map(CATEGORIES.map((c, i) => [c.slug, i]));
const KNOWN = new Set(ORDER.keys());

const slugOf = (c: CategoryRef) => (typeof c === 'string' ? c : c.categorySlug);

/** Position in the catalog; unknown slugs sort last. */
export const catalogIndex = (slug: string) => ORDER.get(slug) ?? CATEGORIES.length;

/**
 * The listing's primary category: the row flagged primary; for an ordered list of slugs (an import
 * record) the first known one; for rows without a flag, catalog order. Null without categories.
 */
export function primaryCategory(cats: CategoryRef[] | undefined | null): string | null {
  const list = (cats ?? []).filter(c => KNOWN.has(slugOf(c)));
  if (list.length === 0) return null;
  const flagged = list.find(c => typeof c !== 'string' && c.isPrimary);
  if (flagged) return slugOf(flagged);
  if (list.every(c => typeof c === 'string')) return slugOf(list[0]);
  return [...list].sort((a, b) => catalogIndex(slugOf(a)) - catalogIndex(slugOf(b))).map(slugOf)[0];
}

/** The categories with the primary first and the rest in catalog order, so `[0]` is always the primary. */
export function orderCategories<T extends { categorySlug: string; isPrimary?: boolean | null }>(cats: T[]): T[] {
  const primary = primaryCategory(cats);
  return [...cats].sort((a, b) => Number(b.categorySlug === primary) - Number(a.categorySlug === primary) || catalogIndex(a.categorySlug) - catalogIndex(b.categorySlug));
}

/** /:region/:category/:slug; a listing without categories keeps /:region/biz/:slug. */
export const profileHref = (b: { regionSlug: string; slug: string; categories?: CategoryRef[] | null }) =>
  `/${b.regionSlug}/${primaryCategory(b.categories) ?? 'biz'}/${b.slug}`;

/**
 * Category rows to write when a listing's category set changes: the current primary stays primary when it is
 * still in the set, otherwise the first slug (the editor's or the business's order) becomes primary.
 */
export function withPrimary(slugs: string[], currentPrimary: string | null | undefined): Array<{ categorySlug: string; isPrimary: boolean }> {
  const list = [...new Set(slugs.filter(s => KNOWN.has(s)))];
  const primary = currentPrimary && list.includes(currentPrimary) ? currentPrimary : list[0];
  return list.map(categorySlug => ({ categorySlug, isPrimary: categorySlug === primary }));
}
