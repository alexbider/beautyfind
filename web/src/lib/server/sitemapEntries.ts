import 'server-only';
import { CATEGORIES, CITIES, REGIONS, cityHref, cityPageHref, regionBySlug } from '@/lib/catalog';
import { articlePath } from '@/lib/articleHtml';
import { pathIndexable } from '@/lib/indexing';
import { db } from './db';
import { indexingPolicy } from './indexing';
import { PUBLIC_WHERE, profileHref } from './public';
import { publishDueArticles } from './articles';
import { sitePages } from './seo';
import { siteUrl } from './site';

// Every live, indexable URL with its type, title and last change: the source of /sitemap.xml and of the
// get_sitemap_urls tool, so the two can never disagree. Public, indexable pages only: what the indexing
// policy allows (src/lib/indexing.ts), minus pages and listings staff marked noindex. City + category
// pages are listed only where at least one live listing offers the category, so the sitemap never points
// crawlers at an empty page. Articles follow the content section switch and carry their updatedAt.

export type SitemapType = 'home' | 'treatments' | 'regions' | 'category' | 'region' | 'city' | 'cityCategory' | 'profile' | 'content' | 'legal' | 'magazine' | 'article';
export type ChangeFrequency = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';

export interface SitemapEntry {
  path: string;
  url: string;
  type: SitemapType;
  title: string;
  priority: number;
  changeFrequency: ChangeFrequency;
  lastModified: Date | null;
}

export async function sitemapEntries(): Promise<SitemapEntry[]> {
  const policy = await indexingPolicy();
  if (policy.staging || !policy.site) return [];
  const base = siteUrl();
  const u = (path: string, type: SitemapType, title: string, priority: number, changeFrequency: ChangeFrequency = 'weekly', lastModified: Date | null = null): SitemapEntry => ({
    path, url: base + encodeURI(path), type, title, priority, changeFrequency, lastModified, // Hebrew slugs are percent-encoded in <loc>
  });
  await publishDueArticles().catch(() => 0);
  const [branches, pairs, hidden, articles] = await Promise.all([
    db.branch.findMany({ where: { ...PUBLIC_WHERE, noindex: false }, select: { name: true, slug: true, regionSlug: true, updatedAt: true, categories: { select: { categorySlug: true, isPrimary: true } } } }),
    db.branchCategory.findMany({ where: { branch: { ...PUBLIC_WHERE, cityId: { not: null } } }, select: { categorySlug: true, branch: { select: { city: { select: { slug: true } } } } } }),
    db.pageSeo.findMany({ where: { noindex: true }, select: { path: true } }).catch(() => [] as Array<{ path: string }>),
    db.article.findMany({ where: { deletedAt: null, status: 'published', robots: { startsWith: 'index' } }, select: { slug: true, title: true, updatedAt: true, publishedAt: true }, orderBy: { publishedAt: 'desc' } }).catch(() => []),
  ]);
  const cityCats = new Set(pairs.map(p => `${p.branch.city!.slug}|${p.categorySlug}`));
  const citiesWithListings = new Set(pairs.map(p => p.branch.city!.slug));
  const noindex = new Set(hidden.map(h => h.path));
  const pages = new Map(sitePages().map(p => [p.path, p]));
  const fixed = (path: string, priority: number, freq: ChangeFrequency) => u(path, pages.get(path)?.kind === 'legal' ? 'legal' : 'content', pages.get(path)?.name ?? path, priority, freq);
  const latestArticle = articles.reduce<Date | null>((m, a) => (!m || a.updatedAt > m ? a.updatedAt : m), null);

  const entries: SitemapEntry[] = [
    u('/', 'home', 'BeautyFind', 1, 'daily'),
    u('/treatments', 'treatments', 'תחומי טיפול', 0.8),
    u('/regions', 'regions', 'אזורים', 0.7),
    ...CATEGORIES.map(c => u(`/treatments/${c.slug}`, 'category', c.name, 0.8)),
    ...REGIONS.map(r => u(`/${r.slug}`, 'region', r.name, 0.8, 'daily')),
    ...CITIES.filter(c => citiesWithListings.has(c.slug) && c.slug !== c.region).map(c => u(cityPageHref(c), 'city', c.name, 0.7, 'daily')),
    ...CITIES.flatMap(c => CATEGORIES.filter(cat => cityCats.has(`${c.slug}|${cat.slug}`)).map(cat => u(`${cityHref(c)}/${cat.slug}`, 'cityCategory', `${cat.name} ב${c.name}`, 0.6))),
    ...branches.map(b => u(profileHref(b), 'profile', `${b.name}${regionBySlug(b.regionSlug) ? `, ${regionBySlug(b.regionSlug)!.name}` : ''}`, 0.6, 'weekly', b.updatedAt)),
    fixed('/for-business', 0.6, 'monthly'),
    fixed('/about', 0.4, 'monthly'),
    fixed('/about/editorial', 0.3, 'monthly'),
    fixed('/about/methodology', 0.3, 'monthly'),
    fixed('/listing-standards', 0.3, 'monthly'),
    fixed('/listing-standards/sponsorship', 0.3, 'monthly'),
    fixed('/help', 0.4, 'monthly'),
    fixed('/contact', 0.3, 'monthly'),
    fixed('/privacy', 0.1, 'yearly'),
    fixed('/terms', 0.1, 'yearly'),
    fixed('/accessibility', 0.2, 'yearly'),
    // The magazine index is listed once it has something to list; its lastmod is the newest article.
    ...(articles.length ? [u('/magazine', 'magazine', 'המגזין', 0.6, 'weekly', latestArticle)] : []),
    ...articles.map(a => u(articlePath(a.slug), 'article', a.title, 0.6, 'monthly', a.updatedAt)),
  ];
  return entries.filter(e => pathIndexable(policy, e.path) && !noindex.has(e.path));
}
