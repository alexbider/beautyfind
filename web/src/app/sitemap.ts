import type { MetadataRoute } from 'next';
import { CATEGORIES, CITIES, REGIONS, cityHref, cityPageHref } from '@/lib/catalog';
import { pathIndexable } from '@/lib/indexing';
import { db } from '@/lib/server/db';
import { indexingPolicy } from '@/lib/server/indexing';
import { PUBLIC_WHERE, profileHref } from '@/lib/server/public';
import { siteUrl } from '@/lib/server/site';

export const revalidate = 3600;

// Public, indexable pages only: what the indexing policy allows (src/lib/indexing.ts), minus pages and
// listings staff marked noindex. City + category pages are listed only where live listings exist, so
// the sitemap never points crawlers at empty pages.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const policy = await indexingPolicy();
  if (policy.staging || !policy.site) return [];
  const base = siteUrl();
  type Entry = MetadataRoute.Sitemap[number] & { path: string };
  const u = (path: string, priority: number, changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] = 'weekly', lastModified?: Date): Entry => ({
    path,
    url: base + encodeURI(path), // Hebrew slugs are percent-encoded in <loc>
    priority,
    changeFrequency,
    ...(lastModified ? { lastModified } : {}),
  });

  const [branches, pairs, hidden] = await Promise.all([
    db.branch.findMany({ where: { ...PUBLIC_WHERE, noindex: false }, select: { slug: true, regionSlug: true, updatedAt: true, categories: { select: { categorySlug: true } } } }),
    db.branchCategory.findMany({ where: { branch: { ...PUBLIC_WHERE, cityId: { not: null } } }, select: { categorySlug: true, branch: { select: { city: { select: { slug: true } } } } } }),
    db.pageSeo.findMany({ where: { noindex: true }, select: { path: true } }).catch(() => [] as Array<{ path: string }>),
  ]);
  const cityCats = new Set(pairs.map(p => `${p.branch.city!.slug}|${p.categorySlug}`));
  const citiesWithListings = new Set(pairs.map(p => p.branch.city!.slug));
  const noindex = new Set(hidden.map(h => h.path));

  const entries: Entry[] = [
    u('/', 1, 'daily'),
    u('/treatments', 0.8),
    u('/regions', 0.7),
    ...CATEGORIES.map(c => u(`/treatments/${c.slug}`, 0.8)),
    ...REGIONS.map(r => u(`/${r.slug}`, 0.8, 'daily')),
    ...CITIES.filter(c => citiesWithListings.has(c.slug) && c.slug !== c.region).map(c => u(cityPageHref(c), 0.7, 'daily')),
    ...CITIES.flatMap(c => CATEGORIES.filter(cat => cityCats.has(`${c.slug}|${cat.slug}`)).map(cat => u(`${cityHref(c)}/${cat.slug}`, 0.6))),
    ...branches.map(b => u(profileHref(b), 0.6, 'weekly', b.updatedAt)),
    u('/for-business', 0.6, 'monthly'),
    u('/about', 0.4, 'monthly'),
    u('/about/editorial', 0.3, 'monthly'),
    u('/about/methodology', 0.3, 'monthly'),
    u('/listing-standards', 0.3, 'monthly'),
    u('/listing-standards/sponsorship', 0.3, 'monthly'),
    u('/help', 0.4, 'monthly'),
    u('/contact', 0.3, 'monthly'),
    u('/privacy', 0.1, 'yearly'),
    u('/terms', 0.1, 'yearly'),
    u('/accessibility', 0.2, 'yearly'),
  ];
  return entries.filter(e => pathIndexable(policy, e.path) && !noindex.has(e.path)).map(({ path: _path, ...e }) => e);
}
