import 'server-only';
import { Prisma, type RegionSlug } from '@prisma/client';
import { cache } from 'react';
import { BOOKING_LIVE } from '../features';
import { db } from './db';

// Read-only queries for public pages. Only live branches of live businesses are ever returned.
// Ratings: Google and BeautyFind are separate fields and are never averaged together (decision A4).

export const PUBLIC_WHERE: Prisma.BranchWhereInput = { status: 'live', business: { status: 'live' } };

export type Sort = 'recommended' | 'rating' | 'reviews' | 'price';

export interface ListingFilter {
  region?: RegionSlug;
  citySlug?: string;
  category?: string;
  q?: string; // free text: business name, city or treatment name
  verifiedOnly?: boolean;
  accessible?: boolean;
  freeParking?: boolean;
  onlineBooking?: boolean;
  maxPriceShekels?: number; // lowest published price must be at or below
  sort?: Sort;
  take?: number;
  skip?: number;
}

export interface ListingCard {
  id: string;
  slug: string;
  href: string; // /:region/biz/:slug
  name: string;
  regionSlug: RegionSlug;
  cityName: string;
  citySlug: string | null;
  categories: Array<{ slug: string; name: string; isMedical: boolean }>;
  coverUrl: string | null;
  coverAlt: string;
  verified: boolean; // business live and ownership verified
  google: { rating: number; count: number } | null;
  beautyfind: { rating: number; count: number } | null; // published verified reviews
  priceFromShekels: number | null; // lowest published treatment price, before VAT
  accessible: boolean;
  freeParking: boolean;
  onlineBooking: boolean;
  hasMedicalResponsible: boolean;
}

export const profileHref = (b: { regionSlug: string; slug: string }) => `/${b.regionSlug}/biz/${b.slug}`;

function where(f: ListingFilter): Prisma.BranchWhereInput {
  const and: Prisma.BranchWhereInput[] = [PUBLIC_WHERE];
  if (f.region) and.push({ regionSlug: f.region });
  if (f.citySlug) and.push({ city: { slug: f.citySlug } });
  if (f.category) and.push({ categories: { some: { categorySlug: f.category } } });
  if (f.verifiedOnly) and.push({ isClaimed: true });
  if (f.accessible) and.push({ accessible: true });
  if (f.freeParking) and.push({ freeParking: true });
  if (f.onlineBooking && BOOKING_LIVE) and.push({ onlineBooking: true });
  if (f.maxPriceShekels != null) and.push({ treatments: { some: { isPublished: true, priceAgorot: { lte: f.maxPriceShekels * 100 } } } });
  const q = f.q?.trim();
  if (q) {
    and.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { cityName: { contains: q, mode: 'insensitive' } },
        { treatments: { some: { isPublished: true, name: { contains: q, mode: 'insensitive' } } } },
        { categories: { some: { category: { name: { contains: q, mode: 'insensitive' } } } } },
      ],
    });
  }
  return { AND: and };
}

const CARD_INCLUDE = {
  city: { select: { slug: true } },
  categories: { include: { category: true } },
  treatments: { where: { isPublished: true }, select: { priceAgorot: true } },
  medicalResponsible: { select: { license: { select: { status: true } } } },
} satisfies Prisma.BranchInclude;

type CardRow = Prisma.BranchGetPayload<{ include: typeof CARD_INCLUDE }>;

async function reviewStats(branchIds: string[]) {
  if (branchIds.length === 0) return new Map<string, { rating: number; count: number }>();
  const rows = await db.review.groupBy({
    by: ['branchId'],
    where: { branchId: { in: branchIds }, status: 'published' },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return new Map(rows.map(r => [r.branchId, { rating: Math.round((r._avg.rating ?? 0) * 10) / 10, count: r._count._all }]));
}

function toCard(b: CardRow, stats: Map<string, { rating: number; count: number }>): ListingCard {
  const prices = b.treatments.map(t => t.priceAgorot);
  const cats = [...b.categories].sort((a, c) => a.category.sortOrder - c.category.sortOrder);
  return {
    id: b.id,
    slug: b.slug,
    href: profileHref(b),
    name: b.name,
    regionSlug: b.regionSlug,
    cityName: b.cityName,
    citySlug: b.city?.slug ?? null,
    categories: cats.map(c => ({ slug: c.categorySlug, name: c.category.name, isMedical: c.category.isMedical })),
    coverUrl: b.coverUrl,
    coverAlt: b.coverAlt ?? b.name,
    verified: b.isClaimed,
    google: b.googleRating != null ? { rating: b.googleRating, count: b.googleReviewCount ?? 0 } : null,
    beautyfind: stats.get(b.id) ?? null,
    priceFromShekels: prices.length ? Math.min(...prices) / 100 : null,
    accessible: b.accessible,
    freeParking: b.freeParking,
    onlineBooking: BOOKING_LIVE && b.onlineBooking,
    hasMedicalResponsible: b.medicalResponsible?.license?.status === 'verified',
  };
}

/**
 * Listing cards for search, directory, region and category pages.
 * "recommended" ranks verified listings first, then by Google rating and review volume.
 * Sponsored placement never affects this order (07-rules: sponsored excluded from ranking).
 */
export async function listBranches(f: ListingFilter = {}): Promise<{ total: number; items: ListingCard[] }> {
  const w = where(f);
  const take = Math.min(f.take ?? 12, 60);
  const skip = f.skip ?? 0;
  const orderBy: Prisma.BranchOrderByWithRelationInput[] =
    f.sort === 'rating'
      ? [{ googleRating: { sort: 'desc', nulls: 'last' } }, { googleReviewCount: { sort: 'desc', nulls: 'last' } }]
      : f.sort === 'reviews'
        ? [{ googleReviewCount: { sort: 'desc', nulls: 'last' } }]
        : [{ isClaimed: 'desc' }, { googleRating: { sort: 'desc', nulls: 'last' } }, { googleReviewCount: { sort: 'desc', nulls: 'last' } }];

  // Price sort needs the computed minimum, so sort in memory over the filtered set (bounded by the directory size per filter).
  if (f.sort === 'price') {
    const all = await db.branch.findMany({ where: w, include: CARD_INCLUDE, take: 500 });
    const stats = await reviewStats(all.map(b => b.id));
    const cards = all.map(b => toCard(b, stats)).sort((a, b) => (a.priceFromShekels ?? Infinity) - (b.priceFromShekels ?? Infinity));
    return { total: cards.length, items: cards.slice(skip, skip + take) };
  }

  const [total, rows] = await Promise.all([db.branch.count({ where: w }), db.branch.findMany({ where: w, include: CARD_INCLUDE, orderBy, take, skip })]);
  const stats = await reviewStats(rows.map(b => b.id));
  return { total, items: rows.map(b => toCard(b, stats)) };
}

/** Live listing counts per region, per city (slug) and per category (slug). */
export const listingCounts = cache(async () => {
  const [byRegion, byCity, byCat] = await Promise.all([
    db.branch.groupBy({ by: ['regionSlug'], where: PUBLIC_WHERE, _count: { _all: true } }),
    db.branch.groupBy({ by: ['cityId'], where: { ...PUBLIC_WHERE, cityId: { not: null } }, _count: { _all: true } }),
    db.branchCategory.groupBy({ by: ['categorySlug'], where: { branch: PUBLIC_WHERE }, _count: { _all: true } }),
  ]);
  const cities = await db.city.findMany({ select: { id: true, slug: true } });
  const citySlug = new Map(cities.map(c => [c.id, c.slug]));
  return {
    total: byRegion.reduce((n, r) => n + r._count._all, 0),
    region: Object.fromEntries(byRegion.map(r => [r.regionSlug, r._count._all])) as Partial<Record<RegionSlug, number>>,
    city: Object.fromEntries(byCity.map(r => [citySlug.get(r.cityId!)!, r._count._all])) as Record<string, number>,
    category: Object.fromEntries(byCat.map(r => [r.categorySlug, r._count._all])) as Record<string, number>,
  };
});

/**
 * Median published price per category (shekels, before VAT), optionally within a region.
 * Categories with fewer than 3 prices return null so a single outlier is never shown as "the" price.
 */
export async function medianPrices(region?: RegionSlug): Promise<Record<string, number | null>> {
  const rows = await db.$queryRaw<Array<{ slug: string; median: number | null; n: bigint }>>`
    SELECT t.category_slug AS slug,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY t.price_agorot) / 100.0 AS median,
           count(*) AS n
    FROM treatments t
    JOIN branches b ON b.id = t.branch_id
    JOIN businesses bz ON bz.id = b.business_id
    WHERE t.is_published AND t.category_slug IS NOT NULL
      AND b.status = 'live' AND bz.status = 'live'
      ${region ? Prisma.sql`AND b.region_slug = ${region}::"RegionSlug"` : Prisma.empty}
    GROUP BY t.category_slug`;
  return Object.fromEntries(rows.map(r => [r.slug, Number(r.n) >= 3 && r.median != null ? Math.round(Number(r.median) / 10) * 10 : null]));
}

export interface RecentReview {
  id: string;
  authorName: string;
  rating: number;
  body: string;
  treatmentName: string | null;
  createdAt: Date;
  verified: boolean; // tied to a booking that took place
  branchName: string;
  branchHref: string;
}

/** Newest published reviews of live listings, for the homepage. No rating filter: low scores show too. */
export async function recentReviews(take = 6): Promise<RecentReview[]> {
  const rows = await db.review.findMany({
    where: { status: 'published', branch: PUBLIC_WHERE },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true, authorName: true, rating: true, body: true, treatmentName: true, createdAt: true, bookingId: true,
      branch: { select: { name: true, slug: true, regionSlug: true } },
    },
  });
  return rows.map(r => ({
    id: r.id,
    authorName: r.authorName,
    rating: r.rating,
    body: r.body,
    treatmentName: r.treatmentName,
    createdAt: r.createdAt,
    verified: r.bookingId != null,
    branchName: r.branch.name,
    branchHref: profileHref(r.branch),
  }));
}

/** Full public profile by region + slug, or null (render 404). */
export const getProfile = cache(async (region: string, slug: string) => {
  const b = await db.branch.findFirst({
    where: { AND: [PUBLIC_WHERE, { slug, regionSlug: region as RegionSlug }] },
    include: {
      business: { select: { id: true, type: true, status: true } },
      city: true,
      region: true,
      categories: { include: { category: true } },
      treatments: { where: { isPublished: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { category: true } },
      medicalResponsible: { select: { id: true, displayName: true, profession: true, license: { select: { kind: true, number: true, status: true, specialty: true, verifiedAt: true } } } },
      reviews: { where: { status: 'published' }, orderBy: { createdAt: 'desc' }, take: 50 },
    },
  });
  if (!b) return null;
  const staff = await db.staffMember.findMany({
    where: { businessId: b.businessId, status: 'active', branchIds: { has: b.id }, profession: { in: ['doctor', 'nurse', 'cosmetician', 'technician'] } },
    select: { id: true, displayName: true, profession: true, license: { select: { kind: true, number: true, status: true, specialty: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const stats = (await reviewStats([b.id])).get(b.id) ?? null;
  return { ...b, staff, beautyfind: stats, href: profileHref(b) };
});

export type PublicProfile = NonNullable<Awaited<ReturnType<typeof getProfile>>>;
