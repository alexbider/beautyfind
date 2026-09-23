import 'server-only';
import { BOOKING_LIVE } from '@/lib/features';
import { Prisma } from '@prisma/client';
import { cache } from 'react';
import { CATEGORIES, citiesOf, type City, type RegionSlug } from '@/lib/catalog';
import { db } from '@/lib/server/db';
import { PUBLIC_WHERE, listBranches, medianPrices, type ListingCard } from '@/lib/server/public';
import type { DirQuery, FilterKey } from './params';

// Directory-only reads. Listing cards come from lib/server/public (listBranches); this file
// adds the per-city aggregates the page shows and the few card fields ListingCard lacks.

export interface DirScope {
  region: RegionSlug;
  city: City;
  category?: string;
}

const scopeWhere = (s: DirScope, extra: Prisma.BranchWhereInput[] = []): Prisma.BranchWhereInput => ({
  AND: [PUBLIC_WHERE, { regionSlug: s.region }, { city: { slug: s.city.slug } }, ...(s.category ? [{ categories: { some: { categorySlug: s.category } } }] : []), ...extra],
});

const FILTER_WHERE: Record<FilterKey, Prisma.BranchWhereInput> = {
  verified: { isClaimed: true },
  online: BOOKING_LIVE ? { onlineBooking: true } : {},
  parking: { freeParking: true },
  accessible: { accessible: true },
};

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Same rule as medianPrices(): fewer than 3 published prices → null. Rounded to ₪10. */
async function cityMedianPrices(citySlug: string): Promise<Record<string, number | null>> {
  const rows = await db.$queryRaw<Array<{ slug: string; median: number | null; n: bigint }>>`
    SELECT t.category_slug AS slug,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY t.price_agorot) / 100.0 AS median,
           count(*) AS n
    FROM treatments t
    JOIN branches b ON b.id = t.branch_id
    JOIN businesses bz ON bz.id = b.business_id
    JOIN cities c ON c.id = b.city_id
    WHERE t.is_published AND t.category_slug IS NOT NULL
      AND b.status = 'live' AND bz.status = 'live'
      AND c.slug = ${citySlug}
    GROUP BY t.category_slug`;
  return Object.fromEntries(rows.map(r => [r.slug, Number(r.n) >= 3 && r.median != null ? Math.round(Number(r.median) / 10) * 10 : null]));
}

export interface PriceRow {
  slug: string;
  name: string;
  price: number;
  fromRegion: boolean; // city had fewer than 3 prices, region median shown
  count: number; // listings in this city offering the category
}

export interface Overview {
  total: number; // listings in scope, no filters
  verified: number;
  medianGoogle: number | null;
  updatedAt: Date | null;
  filterCounts: Record<FilterKey, number>;
  /** Categories present in the city (all categories, not only the current one), catalog order. */
  cityCategories: Array<{ slug: string; name: string; count: number }>;
  /** Other cities of the region with listings in scope, most listings first. */
  siblings: Array<{ city: City; count: number }>;
  regionTotal: number;
  prices: PriceRow[];
}

/** Aggregates for the page, metadata and JSON-LD. Cached per request. */
export const getOverview = cache(async (region: RegionSlug, citySlug: string, category: string | undefined): Promise<Overview> => {
  const cities = citiesOf(region);
  const city = cities.find(c => c.slug === citySlug)!;
  const s: DirScope = { region, city, category };
  const catFilter: Prisma.BranchWhereInput[] = category ? [{ categories: { some: { categorySlug: category } } }] : [];

  const [total, rated, fc, byCat, bySibling, regionTotal, cityMed, regionMed, cityRows] = await Promise.all([
    db.branch.count({ where: scopeWhere(s) }),
    db.branch.findMany({ where: scopeWhere(s), select: { googleRating: true, updatedAt: true } }),
    Promise.all((Object.keys(FILTER_WHERE) as FilterKey[]).map(async k => [k, await db.branch.count({ where: scopeWhere(s, [FILTER_WHERE[k]]) })] as const)),
    db.branchCategory.groupBy({
      by: ['categorySlug'],
      where: { branch: { AND: [PUBLIC_WHERE, { regionSlug: region }, { city: { slug: citySlug } }] } },
      _count: { _all: true },
    }),
    db.branch.groupBy({ by: ['cityId'], where: { AND: [PUBLIC_WHERE, { regionSlug: region }, { cityId: { not: null } }, ...catFilter] }, _count: { _all: true } }),
    db.branch.count({ where: { AND: [PUBLIC_WHERE, { regionSlug: region }, ...catFilter] } }),
    cityMedianPrices(citySlug),
    medianPrices(region),
    db.city.findMany({ where: { regionSlug: region }, select: { id: true, slug: true } }),
  ]);

  const filterCounts = Object.fromEntries(fc) as Record<FilterKey, number>;
  const verified = filterCounts.verified;
  const ratings = rated.map(r => r.googleRating).filter((x): x is number => x != null);
  const med = median(ratings);
  const updatedAt = rated.reduce<Date | null>((d, r) => (!d || r.updatedAt > d ? r.updatedAt : d), null);

  const catCount = new Map(byCat.map(r => [r.categorySlug, r._count._all]));
  const cityCategories = CATEGORIES.filter(c => (catCount.get(c.slug) ?? 0) > 0).map(c => ({ slug: c.slug, name: c.name, count: catCount.get(c.slug)! }));

  const slugById = new Map(cityRows.map(r => [r.id, r.slug]));
  const countBySlug = new Map(bySibling.map(r => [slugById.get(r.cityId!) ?? '', r._count._all]));
  const siblings = cities
    .filter(c => c.slug !== citySlug && (countBySlug.get(c.slug) ?? 0) > 0)
    .map(c => ({ city: c, count: countBySlug.get(c.slug)! }))
    .sort((a, b) => b.count - a.count);

  const prices: PriceRow[] = [];
  for (const c of cityCategories) {
    const own = cityMed[c.slug] ?? null;
    const reg = regionMed[c.slug] ?? null;
    if (own != null) prices.push({ slug: c.slug, name: c.name, price: own, fromRegion: false, count: c.count });
    else if (reg != null) prices.push({ slug: c.slug, name: c.name, price: reg, fromRegion: true, count: c.count });
  }

  return {
    total,
    verified,
    medianGoogle: med == null ? null : Math.round(med * 10) / 10,
    updatedAt,
    filterCounts,
    cityCategories,
    siblings,
    regionTotal,
    prices,
  };
});

export interface CardExtras {
  address: string;
  phone: string | null;
  whatsapp: string | null;
  gallery: Array<{ url: string; alt: string }>;
  responsible: string | null; // verified doctor's display name
}

export type DirectoryCard = ListingCard & CardExtras;

function parseGallery(v: Prisma.JsonValue): Array<{ url: string; alt: string }> {
  if (!Array.isArray(v)) return [];
  return v.flatMap(g => (g && typeof g === 'object' && !Array.isArray(g) && typeof g.url === 'string' ? [{ url: g.url, alt: typeof g.alt === 'string' ? g.alt : '' }] : []));
}

/** Listing cards for the current URL state: the first `show` results, fetched in chunks of 60 (listBranches' cap). */
export async function getListings(scope: DirScope, q: DirQuery): Promise<{ total: number; items: DirectoryCard[] }> {
  const base = {
    region: scope.region,
    citySlug: scope.city.slug,
    category: scope.category,
    sort: q.sort,
    verifiedOnly: q.filters.includes('verified'),
    onlineBooking: BOOKING_LIVE && q.filters.includes('online'),
    freeParking: q.filters.includes('parking'),
    accessible: q.filters.includes('accessible'),
  };
  const CHUNK = 60;
  const first = await listBranches({ ...base, take: Math.min(CHUNK, q.show), skip: 0 });
  const items = [...first.items];
  for (let skip = CHUNK; skip < Math.min(q.show, first.total); skip += CHUNK) {
    const next = await listBranches({ ...base, take: Math.min(CHUNK, q.show - skip), skip });
    items.push(...next.items);
  }

  const extras = await db.branch.findMany({
    where: { id: { in: items.map(i => i.id) } },
    select: {
      id: true,
      address: true,
      phone: true,
      whatsapp: true,
      gallery: true,
      medicalResponsible: { select: { displayName: true, license: { select: { status: true } } } },
    },
  });
  const byId = new Map(extras.map(e => [e.id, e]));
  return {
    total: first.total,
    items: items.map(i => {
      const e = byId.get(i.id);
      return {
        ...i,
        address: e?.address ?? i.cityName,
        phone: e?.phone ?? null,
        whatsapp: e?.whatsapp ?? null,
        gallery: e ? parseGallery(e.gallery) : [],
        responsible: e?.medicalResponsible?.license?.status === 'verified' ? e.medicalResponsible.displayName : null,
      };
    }),
  };
}
