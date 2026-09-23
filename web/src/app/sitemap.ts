import type { MetadataRoute } from 'next';
import { CATEGORIES, CITIES, REGIONS, cityHref } from '@/lib/catalog';
import { db } from '@/lib/server/db';
import { PUBLIC_WHERE, profileHref } from '@/lib/server/public';
import { siteUrl } from '@/lib/server/site';

export const revalidate = 3600;

// Public, indexable pages only. City + category pages are listed only where live listings exist,
// so the sitemap never points crawlers at empty pages.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const u = (path: string, priority: number, changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] = 'weekly', lastModified?: Date) => ({
    url: base + path,
    priority,
    changeFrequency,
    ...(lastModified ? { lastModified } : {}),
  });

  const [branches, pairs] = await Promise.all([
    db.branch.findMany({ where: PUBLIC_WHERE, select: { slug: true, regionSlug: true, updatedAt: true } }),
    db.branchCategory.findMany({ where: { branch: { ...PUBLIC_WHERE, cityId: { not: null } } }, select: { categorySlug: true, branch: { select: { city: { select: { slug: true } } } } } }),
  ]);
  const cityCats = new Set(pairs.map(p => `${p.branch.city!.slug}|${p.categorySlug}`));
  const citiesWithListings = new Set(pairs.map(p => p.branch.city!.slug));

  return [
    u('/', 1, 'daily'),
    u('/treatments', 0.8),
    u('/regions', 0.7),
    ...CATEGORIES.map(c => u(`/treatments/${c.slug}`, 0.8)),
    ...REGIONS.map(r => u(`/${r.slug}`, 0.8, 'daily')),
    ...CITIES.filter(c => citiesWithListings.has(c.slug)).map(c => u(cityHref(c), 0.7, 'daily')),
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
}
