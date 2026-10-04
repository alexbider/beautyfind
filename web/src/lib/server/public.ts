import 'server-only';
import { orderCategories, profileHref } from '../category';
import { Prisma, type RegionSlug } from '@prisma/client';
import { cache } from 'react';
import { BOOKING_LIVE, PRICES_INCLUDE_VAT } from '../features';
import { coverAlt } from '../seo/imageAlt';
import { seoName } from '../seo/seoName';
import { consumerAgorot } from '../vat';
import { db } from './db';
import { vatRatePct } from './vat';

// Read-only queries for public pages. Only live branches of live businesses are ever returned.
// Ratings: Google and BeautyFind are separate fields and are never averaged together (decision A4).

export const PUBLIC_WHERE: Prisma.BranchWhereInput = { status: 'live', business: { status: 'live' } };

export type Sort = 'recommended' | 'rating' | 'reviews' | 'price';

export interface ListingFilter {
  region?: RegionSlug;
  citySlug?: string;
  /** Any category the listing carries, primary or secondary; the primary ones come first in the recommended order. */
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
  href: string; // /:region/:category/:slug
  /** The SEO name (src/lib/seo/seoName.ts): the stored name without keyword tails, slogans or a foreign copy, Hebrew typography fixed. What cards, lists and structured data show. */
  name: string;
  /** The stored name in full, for the profile heading and the business schema's alternateName. */
  fullName: string;
  regionSlug: RegionSlug;
  cityName: string;
  citySlug: string | null;
  categories: Array<{ slug: string; name: string; isMedical: boolean }>;
  coverUrl: string | null;
  coverAlt: string;
  verified: boolean; // business live and ownership verified
  google: { rating: number; count: number } | null;
  beautyfind: { rating: number; count: number } | null; // published verified reviews
  priceFromShekels: number | null; // lowest published treatment price, as shown to consumers (src/lib/vat.ts)
  accessible: boolean;
  freeParking: boolean;
  onlineBooking: boolean;
  hasMedicalResponsible: boolean;
  /** A published treatment flagged isMedical: without a verified medical responsible the card shows the "טיפול רפואי" label. */
  hasMedicalTreatments: boolean;
}

// The primary category and the profile address come from one pure module (src/lib/category.ts), so the
// sitemap, the cards, the scripts and the tests all agree on which URL is canonical.
export { primaryCategory, profileHref } from '../category';

function where(f: ListingFilter): Prisma.BranchWhereInput {
  const and: Prisma.BranchWhereInput[] = [PUBLIC_WHERE];
  if (f.region) and.push({ regionSlug: f.region });
  if (f.citySlug) and.push({ city: { slug: f.citySlug } });
  // Every business that offers the category is listed, whether it is its primary category (the one in its
  // address) or a secondary one; listBranches puts the primary ones first.
  if (f.category) and.push({ categories: { some: { categorySlug: f.category } } });
  if (f.verifiedOnly) and.push({ isClaimed: true });
  if (f.accessible) and.push({ accessible: true });
  if (f.freeParking) and.push({ freeParking: true });
  if (f.onlineBooking && BOOKING_LIVE) and.push({ onlineBooking: true, isClaimed: true }); // booking exists only where an owner runs the listing
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
  treatments: { where: { isPublished: true }, select: { priceAgorot: true, priceType: true, taxIncluded: true, source: true, isMedical: true } },
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

function toCard(b: CardRow, stats: Map<string, { rating: number; count: number }>, vatPct: number): ListingCard {
  // "From" price: comparable published amounts only (no per-unit, per-ml, per-area or package totals, no unknown prices).
  const prices = b.treatments.filter(t => t.priceAgorot != null && t.priceAgorot > 0 && ['fixed', 'from', 'range'].includes(t.priceType)).map(t => consumerAgorot(t.priceAgorot as number, t, vatPct));
  const cats = orderCategories(b.categories); // [0] is the primary category, the one in the URL
  return {
    id: b.id,
    slug: b.slug,
    href: profileHref(b),
    name: seoName(b.name),
    fullName: b.name,
    regionSlug: b.regionSlug,
    cityName: b.cityName,
    citySlug: b.city?.slug ?? null,
    categories: cats.map(c => ({ slug: c.categorySlug, name: c.category.name, isMedical: c.category.isMedical })),
    coverUrl: b.coverUrl,
    coverAlt: coverAlt(b),
    verified: b.isClaimed,
    google: b.googleRating != null ? { rating: b.googleRating, count: b.googleReviewCount ?? 0 } : null,
    beautyfind: stats.get(b.id) ?? null,
    priceFromShekels: prices.length ? Math.min(...prices) / 100 : null,
    accessible: b.accessible,
    freeParking: b.freeParking,
    onlineBooking: BOOKING_LIVE && b.onlineBooking && b.isClaimed,
    hasMedicalResponsible: b.medicalResponsible?.license?.status === 'verified',
    hasMedicalTreatments: b.treatments.some(t => t.isMedical),
  };
}

/**
 * Listing cards for search, directory, region and category pages.
 * "recommended" ranks verified listings first, then by Google rating and review volume; with a category
 * filter, the businesses whose primary category it is come before those that offer it as a secondary one.
 * An explicit sort (rating, reviews, price) orders the whole list by that key alone.
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
  const vatPct = await vatRatePct();
  if (f.sort === 'price') {
    const all = await db.branch.findMany({ where: w, include: CARD_INCLUDE, take: 500 });
    const stats = await reviewStats(all.map(b => b.id));
    const cards = all.map(b => toCard(b, stats, vatPct)).sort((a, b) => (a.priceFromShekels ?? Infinity) - (b.priceFromShekels ?? Infinity));
    return { total: cards.length, items: cards.slice(skip, skip + take) };
  }

  // Recommended order with a category: the primary-category businesses form the first block of the list
  // and the secondary-category ones the second, each block in the recommended order, paged as one list.
  if (f.category && (f.sort ?? 'recommended') === 'recommended') {
    const primaryMatch: Prisma.BranchWhereInput = { categories: { some: { categorySlug: f.category, isPrimary: true } } };
    const wPrimary: Prisma.BranchWhereInput = { AND: [w, primaryMatch] };
    const wSecondary: Prisma.BranchWhereInput = { AND: [w, { NOT: primaryMatch }] };
    const [total, nPrimary] = await Promise.all([db.branch.count({ where: w }), db.branch.count({ where: wPrimary })]);
    const rows = skip < nPrimary ? await db.branch.findMany({ where: wPrimary, include: CARD_INCLUDE, orderBy, take, skip }) : [];
    const need = take - rows.length;
    if (need > 0) rows.push(...(await db.branch.findMany({ where: wSecondary, include: CARD_INCLUDE, orderBy, take: need, skip: Math.max(0, skip - nPrimary) })));
    const stats = await reviewStats(rows.map(b => b.id));
    return { total, items: rows.map(b => toCard(b, stats, vatPct)) };
  }

  const [total, rows] = await Promise.all([db.branch.count({ where: w }), db.branch.findMany({ where: w, include: CARD_INCLUDE, orderBy, take, skip })]);
  const stats = await reviewStats(rows.map(b => b.id));
  return { total, items: rows.map(b => toCard(b, stats, vatPct)) };
}

/** Cards for the given ids, in that order (ids that are not public are dropped). */
export async function cardsByIds(ids: string[]): Promise<ListingCard[]> {
  if (!ids.length) return [];
  const [rows, vatPct] = await Promise.all([db.branch.findMany({ where: { AND: [PUBLIC_WHERE, { id: { in: ids } }] }, include: CARD_INCLUDE }), vatRatePct()]);
  const stats = await reviewStats(rows.map(b => b.id));
  const byId = new Map(rows.map(b => [b.id, toCard(b, stats, vatPct)]));
  return ids.map(id => byId.get(id)).filter((c): c is ListingCard => !!c);
}

/**
 * The closest public listings to a point, by straight-line distance (equirectangular, fine at city scale),
 * excluding the listing itself and any ids already shown. Listings without coordinates never appear.
 */
export async function nearbyBranches(from: { id: string; lat: number; lng: number }, take = 6, exclude: string[] = []): Promise<ListingCard[]> {
  const skip = [from.id, ...exclude];
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT b.id
    FROM branches b
    JOIN businesses bz ON bz.id = b.business_id
    WHERE b.status = 'live' AND bz.status = 'live' AND b.lat IS NOT NULL AND b.lng IS NOT NULL
      AND b.id::text <> ALL(${skip}::text[])
    ORDER BY power(b.lat - ${from.lat}, 2) + power((b.lng - ${from.lng}) * cos(radians(${from.lat})), 2) ASC
    LIMIT ${take}`;
  return cardsByIds(rows.map(r => r.id));
}

/**
 * Live listing counts per region, per city (slug) and per category (slug). A category counts every
 * business that offers it (primary or secondary), the same set its category pages list, so the category
 * counts overlap and do not add up to the total.
 */
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

export { AVERAGE_MIN_PRICES } from '../stats';

/**
 * Average consumer price per category (shekels, rounded to 10) within a scope: a trimmed mean. Only real,
 * comparable prices count: published, above zero, of type fixed, from or range (no per-unit, per-ml,
 * per-area or package totals, no "on request"). Outliers beyond 1.5 times the interquartile range are
 * removed first, then the rest are averaged, and a category with fewer than AVERAGE_MIN_PRICES prices left
 * returns null ("אין מספיק מחירים"), so a single price is never shown as "the" price. Amounts follow the
 * consumer-price rule (src/lib/vat.ts).
 */
async function averagePricesWhere(scope: Prisma.Sql): Promise<Record<string, number | null>> {
  const pct = await vatRatePct();
  const gross = PRICES_INCLUDE_VAT
    ? Prisma.sql`CASE WHEN t.tax_included IS TRUE OR (t.tax_included IS NULL AND t.source IS DISTINCT FROM 'owner') THEN t.price_agorot ELSE round(t.price_agorot * (1 + ${pct}::numeric / 100)) END`
    : Prisma.sql`t.price_agorot`;
  const rows = await db.$queryRaw<Array<{ slug: string; mean: number | null; n: bigint }>>`
    WITH prices AS (
      SELECT t.category_slug AS slug, (${gross})::numeric AS price
      FROM treatments t
      JOIN branches b ON b.id = t.branch_id
      JOIN businesses bz ON bz.id = b.business_id
      WHERE t.is_published AND t.category_slug IS NOT NULL
        AND t.price_agorot IS NOT NULL AND t.price_agorot > 0
        AND t.price_type IN ('fixed', 'from', 'range')
        AND b.status = 'live' AND bz.status = 'live'
        ${scope}
    ), quartiles AS (
      SELECT slug,
             percentile_cont(0.25) WITHIN GROUP (ORDER BY price) AS q1,
             percentile_cont(0.75) WITHIN GROUP (ORDER BY price) AS q3
      FROM prices GROUP BY slug
    ), kept AS (
      SELECT p.slug, p.price
      FROM prices p JOIN quartiles q ON q.slug = p.slug
      WHERE p.price BETWEEN q.q1 - 1.5 * (q.q3 - q.q1) AND q.q3 + 1.5 * (q.q3 - q.q1)
    )
    SELECT slug, avg(price) / 100.0 AS mean, count(*) AS n
    FROM kept GROUP BY slug`;
  return Object.fromEntries(rows.map(r => [r.slug, Number(r.n) >= AVERAGE_MIN_PRICES_N && r.mean != null ? Math.round(Number(r.mean) / 10) * 10 : null]));
}
const AVERAGE_MIN_PRICES_N = 3;

/** Average (trimmed mean) consumer price per category, nationally or within a region. */
export const averagePrices = (region?: RegionSlug) => averagePricesWhere(region ? Prisma.sql`AND b.region_slug = ${region}::"RegionSlug"` : Prisma.empty);

/** Average (trimmed mean) consumer price per category within one city. */
export const averagePricesForCity = (citySlug: string) => averagePricesWhere(Prisma.sql`AND b.city_id IN (SELECT id FROM cities WHERE slug = ${citySlug})`);

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
      branch: { select: { name: true, slug: true, regionSlug: true, categories: { select: { categorySlug: true, isPrimary: true } } } },
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
    branchName: seoName(r.branch.name),
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
