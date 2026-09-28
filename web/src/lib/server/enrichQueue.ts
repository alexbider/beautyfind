import 'server-only';
import type { Prisma, RegionSlug } from '@prisma/client';
import { CATEGORIES } from '@/lib/catalog';
import { MANIFEST, type ProfileStatus } from '@/lib/import/coverage';
import type { EditorialRecord } from '@/lib/import/editorial';
import { planFor, planSignals, type PlanSignals, type StepId } from '@/lib/import/enrichPlan';
export { planSignals };
import { loadSettings } from '@/lib/import/settings';
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
  // What the sources said the last time they were asked (crawl.apify): found / not_found for Maps,
  // match / no_match / unavailable for the social profiles, the outcome for a rendered site.
  sources: Record<string, string>;
  // The last completion run that touched this listing: what it filled, what each source said, the writer's problem if any.
  lastResult: { at: string; filled: string[]; skipped: string | null; steps: string[]; site: string | null; sources: Record<string, string>; editorial: string | null } | null;
  signals: PlanSignals;
  plan: StepId[]; // steps that can fill this listing's gaps ("all enrichments needed")
}

export interface EnrichFilter {
  region?: string;
  category?: string;
  status?: string;
  missing?: string;
  q?: string;
  branchIds?: string[]; // only these listings (the worker seeding a run)
  city?: string; // exact city name
  step?: string; // only listings whose automatic plan includes this step
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
    ...(f.city ? { cityName: f.city } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { cityName: { contains: f.q, mode: 'insensitive' } }] } : {}),
  };
  const [places, settings] = await Promise.all([
    db.importPlace.findMany({
      where: { status: { in: ['approved', 'merged'] }, branchId: f.branchIds ? { in: f.branchIds } : { not: null } },
      select: { id: true, branchId: true, crawl: true, reasons: true, socials: true, enrichedAt: true, editorial: true, website: true, websiteKind: true, placeId: true, sourceId: true, provider: true, instagram: true, facebook: true },
    }),
    loadSettings(db),
  ]);
  // The admin plans as if the worker has its token; the worker itself checks APIFY_TOKEN when it seeds the run.
  const planOpts = { settings, apifyConfigured: true };
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
  const lastRuns = await db.auditLog.findMany({
    where: { action: 'import_enhance', subjectType: 'branch', subjectId: { in: branches.map(b => b.id) } },
    orderBy: { createdAt: 'desc' },
    distinct: ['subjectId'],
    select: { subjectId: true, createdAt: true, meta: true },
  });
  const lastBy = new Map(lastRuns.map(a => [a.subjectId, a]));
  const rows: EnrichRow[] = [];
  for (const b of branches.slice(0, MAX_ROWS)) {
    const p = byBranch.get(b.id)!;
    const crawl = (p.crawl ?? {}) as Record<string, unknown>;
    const conflicts = [crawl.phoneConflict === true ? 'phone' : null, crawl.hoursConflict === true ? 'hours' : null].filter((x): x is string => !!x);
    const cov = branchCoverage(b, { verifiedStaff: verifiedBy.get(b.businessId) ?? 0, conflicts, reviewReasons: p.reasons.filter(r => !['medical_without_doctor_info', 'no_email'].includes(r)), socials: socialCounts(p as never) });
    const ed = (b.editorial ?? null) as (EditorialRecord & { generatedAt?: string }) | null;
    const signals = planSignals(p);
    rows.push({
      signals,
      plan: planFor(cov.missing, signals, planOpts),
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
      sources: Object.fromEntries(Object.entries((crawl.apify as Record<string, { checked?: string; found?: boolean; status?: string }> | undefined) ?? {}).map(([k, v]) => [k, v?.checked ?? (v?.found === false ? 'not_found' : v?.found ? 'found' : v?.status ?? 'done')])),
      lastResult: (() => {
        const a = lastBy.get(b.id);
        if (!a) return null;
        const m = (a.meta ?? {}) as { filled?: string[]; skipped?: string | null; steps?: string[]; site?: string | null; sources?: Record<string, string>; editorial?: string | null };
        return { at: a.createdAt.toISOString(), filled: m.filled ?? [], skipped: m.skipped ?? null, steps: m.steps ?? [], site: m.site ?? null, sources: m.sources ?? {}, editorial: m.editorial ?? null };
      })(),
    });
  }
  const filtered = rows
    .filter(r => (!f.status || r.status === f.status) && (!f.missing || r.missing.includes(f.missing)) && (!f.step || (r.plan as string[]).includes(f.step)))
    .sort((a, b) => a.readiness - b.readiness || a.name.localeCompare(b.name, 'he'));
  return { rows: filtered, total: rows.length, truncated };
}
