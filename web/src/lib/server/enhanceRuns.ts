import 'server-only';
import type { Branch, Prisma, RegionSlug } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { CATEGORIES, CITIES } from '@/lib/catalog';
import { MANIFEST } from '@/lib/import/coverage';
import { siteHost } from '@/lib/import/email';
import { estimatePlans, planFor, planSignals, STEP_ORDER, stepApplies, type PlanSignals, type StepId } from '@/lib/import/enrichPlan';
import { normName } from '@/lib/import/match';
import { pricing } from '@/lib/import/pricing';
import { classifyWebsite, KEEP_AS_WEBSITE } from '@/lib/import/websiteKind';
import { db } from './db';
import { enrichQueue } from './enrichQueue';
import { createRun, dispatchWorker, getSettings } from './importOps';
import { branchCoverage, socialCounts } from './importPublish';
import { profileHref } from './public';

// The AI completion ("השלמה ב־AI") behind the businesses screen and the import's enrichment tab.
// A completion is an enhance run of the import worker: the website read again, ChatGPT research for
// what is still missing, the writer for the description and FAQs, and images copied, each step only
// where the listing's gaps call for it. Two rules carry over from the import: a listing an owner has
// claimed is never touched (their data), and only live listings are completed.
//
// Listings that were registered by hand (not found by the import) have no import record to hang the
// evidence on; `ensureImportRecords` gives them one, seeded from the listing itself, so the same
// pipeline can work on them.

export type EnhanceResult = { ok: true; count: number; dispatched?: boolean; runId: string | null; budgetUsd: number; plan: Record<string, number> } | { ok: false; count: 0; error: string };

export interface CompletionOptions { steps?: string[]; auto?: boolean; label?: string; focus?: string[]; refresh?: boolean; regenerate?: boolean; rereadSite?: boolean }

const StepSet = new Set<string>(['dfs', 'maps', 'facebook', 'instagram', 'site', 'render', 'editorial', 'regenerate', 'images']);

/** Starts one enhance run for the chosen listings (by branch id) and hands it to the worker. */
export async function startCompletion(user: { id: string }, branchIds: string[], opts: CompletionOptions = {}): Promise<EnhanceResult> {
  const requested = new Set<StepId>((opts.steps ?? []).filter(s => StepSet.has(s)) as StepId[]);
  if (opts.rereadSite) requested.add('site');
  if (opts.refresh) requested.add('dfs');
  if (opts.regenerate) requested.add('regenerate');
  if (!opts.steps) for (const st of ['site', 'research', 'editorial', 'images'] as StepId[]) requested.add(st);
  const steps = STEP_ORDER.filter(st => requested.has(st));
  const auto = opts.auto !== false;
  const q = await enrichQueue({ branchIds });
  if (!q.rows.length) return { ok: true, count: 0, runId: null, budgetUsd: 0, plan: {} };
  const ids = q.rows.map(r => r.branchId);
  const s = await getSettings();
  const planOpts = { settings: s, apifyConfigured: true, allowed: steps };
  const plans = q.rows.map(r => {
    const plan = auto ? planFor(r.missing, r.signals, planOpts) : steps.filter(st => stepApplies(st, r.signals, planOpts));
    if (auto && requested.has('regenerate') && stepApplies('regenerate', r.signals, planOpts)) plan.push('regenerate');
    return plan;
  });
  const est = estimatePlans(plans, pricing(), { renderPages: s.apifyRenderPages, editorialEnabled: s.editorialEnabled, writer: s.llmProvider });
  const planCounts = Object.fromEntries(Object.entries(est.perStep).filter(([, v]) => v.listings > 0).map(([k, v]) => [k, v.listings]));
  // Ceiling: the estimate plus a quarter, at least the editorial allowance for a few new drafts; never above the per-run caps.
  const editorialCap = s.editorialEnabled ? Math.min(s.editorialBudgetUsd, ids.length * pricing().editorial.perProfileUsd * 1.3) : 0;
  const budgetUsd = Math.min(10_000, Math.max(0.05, est.totalUsd * 1.25 + (planCounts.editorial || planCounts.regenerate ? editorialCap * 0.5 : 0)));
  try {
    const focus = (opts.focus ?? []).slice(0, 30);
    const label = (opts.label ?? '').trim().slice(0, 60) || `העשרה: ${ids.length} עסקים${focus.length ? ` (${focus.join(', ')})` : ''}`;
    const run = await createRun(user, {
      label,
      provider: 'enhance',
      scope: { branchIds: ids, steps, auto, refresh: steps.includes('dfs'), regenerate: steps.includes('regenerate'), rereadSite: steps.includes('site'), focus },
      recordLimit: ids.length,
      budgetUsd,
    });
    const d = await dispatchWorker(run.id);
    await db.auditLog.create({ data: { actorId: user.id, action: 'ai_completion_requested', subjectType: 'import_run', subjectId: run.id, meta: { listings: ids.length, steps, auto, budgetUsd: Math.round(budgetUsd * 100) / 100, dispatched: d.dispatched } } });
    for (const p of ['/ops/import', '/ops/import/enrich', '/ops/businesses']) revalidatePath(p);
    return { ok: true, count: ids.length, dispatched: d.dispatched, runId: run.id, budgetUsd, plan: planCounts };
  } catch (e) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : 'failed' };
  }
}

/** The plan and its estimate for listings, without starting anything (what the bulk screen shows before the click). */
export async function estimateCompletion(branchIds: string[], opts: CompletionOptions = {}): Promise<{ listings: number; plan: Record<string, number>; usd: number }> {
  const q = await enrichQueue({ branchIds });
  if (!q.rows.length) return { listings: 0, plan: {}, usd: 0 };
  const s = await getSettings();
  const requested = new Set<StepId>(((opts.steps ?? ['site', 'research', 'editorial', 'images']).filter(x => StepSet.has(x))) as StepId[]);
  const steps = STEP_ORDER.filter(st => requested.has(st));
  const planOpts = { settings: s, apifyConfigured: true, allowed: steps };
  const plans = q.rows.map(r => (opts.auto === false ? steps.filter(st => stepApplies(st, r.signals, planOpts)) : planFor(r.missing, r.signals, planOpts)));
  const est = estimatePlans(plans, pricing(), { renderPages: s.apifyRenderPages, editorialEnabled: s.editorialEnabled, writer: s.llmProvider });
  return { listings: q.rows.length, plan: Object.fromEntries(Object.entries(est.perStep).filter(([, v]) => v.listings > 0).map(([k, v]) => [k, v.listings])), usd: est.totalUsd };
}

// ---------- manual import records ----------

export type EnsureSkip = 'claimed' | 'not_live' | 'no_coordinates' | 'missing';

/** The run that holds records seeded from the listings themselves (never queued; the worker ignores finished runs). */
async function holderRun(actorId: string): Promise<string> {
  const found = await db.importRun.findFirst({ where: { provider: 'manual' }, select: { id: true } });
  if (found) return found.id;
  const run = await db.importRun.create({
    data: { label: 'רשומות שנוצרו מרישומים ידניים (להשלמה ב־AI)', provider: 'manual', status: 'done', finishedAt: new Date(), scope: { manual: true }, maxRequests: 0, recordLimit: 0, budgetMicros: 0n, createdById: actorId },
    select: { id: true },
  });
  return run.id;
}

/**
 * Every live, unclaimed listing among `branchIds` gets an import record when it has none, seeded from the
 * listing (name, address, coordinates, contact, website, socials, hours, categories). Returns what was
 * created and why the others were skipped. A listing without coordinates is skipped: the pipeline
 * keys matching and directions on them, and a made-up point would be wrong.
 */
export async function ensureImportRecords(branchIds: string[], actorId: string): Promise<{ created: string[]; existing: string[]; skipped: Array<{ id: string; reason: EnsureSkip }> }> {
  const out = { created: [] as string[], existing: [] as string[], skipped: [] as Array<{ id: string; reason: EnsureSkip }> };
  if (!branchIds.length) return out;
  const [branches, places] = await Promise.all([
    db.branch.findMany({ where: { id: { in: branchIds } }, include: { categories: true } }),
    db.importPlace.findMany({ where: { branchId: { in: branchIds }, status: { in: ['approved', 'merged'] } }, select: { branchId: true } }),
  ]);
  const has = new Set(places.map(p => p.branchId));
  let runId: string | null = null;
  for (const id of branchIds) {
    const b = branches.find(x => x.id === id);
    if (!b) { out.skipped.push({ id, reason: 'missing' }); continue; }
    if (has.has(id)) { out.existing.push(id); continue; }
    if (b.isClaimed) { out.skipped.push({ id, reason: 'claimed' }); continue; }
    if (b.status !== 'live') { out.skipped.push({ id, reason: 'not_live' }); continue; }
    if (b.lat == null || b.lng == null) { out.skipped.push({ id, reason: 'no_coordinates' }); continue; }
    runId ??= await holderRun(actorId);
    const w = classifyWebsite(b.websiteUrl);
    const keep = w.url && KEEP_AS_WEBSITE.includes(w.kind);
    const city = CITIES.find(c => c.name === b.cityName) ?? null;
    await db.importPlace.upsert({
      where: { placeId: `manual:${b.id}` },
      create: {
        placeId: `manual:${b.id}`, provider: 'manual', sourceUrl: null, retrievedAt: new Date(), nameNorm: normName(b.name),
        name: b.name, address: b.address, cityName: b.cityName, citySlug: city?.slug ?? null, regionSlug: b.regionSlug as RegionSlug, lat: b.lat, lng: b.lng,
        phone: b.phone, whatsapp: b.whatsapp, email: b.email, emails: b.email ? [b.email] : [], emailSource: b.email ? 'manual' : null,
        website: keep ? w.url : null, websiteKind: keep ? w.kind : null, siteDomain: keep && w.kind === 'own' ? siteHost(w.url) : null,
        instagram: b.instagram, facebook: b.facebook, tiktok: b.tiktok, youtube: b.youtube,
        hours: Array.isArray(b.hours) && (b.hours as unknown[]).length ? (b.hours as Prisma.InputJsonValue) : undefined,
        categories: b.categories.map(c => c.categorySlug), types: [], reasons: [],
        description: b.description, faqs: Array.isArray(b.faqs) && (b.faqs as unknown[]).length ? (b.faqs as Prisma.InputJsonValue) : undefined,
        establishedYear: b.establishedYear, languages: b.languages, teamSize: b.teamSize,
        status: 'approved', reviewedById: actorId, reviewedAt: new Date(), branchId: b.id, runId,
        crawl: { manual: true, seededAt: new Date().toISOString() },
      },
      update: { status: 'approved', branchId: b.id, reviewedAt: new Date() },
    });
    out.created.push(id);
  }
  if (out.created.length) await db.auditLog.create({ data: { actorId, action: 'import_record_seeded', subjectType: 'branch', subjectId: out.created[0], meta: { branchIds: out.created } } });
  return out;
}

// ---------- gaps ----------

export interface GapRow {
  branchId: string;
  businessId: string;
  name: string;
  cityName: string;
  regionSlug: string;
  categories: string[];
  href: string;
  live: boolean;
  claimed: boolean;
  hasCoords: boolean;
  hasPlace: boolean; // an import record exists (the pipeline can run without seeding)
  status: string;
  readiness: number;
  missing: string[];
  ownerOnly: string[];
  plan: StepId[];
  canEnhance: boolean;
  why: string | null; // when it cannot be enhanced
  lastRun: { at: Date; filled: string[]; skipped: string | null; editorial: string | null } | null;
  updatedAt: Date;
}

export interface GapFilter { region?: string; city?: string; category?: string; q?: string; missing?: string; status?: string; claimed?: 'all' | 'claimed' | 'unclaimed'; live?: 'all' | 'live'; branchIds?: string[]; take?: number; skip?: number; order?: 'updated' | 'created' }

export const GAP_SECTIONS = MANIFEST.filter(m => m.weight > 0).map(m => m.id);

/** Readiness, missing sections and the automatic plan for listings (any listing, import record or not). */
export async function listGaps(f: GapFilter = {}): Promise<{ rows: GapRow[]; total: number }> {
  const take = Math.min(f.take ?? 2000, 5000);
  const where: Prisma.BranchWhereInput = {
    ...(f.branchIds ? { id: { in: f.branchIds } } : {}),
    ...(f.live === 'all' ? {} : { status: 'live' }),
    ...(f.claimed === 'claimed' ? { isClaimed: true } : f.claimed === 'unclaimed' ? { isClaimed: false } : {}),
    ...(CATEGORIES.some(c => c.slug === f.category) ? { categories: { some: { categorySlug: f.category } } } : {}),
    ...(f.region ? { regionSlug: f.region as RegionSlug } : {}),
    ...(f.city ? { cityName: f.city } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { cityName: { contains: f.q, mode: 'insensitive' } }] } : {}),
  };
  const [branches, total, settings] = await Promise.all([
    db.branch.findMany({ where, include: { categories: true, treatments: { where: { isPublished: true }, select: { priceAgorot: true } } }, orderBy: f.order === 'created' ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }], take, skip: Math.max(0, Math.floor(f.skip ?? 0)) }),
    db.branch.count({ where }),
    getSettings(),
  ]);
  const ids = branches.map(b => b.id);
  const [places, verified, lastRuns] = await Promise.all([
    db.importPlace.findMany({ where: { branchId: { in: ids }, status: { in: ['approved', 'merged'] } }, select: { branchId: true, crawl: true, reasons: true, socials: true, website: true, websiteKind: true, placeId: true, sourceId: true, provider: true, instagram: true, facebook: true, editorial: true } }),
    db.staffMember.groupBy({ by: ['businessId'], where: { businessId: { in: [...new Set(branches.map(b => b.businessId))] }, status: 'active', license: { status: 'verified' } }, _count: true }),
    db.auditLog.findMany({ where: { action: 'import_enhance', subjectType: 'branch', subjectId: { in: ids } }, orderBy: { createdAt: 'desc' }, distinct: ['subjectId'], select: { subjectId: true, createdAt: true, meta: true } }),
  ]);
  const placeBy = new Map(places.map(p => [p.branchId!, p]));
  const verifiedBy = new Map(verified.map(v => [v.businessId, v._count]));
  const lastBy = new Map(lastRuns.map(a => [a.subjectId, a]));
  const planOpts = { settings, apifyConfigured: true };
  const rows: GapRow[] = branches.map(b => {
    const p = placeBy.get(b.id) ?? null;
    const crawl = (p?.crawl ?? {}) as Record<string, unknown>;
    const conflicts = [crawl.phoneConflict === true ? 'phone' : null, crawl.hoursConflict === true ? 'hours' : null].filter((x): x is string => !!x);
    const cov = branchCoverage(b, { verifiedStaff: verifiedBy.get(b.businessId) ?? 0, conflicts, reviewReasons: (p?.reasons ?? []).filter(r => !['medical_without_doctor_info', 'no_email'].includes(r)), socials: p ? socialCounts(p as never) : undefined });
    const signals: PlanSignals = p ? planSignals(p) : signalsOfBranch(b);
    const plan = planFor(cov.missing, signals, planOpts);
    const why = b.isClaimed ? 'בבעלות מאומתת: הנתונים של הבעלים, אין השלמה אוטומטית' : b.status !== 'live' ? 'הסניף לא מפורסם; ההשלמה עובדת על רישומים חיים' : b.lat == null || b.lng == null ? 'חסרות קואורדינטות; מלאו אותן בעריכה ואז הפעילו' : !plan.length ? 'אין צעד שיכול למלא את החסרים (ראו את התוכנית)' : null;
    const last = lastBy.get(b.id);
    const meta = (last?.meta ?? null) as { filled?: string[]; skipped?: string | null; editorial?: string | null } | null;
    return {
      branchId: b.id, businessId: b.businessId, name: b.name, cityName: b.cityName, regionSlug: b.regionSlug, categories: b.categories.map(c => c.categorySlug),
      href: profileHref(b), live: b.status === 'live', claimed: b.isClaimed, hasCoords: b.lat != null && b.lng != null, hasPlace: !!p,
      status: cov.status, readiness: cov.readiness, missing: cov.missing, ownerOnly: cov.ownerMissing, plan, canEnhance: !why, why,
      lastRun: last ? { at: last.createdAt, filled: meta?.filled ?? [], skipped: meta?.skipped ?? null, editorial: meta?.editorial ?? null } : null,
      updatedAt: b.updatedAt,
    };
  });
  const filtered = rows.filter(r => (!f.missing || r.missing.includes(f.missing)) && (!f.status || r.status === f.status));
  return { rows: filtered, total: f.missing || f.status ? filtered.length : total };
}

/** What the planner can assume about a listing that has no import record yet. */
function signalsOfBranch(b: Branch): PlanSignals {
  const w = classifyWebsite(b.websiteUrl);
  return { hasSite: !!w.url && w.kind === 'own', siteOutcome: null, siteThin: false, placeId: !!b.googlePlaceId, cid: false, instagram: !!b.instagram, facebook: !!b.facebook, hasEditorial: false, researchedAt: null };
}
