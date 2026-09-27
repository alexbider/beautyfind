import 'server-only';
import type { Prisma, RegionSlug } from '@prisma/client';
import { CATEGORIES } from '@/lib/catalog';
import { MANIFEST, type ProfileStatus } from '@/lib/import/coverage';
import type { EditorialRecord } from '@/lib/import/editorial';
import { db } from '@/lib/server/db';
import { branchCoverage, socialCounts } from '@/lib/server/importPublish';
import { profileHref } from '@/lib/server/public';

// The enrichment queue (/ops/import/enrich): every published listing that came from the import, scored
// against the template so staff can pick what to enhance and why. Scores are computed here from the
// listing's real data (not from a stored snapshot), so they are current after every run.

export interface EnrichRow {
  branchId: string;
  placeId: string;
  name: string;
  cityName: string;
  regionSlug: string;
  categories: string[];
  href: string;
  status: ProfileStatus;
  readiness: number;
  missing: string[]; // manifest section ids in fallback or missing state
  ownerOnly: string[];
  photos: number;
  services: number;
  unpriced: number;
  words: number | null;
  faqs: number;
  hasSite: boolean;
  siteOutcome: string | null;
  lastEnriched: string | null;
  lastEditorial: string | null;
}

export interface EnrichFilter {
  region?: string;
  category?: string;
  status?: string;
  missing?: string;
  q?: string;
}

/** Section ids staff can target, in template order, with the weight the score gives them. */
export const TARGETABLE = MANIFEST.filter(m => m.weight > 0).map(m => ({ id: m.id, weight: m.weight }));

const MAX_ROWS = 3000;

export async function enrichQueue(f: EnrichFilter = {}): Promise<{ rows: EnrichRow[]; total: number; truncated: boolean }> {
  const where: Prisma.BranchWhereInput = {
    status: 'live',
    isClaimed: false,
    ...(CATEGORIES.some(c => c.slug === f.category) ? { categories: { some: { categorySlug: f.category } } } : {}),
    ...(f.region ? { regionSlug: f.region as RegionSlug } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { cityName: { contains: f.q, mode: 'insensitive' } }] } : {}),
  };
  const places = await db.importPlace.findMany({
    where: { status: { in: ['approved', 'merged'] }, branchId: { not: null } },
    select: { id: true, branchId: true, crawl: true, reasons: true, socials: true, enrichedAt: true, editorial: true, website: true },
  });
  const byBranch = new Map(places.filter(p => p.branchId).map(p => [p.branchId!, p]));
  const branches = await db.branch.findMany({
    where: { ...where, id: { in: [...byBranch.keys()] } },
    include: { categories: true, treatments: { where: { isPublished: true }, select: { priceAgorot: true } } },
    orderBy: { name: 'asc' },
    take: MAX_ROWS + 1,
  });
  const truncated = branches.length > MAX_ROWS;
  const verified = await db.staffMember.groupBy({ by: ['businessId'], where: { businessId: { in: branches.map(b => b.businessId) }, status: 'active', license: { status: 'verified' } }, _count: true });
  const verifiedBy = new Map(verified.map(v => [v.businessId, v._count]));
  const rows: EnrichRow[] = [];
  for (const b of branches.slice(0, MAX_ROWS)) {
    const p = byBranch.get(b.id)!;
    const crawl = (p.crawl ?? {}) as Record<string, unknown>;
    const conflicts = [crawl.phoneConflict === true ? 'phone' : null, crawl.hoursConflict === true ? 'hours' : null].filter((x): x is string => !!x);
    const cov = branchCoverage(b, { verifiedStaff: verifiedBy.get(b.businessId) ?? 0, conflicts, reviewReasons: p.reasons.filter(r => !['medical_without_doctor_info', 'no_email'].includes(r)), socials: socialCounts(p as never) });
    const ed = (b.editorial ?? null) as (EditorialRecord & { generatedAt?: string }) | null;
    rows.push({
      branchId: b.id,
      placeId: p.id,
      name: b.name,
      cityName: b.cityName,
      regionSlug: b.regionSlug,
      categories: b.categories.map(c => c.categorySlug),
      href: profileHref(b),
      status: cov.status,
      readiness: cov.readiness,
      missing: cov.missing,
      ownerOnly: cov.ownerMissing,
      photos: (b.coverUrl?.startsWith('/media/') ? 1 : 0) + (Array.isArray(b.gallery) ? b.gallery.length : 0),
      services: b.treatments.length,
      unpriced: b.treatments.filter(t => t.priceAgorot == null).length,
      words: ed?.words ?? null,
      faqs: Array.isArray(b.faqs) ? b.faqs.length : 0,
      hasSite: !!p.website,
      siteOutcome: typeof crawl.site === 'string' ? crawl.site : null,
      lastEnriched: p.enrichedAt?.toISOString() ?? null,
      lastEditorial: ed?.generatedAt ?? null,
    });
  }
  const filtered = rows
    .filter(r => (!f.status || r.status === f.status) && (!f.missing || r.missing.includes(f.missing)))
    .sort((a, b) => a.readiness - b.readiness || a.name.localeCompare(b.name, 'he'));
  return { rows: filtered, total: rows.length, truncated };
}
