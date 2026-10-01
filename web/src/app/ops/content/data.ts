import 'server-only';
import { CATEGORIES, CITIES, REGIONS } from '@/lib/catalog';
import { db } from '@/lib/server/db';
import { PUBLIC_WHERE } from '@/lib/server/public';
import { seoScore, sitePages, type SitePage } from '@/lib/server/seo';
import { ARTICLES } from '@/components/home/content';

// Content and SEO for /ops/content: the public pages with their effective metadata and score, the
// catalog categories with live counts, what the sitemap holds, and the profile analytics we collect
// ourselves (visitors who allowed analytics cookies). Search Console and GA4 are not connected.

export interface PageRow extends SitePage {
  title: string;
  description: string | null;
  keyword: string | null;
  noindex: boolean;
  overridden: boolean;
  score: number;
  notes: string[];
  updatedAt: Date | null;
}

export async function pageRows(): Promise<PageRow[]> {
  const pages = sitePages();
  const overrides = await db.pageSeo.findMany({ where: { path: { in: pages.map(p => p.path) } } }).catch(() => []);
  return pages.map(p => {
    const o = overrides.find(x => x.path === p.path);
    const title = o?.title || p.defaultTitle;
    const description = o?.description || p.defaultDescription;
    const keyword = o?.keyword || null;
    const noindex = o?.noindex ?? false;
    const sc = seoScore({ title, description, keyword, noindex, path: p.path });
    return { ...p, title, description, keyword, noindex, overridden: !!(o?.title || o?.description || o?.keyword || o?.noindex), score: sc.score, notes: sc.notes, updatedAt: o?.updatedAt ?? null };
  });
}

export const articles = () => ARTICLES;

export async function categoryRows() {
  const counts = await db.branchCategory.groupBy({ by: ['categorySlug'], where: { branch: PUBLIC_WHERE }, _count: true });
  return CATEGORIES.map(c => ({ ...c, live: counts.find(x => x.categorySlug === c.slug)?._count ?? 0 }));
}

export async function sitemapFacts() {
  const [branches, pairs, citiesWithListings] = await Promise.all([
    db.branch.count({ where: PUBLIC_WHERE }),
    db.branchCategory.findMany({ where: { branch: { ...PUBLIC_WHERE, cityId: { not: null } } }, select: { categorySlug: true, branch: { select: { city: { select: { slug: true } } } } } }),
    db.branch.findMany({ where: { ...PUBLIC_WHERE, cityId: { not: null } }, select: { city: { select: { slug: true } } }, distinct: ['cityId'] }),
  ]);
  const cityCats = new Set(pairs.map(p => `${p.branch.city!.slug}|${p.categorySlug}`)).size;
  const cityPages = citiesWithListings.filter(b => b.city && CITIES.some(c => c.slug === b.city!.slug && c.slug !== c.region)).length;
  const fixed = 3 + CATEGORIES.length + REGIONS.length + 6;
  return { branches, cityCats, cityPages, fixed, total: fixed + branches + cityCats + cityPages };
}

export async function analytics30() {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const prev = new Date(Date.now() - 60 * 86_400_000);
  const [byType, prevViews, topBranches] = await Promise.all([
    db.profileEvent.groupBy({ by: ['type'], where: { createdAt: { gte: since } }, _count: true }),
    db.profileEvent.count({ where: { type: 'view', createdAt: { gte: prev, lt: since } } }),
    db.profileEvent.groupBy({ by: ['branchId'], where: { type: 'view', createdAt: { gte: since } }, _count: true, orderBy: { _count: { branchId: 'desc' } }, take: 8 }),
  ]);
  const names = topBranches.length ? await db.branch.findMany({ where: { id: { in: topBranches.map(t => t.branchId) } }, select: { id: true, name: true, cityName: true, regionSlug: true, slug: true, categories: { select: { categorySlug: true, isPrimary: true } } } }) : [];
  const n = (t: string) => byType.find(x => x.type === t)?._count ?? 0;
  return {
    views: n('view'), prevViews, contacts: n('contact_click') + n('whatsapp_click') + n('call_click'), waze: n('waze_click'), bookingStarts: n('booking_start'), forms: n('form_submit'),
    top: topBranches.map(t => ({ count: t._count, branch: names.find(x => x.id === t.branchId) ?? null })),
  };
}

export const JSON_LD_TYPES = [
  { type: 'WebSite + SearchAction', where: 'דף הבית', note: 'תיבת חיפוש באתר בתוצאות Google' },
  { type: 'Organization', where: 'דף הבית, אודות', note: 'שם, לוגו וערוצי קשר של BeautyFind' },
  { type: 'BreadcrumbList', where: 'אזור, עיר, תחום, פרופיל עסק', note: 'פירורי לחם בתוצאות' },
  { type: 'FAQPage', where: 'תחומי טיפול, פרופיל עסק', note: 'שאלות ותשובות מהעמוד בלבד' },
  { type: 'BeautySalon / MedicalClinic + PostalAddress + OpeningHoursSpecification', where: 'פרופיל עסק', note: 'כתובת, שעות, טלפון; דירוג Google לעולם לא מוצג כדירוג BeautyFind' },
  { type: 'Service', where: 'תחומי טיפול', note: 'תיאור התחום והמחיר החציוני' },
];
