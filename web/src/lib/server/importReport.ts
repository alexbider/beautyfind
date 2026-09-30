import 'server-only';
import type { Prisma, RegionSlug } from '@prisma/client';
import { CATEGORIES, CITIES } from '@/lib/catalog';
import { MANIFEST, type Coverage, type ProfileStatus } from '@/lib/import/coverage';
import type { EditorialRecord } from '@/lib/import/editorial';
import { placeCoverage } from '@/lib/import/placeCoverage';
import { db } from '@/lib/server/db';
import { branchCoverage, socialCounts } from '@/lib/server/importPublish';
import { profileHref } from '@/lib/server/public';
import { PERSON_REASONS } from '@/lib/import/placeCoverage';

// The profiles report (/ops/import/report): every business the import touched, scraped or enhanced,
// with a link, what it has and what it lacks per template section, which sources answered, and what
// it cost. Grouped by city and category so a batch can be started for one group.

export type ReportState = 'published' | 'ready' | 'needs_review' | 'incomplete' | 'pending' | 'duplicate' | 'rejected' | 'closed';

export const STATE_NAME: Record<ReportState, string> = {
  published: 'פורסם',
  ready: 'מוכן לאישור',
  needs_review: 'בבדיקה',
  incomplete: 'חסר מידע בסיסי',
  pending: 'בעיבוד',
  duplicate: 'כפול',
  rejected: 'נדחה',
  closed: 'סגור',
};

export interface ReportRow {
  placeId: string;
  branchId: string | null;
  name: string;
  cityName: string;
  regionSlug: string | null;
  categories: string[];
  state: ReportState;
  href: string; // the public profile when published, otherwise the review record
  reviewHref: string;
  readiness: number;
  profileStatus: ProfileStatus;
  sections: Array<{ id: string; state: 'populated' | 'fallback' | 'missing'; detail: string }>; // weighted sections only
  missing: string[];
  sources: { provider: string; site: string | null; maps: string | null; facebook: string | null; instagram: string | null; render: string | null; research: string | null; researchFilled: string[] };
  editorial: { words: number; model: string; needsMore: boolean } | null;
  photos: number;
  services: number;
  costUsd: number;
  lastActivity: string | null;
  runId: string;
  claimed: boolean;
}

export interface ReportGroup {
  key: string;
  cityName: string;
  category: string;
  n: number;
  published: number;
  inReview: number;
  avgReadiness: number;
  topGaps: string[];
  publishedUnclaimed: string[]; // branch ids a completion batch can take
}

export interface ReportFilter {
  region?: string;
  city?: string; // cityName
  category?: string;
  state?: string;
  missing?: string;
  q?: string;
  runId?: string;
}

const MAX = 5000;
const WEIGHTED = new Set(MANIFEST.filter(m => m.weight > 0).map(m => m.id));

const STATES: Record<string, ReportState> = { approved: 'published', merged: 'published', ready: 'ready', needs_review: 'needs_review', incomplete: 'incomplete', duplicate: 'duplicate', rejected: 'rejected', closed: 'closed' };
const stateOf = (status: string): ReportState => STATES[status] ?? 'pending';

const sum = (o: unknown) => Object.entries((o ?? {}) as Record<string, unknown>).filter(([k, v]) => k.endsWith('Usd') && typeof v === 'number').reduce((n, [, v]) => n + (v as number), 0);

export async function importReport(f: ReportFilter = {}): Promise<{ rows: ReportRow[]; groups: ReportGroup[]; total: number; truncated: boolean }> {
  const where: Prisma.ImportPlaceWhereInput = {
    ...(f.runId ? { runId: f.runId } : {}),
    ...(f.region ? { regionSlug: f.region as RegionSlug } : {}),
    ...(f.city ? { cityName: f.city } : {}),
    ...(CATEGORIES.some(c => c.slug === f.category) ? { categories: { has: f.category } } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { address: { contains: f.q, mode: 'insensitive' } }] } : {}),
  };
  const places = await db.importPlace.findMany({ where, orderBy: [{ cityName: 'asc' }, { name: 'asc' }], take: MAX + 1 });
  const truncated = places.length > MAX;
  const list = places.slice(0, MAX);
  const branchIds = list.map(p => p.branchId).filter((x): x is string => !!x);
  const branches = branchIds.length
    ? await db.branch.findMany({ where: { id: { in: branchIds } }, include: { categories: true, treatments: { where: { isPublished: true }, select: { priceAgorot: true } } } })
    : [];
  const byBranch = new Map(branches.map(b => [b.id, b]));
  const verified = branches.length ? await db.staffMember.groupBy({ by: ['businessId'], where: { businessId: { in: branches.map(b => b.businessId) }, status: 'active', license: { status: 'verified' } }, _count: true }) : [];
  const verifiedBy = new Map(verified.map(v => [v.businessId, v._count]));

  const rows: ReportRow[] = [];
  for (const p of list) {
    const b = p.branchId ? byBranch.get(p.branchId) : undefined;
    const crawl = (p.crawl ?? {}) as Record<string, unknown>;
    const apify = (crawl.apify ?? {}) as Record<string, { checked?: string; found?: boolean; status?: string }>;
    const render = (crawl.render ?? null) as { status?: string } | null;
    const research = crawl.research as { filled?: string[]; error?: string; at?: string } | undefined;
    let cov: Coverage;
    if (b) {
      const conflicts = [crawl.phoneConflict === true ? 'phone' : null, crawl.hoursConflict === true ? 'hours' : null].filter((x): x is string => !!x);
      cov = branchCoverage(b, { verifiedStaff: verifiedBy.get(b.businessId) ?? 0, conflicts, reviewReasons: PERSON_REASONS(p.reasons), socials: socialCounts(p) });
    } else cov = placeCoverage(p, { mapConfigured: !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY });
    const ed = ((b?.editorial ?? p.editorial) ?? null) as (EditorialRecord & { model?: string }) | null;
    const state = stateOf(p.status);
    const reviewHref = `/ops/import/review?run=${p.runId}&q=${encodeURIComponent(p.name)}`;
    const last = [p.enrichedAt?.toISOString() ?? null, research?.at ?? null, (ed as { generatedAt?: string } | null)?.generatedAt ?? null, p.reviewedAt?.toISOString() ?? null].filter((x): x is string => !!x).sort().at(-1) ?? null;
    rows.push({
      placeId: p.id,
      branchId: b?.id ?? null,
      name: p.name,
      cityName: b?.cityName || p.cityName || '',
      regionSlug: (b?.regionSlug ?? p.regionSlug) ?? null,
      categories: b ? b.categories.map(c => c.categorySlug) : p.categories,
      state,
      href: b ? profileHref(b) : reviewHref,
      reviewHref,
      readiness: cov.readiness,
      profileStatus: cov.status,
      sections: cov.rows.filter(r => WEIGHTED.has(r.id)).map(r => ({ id: r.id, state: r.state, detail: r.detail })),
      missing: cov.missing,
      sources: {
        provider: p.provider,
        site: typeof crawl.site === 'string' ? (crawl.site as string) : null,
        maps: apify.maps ? (apify.maps.found === false ? 'not_found' : 'found') : null,
        facebook: apify.facebook?.checked ?? null,
        instagram: apify.instagram?.checked ?? null,
        render: render?.status ?? apify.render?.status ?? null,
        research: research ? (research.error ? 'failed' : research.filled?.length ? 'filled' : 'nothing') : null,
        researchFilled: research?.filled ?? [],
      },
      editorial: ed && typeof ed.description === 'string' ? { words: ed.words ?? 0, model: ed.model ?? '?', needsMore: !!ed.needsMoreInfo } : null,
      photos: b ? (b.coverUrl?.startsWith('/media/') ? 1 : 0) + (Array.isArray(b.gallery) ? b.gallery.length : 0) : p.photoUrls.length,
      services: b ? b.treatments.length : Array.isArray(p.treatments) ? p.treatments.length : 0,
      costUsd: sum(p.costs),
      lastActivity: last,
      runId: p.runId,
      claimed: !!b?.isClaimed,
    });
  }
  const filtered = rows.filter(r => (!f.state || r.state === f.state) && (!f.missing || r.missing.includes(f.missing)));

  // Groups over the filtered rows: one per city and category.
  const groups = new Map<string, ReportGroup & { readinessSum: number; gapCount: Record<string, number> }>();
  for (const r of filtered) {
    for (const cat of r.categories.length ? r.categories : ['']) {
      const key = `${r.cityName}|${cat}`;
      const g = groups.get(key) ?? { key, cityName: r.cityName, category: cat, n: 0, published: 0, inReview: 0, avgReadiness: 0, topGaps: [], publishedUnclaimed: [], readinessSum: 0, gapCount: {} };
      g.n++;
      if (r.state === 'published') g.published++;
      if (r.state === 'ready' || r.state === 'needs_review') g.inReview++;
      if (r.state === 'published' && !r.claimed && r.branchId) g.publishedUnclaimed.push(r.branchId);
      g.readinessSum += r.readiness;
      for (const m of r.missing) g.gapCount[m] = (g.gapCount[m] ?? 0) + 1;
      groups.set(key, g);
    }
  }
  const groupRows: ReportGroup[] = [...groups.values()]
    .map(g => ({ key: g.key, cityName: g.cityName, category: g.category, n: g.n, published: g.published, inReview: g.inReview, avgReadiness: g.n ? Math.round(g.readinessSum / g.n) : 0, topGaps: Object.entries(g.gapCount).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k), publishedUnclaimed: [...new Set(g.publishedUnclaimed)] }))
    .sort((a, b) => b.n - a.n || a.cityName.localeCompare(b.cityName, 'he'));
  return { rows: filtered, groups: groupRows, total: rows.length, truncated };
}

/** City names the import has seen, for the filter. */
export async function reportCities(): Promise<string[]> {
  const r = await db.importPlace.groupBy({ by: ['cityName'], where: { cityName: { not: null } }, _count: true, orderBy: { _count: { cityName: 'desc' } }, take: 200 });
  const known = new Set(CITIES.map(c => c.name));
  return r.map(x => x.cityName!).filter(Boolean).sort((a, b) => Number(known.has(b)) - Number(known.has(a)) || a.localeCompare(b, 'he'));
}
