import 'server-only';
import { Prisma } from '@prisma/client';
import { cache } from 'react';
import type { RegionSlug } from '@/lib/catalog';
import { db } from '@/lib/server/db';

// Read-only aggregates for the Region, Treatments and Treatment Category pages that
// lib/server/public.ts does not provide yet. Same visibility rule as PUBLIC_WHERE:
// live branches of live businesses only. Candidates to move into public.ts.

const LIVE = Prisma.sql`b.status = 'live' AND bz.status = 'live'`;

/** Minimum number of Google ratings before a median rating is shown. */
const MIN_RATINGS = 3;

export interface Breakdown {
  /** region → category → live branches */
  regionCat: Record<string, Record<string, number>>;
  /** "region/city" → category → live branches (catalog cities only) */
  cityCat: Record<string, Record<string, number>>;
}

/** Listing counts per region × category and per city × category. */
export const listingBreakdown = cache(async (): Promise<Breakdown> => {
  const rows = await db.$queryRaw<Array<{ region: string; city: string | null; cat: string; n: bigint }>>`
    SELECT b.region_slug::text AS region, c.slug AS city, bc.category_slug AS cat, count(*) AS n
    FROM branch_categories bc
    JOIN branches b ON b.id = bc.branch_id
    JOIN businesses bz ON bz.id = b.business_id
    LEFT JOIN cities c ON c.id = b.city_id
    WHERE ${LIVE}
    GROUP BY 1, 2, 3`;
  const regionCat: Breakdown['regionCat'] = {};
  const cityCat: Breakdown['cityCat'] = {};
  for (const r of rows) {
    const n = Number(r.n);
    (regionCat[r.region] ??= {})[r.cat] = (regionCat[r.region]?.[r.cat] ?? 0) + n;
    if (r.city) {
      const key = `${r.region}/${r.city}`;
      (cityCat[key] ??= {})[r.cat] = (cityCat[key]?.[r.cat] ?? 0) + n;
    }
  }
  return { regionCat, cityCat };
});

export interface RatingMedians {
  national: number | null;
  region: Partial<Record<RegionSlug, number | null>>;
  category: Record<string, number | null>;
}

const roundRating = (v: number | null, n: bigint) => (v != null && Number(n) >= MIN_RATINGS ? Math.round(Number(v) * 10) / 10 : null);

/** Median Google rating, nationally, per region and per category. Google only: never mixed with BeautyFind reviews. */
export const ratingMedians = cache(async (): Promise<RatingMedians> => {
  const [byRegion, byCat] = await Promise.all([
    db.$queryRaw<Array<{ region: string | null; median: number | null; n: bigint }>>`
      SELECT b.region_slug::text AS region,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY b.google_rating) AS median,
             count(*) AS n
      FROM branches b
      JOIN businesses bz ON bz.id = b.business_id
      WHERE ${LIVE} AND b.google_rating IS NOT NULL
      GROUP BY ROLLUP (b.region_slug)`,
    db.$queryRaw<Array<{ cat: string; median: number | null; n: bigint }>>`
      SELECT bc.category_slug AS cat,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY b.google_rating) AS median,
             count(*) AS n
      FROM branch_categories bc
      JOIN branches b ON b.id = bc.branch_id
      JOIN businesses bz ON bz.id = b.business_id
      WHERE ${LIVE} AND b.google_rating IS NOT NULL
      GROUP BY 1`,
  ]);
  const out: RatingMedians = { national: null, region: {}, category: {} };
  for (const r of byRegion) {
    if (r.region == null) out.national = roundRating(r.median, r.n);
    else out.region[r.region as RegionSlug] = roundRating(r.median, r.n);
  }
  for (const r of byCat) out.category[r.cat] = roundRating(r.median, r.n);
  return out;
});

export interface RegionFacts {
  total: number;
  claimed: number;
  onlineBooking: number;
  accessible: number;
  freeParking: number;
}

/** Share of live branches in a region with each listed feature. */
export async function regionFacts(region: RegionSlug): Promise<RegionFacts> {
  const [r] = await db.$queryRaw<Array<{ total: bigint; claimed: bigint; online: bigint; accessible: bigint; parking: bigint }>>`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE b.is_claimed) AS claimed,
           count(*) FILTER (WHERE b.online_booking) AS online,
           count(*) FILTER (WHERE b.accessible) AS accessible,
           count(*) FILTER (WHERE b.free_parking) AS parking
    FROM branches b
    JOIN businesses bz ON bz.id = b.business_id
    WHERE ${LIVE} AND b.region_slug = ${region}::"RegionSlug"`;
  return {
    total: Number(r?.total ?? 0),
    claimed: Number(r?.claimed ?? 0),
    onlineBooking: Number(r?.online ?? 0),
    accessible: Number(r?.accessible ?? 0),
    freeParking: Number(r?.parking ?? 0),
  };
}
