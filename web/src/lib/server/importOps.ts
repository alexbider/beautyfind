import 'server-only';
import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { Prisma, type ImportPlace, type RegionSlug } from '@prisma/client';
import { CATEGORIES, CITIES } from '@/lib/catalog';
import { CATEGORY_IMAGE } from '@/components/home/content';
import { db } from '@/lib/server/db';
import { VAT_RATE } from '@/lib/pricing';
import { cleanEmail, emailDomain, pickEmail } from '@/lib/import/email';
import { DUPLICATE_AT, isStrong, MatchPool, POSSIBLE_MATCH_AT, type PoolItem } from '@/lib/import/match';
import { normalizeIlPhone } from '@/lib/import/phone';
import { BLOCKING, EnhanceScope, qualify, RunScope, type ImportedTreatment } from '@/lib/import/rules';
import { loadSettings, parseSettings, type ImportSettings } from '@/lib/import/settings';
import { toMicros } from '@/lib/import/pricing';
import { commit, release } from '@/lib/import/budget';
import { classifyWebsite, KEEP_AS_WEBSITE } from '@/lib/import/websiteKind';
import { composeDescription } from '@/lib/import/completeness';
import { copyListingImages } from '@/lib/server/importMedia';

export type OpResult = { ok: true; branchId?: string; slug?: string } | { ok: false; error: string };
type Actor = { id: string };

const OPEN_FOR_DECISION = ['ready', 'needs_review'] as const;

// ---------- runs ----------

export interface CreateRunInput {
  label: string;
  provider: 'dataforseo' | 'google' | 'enhance';
  scope: unknown;
  recordLimit: number;
  budgetUsd: number;
  maxRequests?: number; // legacy Google provider only
}

export async function createRun(actor: Actor, input: CreateRunInput) {
  if (input.provider === 'enhance') {
    const scope = EnhanceScope.parse(input.scope);
    const s = await loadSettings(db);
    if (s.killSwitch && scope.refresh) throw new Error('kill_switch');
    return db.importRun.create({
      data: {
        label: input.label.trim().slice(0, 80) || 'העשרת עסקים שפורסמו',
        provider: 'enhance',
        scope,
        recordLimit: Math.max(1, Math.min(100_000, Math.round(input.recordLimit))),
        budgetMicros: toMicros(Math.max(0, Math.min(10_000, input.budgetUsd))),
        maxRequests: 0,
        createdById: actor.id,
      },
    });
  }
  const scope = RunScope.parse(input.scope);
  if (input.provider === 'google' && !scope.nearby && !scope.text) throw new Error('no_source');
  if (!scope.all && !scope.cities.length) throw new Error('no_cities');
  const s = await loadSettings(db);
  if (s.killSwitch) throw new Error('kill_switch');
  if (input.provider === 'dataforseo' && !s.dataforseoEnabled) throw new Error('provider_disabled');
  return db.importRun.create({
    data: {
      label: input.label.trim().slice(0, 80) || 'ייבוא',
      provider: input.provider,
      scope,
      recordLimit: Math.max(1, Math.min(100_000, Math.round(input.recordLimit))),
      budgetMicros: toMicros(Math.max(0, Math.min(10_000, input.budgetUsd))),
      maxRequests: Math.max(20, Math.min(200_000, Math.round(input.maxRequests ?? 2000))),
      createdById: actor.id,
    },
  });
}

// ---------- settings ----------

export async function getSettings(): Promise<ImportSettings> {
  return loadSettings(db);
}

export async function saveSettings(actor: Actor, values: unknown): Promise<ImportSettings> {
  const merged = parseSettings({ ...(await loadSettings(db)), ...(values && typeof values === 'object' ? values : {}) });
  await db.importSettings.upsert({ where: { id: 1 }, create: { id: 1, values: merged, updatedById: actor.id }, update: { values: merged, updatedById: actor.id } });
  await db.auditLog.create({ data: { actorId: actor.id, action: 'import_settings', subjectType: 'import_settings', subjectId: actor.id, meta: merged as unknown as Prisma.InputJsonValue } });
  return merged;
}

// ---------- reconciliation ----------

/**
 * A page whose outcome was unknown: staff check the provider's usage log, then either keep it as
 * billed or mark it not billed, and optionally send the page again under a new request key.
 */
export async function reconcileTask(actor: Actor, taskId: string, billed: boolean, retry: boolean) {
  const t = await db.importTask.findUnique({ where: { id: taskId } });
  if (!t || t.status !== 'needs_reconciliation') return { ok: false as const, error: 'state' };
  const params = t.params as { requestKey?: string; attempt?: number };
  if (params.requestKey) {
    const e = await db.spendEntry.findUnique({ where: { requestKey: params.requestKey } });
    // Worker stopped mid-call: the hold was never settled.
    if (e && e.status === 'reserved') {
      if (billed) await commit(db, e.requestKey, null, e.estimatedMicros);
      else await release(db, e.requestKey, 'reconciled: not billed');
    }
    if (e && e.status === 'needs_reconciliation') {
      await db.$transaction(async tx => {
        if (!billed) {
          // Undo the conservative charge.
          if (e.runId) await tx.$executeRaw`UPDATE import_runs SET spent_micros = GREATEST(spent_micros - ${e.estimatedMicros}, 0) WHERE id = ${e.runId}::uuid`;
        }
        await tx.spendEntry.update({ where: { id: e.id }, data: { status: billed ? 'committed' : 'released', actualMicros: billed ? e.estimatedMicros : 0n, meta: { ...((e.meta as object) ?? {}), reconciledBy: actor.id } } });
      });
    }
  }
  await db.importTask.update({
    where: { id: taskId },
    data: retry ? { status: 'pending', error: null, params: { ...(t.params as object), attempt: (params.attempt ?? 0) + 1, requestKey: undefined } } : { status: 'done', error: 'reconciled' },
  });
  if (retry) await db.importRun.updateMany({ where: { id: t.runId, status: { in: ['done', 'failed', 'paused'] } }, data: { status: 'queued', error: null, finishedAt: null } });
  await db.auditLog.create({ data: { actorId: actor.id, action: 'import_reconcile', subjectType: 'import_task', subjectId: taskId, meta: { billed, retry } } });
  return { ok: true as const };
}

/** Sends chosen records back through website enrichment (and the optional LLM) on their runs. */
export async function enrichSelected(actor: Actor, ids: string[]): Promise<{ count: number; runIds: string[] }> {
  const places = await db.importPlace.findMany({ where: { id: { in: ids }, status: { notIn: ['approved', 'merged', 'rejected'] } }, select: { id: true, runId: true, siteDomain: true } });
  if (!places.length) return { count: 0, runIds: [] };
  // Force a fresh read of those sites.
  const domains = [...new Set(places.map(p => p.siteDomain).filter((d): d is string => !!d))];
  if (domains.length) await db.siteFetch.updateMany({ where: { domain: { in: domains } }, data: { nextCheckAt: new Date(0) } });
  await db.importPlace.updateMany({ where: { id: { in: places.map(p => p.id) } }, data: { status: 'found', reasons: [] } });
  const runIds = [...new Set(places.map(p => p.runId))];
  await db.importRun.updateMany({ where: { id: { in: runIds }, status: { in: ['done', 'failed', 'paused'] } }, data: { status: 'queued', error: null, finishedAt: null } });
  await db.auditLog.create({ data: { actorId: actor.id, action: 'import_enrich_selected', subjectType: 'import_run', subjectId: runIds[0], meta: { ids: places.map(p => p.id) } } });
  return { count: places.length, runIds };
}

export async function setRunStatus(runId: string, action: 'pause' | 'resume' | 'cancel') {
  if (action === 'pause') return db.importRun.updateMany({ where: { id: runId, status: { in: ['queued', 'running'] } }, data: { status: 'paused' } });
  if (action === 'resume') return db.importRun.updateMany({ where: { id: runId, status: { in: ['paused', 'failed'] } }, data: { status: 'queued', error: null } });
  return db.importRun.updateMany({ where: { id: runId, status: { in: ['queued', 'running', 'paused', 'failed'] } }, data: { status: 'canceled', finishedAt: new Date() } });
}

/**
 * Sends a finished run's incomplete records (no email, failed extraction, no category) back through
 * enrichment and extraction. Google is not called again. Records staff already decided on are kept.
 */
export async function retryIncomplete(runId: string): Promise<number> {
  const n = await db.$executeRaw`
    UPDATE import_places SET status = 'found', reasons = '{}'
    WHERE run_id = ${runId}::uuid AND reviewed_by_id IS NULL
      AND (status = 'incomplete' OR (status = 'needs_review' AND 'extraction_failed' = ANY(reasons)))`;
  if (n) {
    await db.importRun.updateMany({
      where: { id: runId, status: { in: ['done', 'failed', 'paused'] } },
      data: { status: 'queued', error: null, finishedAt: null, extractionsUsed: 0, lockedBy: null, lockedUntil: null },
    });
  }
  return n;
}

/**
 * Starts the GitHub Actions worker (.github/workflows/import.yml). Needs GITHUB_DISPATCH_TOKEN, a
 * fine-grained token with "Actions: write" on the repository. Without it the run waits in the queue
 * until someone starts the workflow by hand.
 */
export async function dispatchWorker(runId: string): Promise<{ dispatched: boolean; reason?: string }> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY_SLUG || 'alexbider/beautyfind';
  if (!token) return { dispatched: false, reason: 'no_token' };
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/import.yml/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify({ ref: process.env.GITHUB_DISPATCH_REF || 'main', inputs: { run_id: runId } }),
  });
  if (res.status === 204) return { dispatched: true };
  return { dispatched: false, reason: `github_${res.status}` };
}

// ---------- decisions ----------

async function uniqueSlug(p: ImportPlace): Promise<string> {
  const latin = p.name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  // Hebrew names: category and city make a readable, stable base.
  const base = latin.length >= 4 ? latin : `${p.categories[0] ?? 'beauty'}-${p.citySlug ?? p.regionSlug ?? 'il'}`;
  for (;;) {
    const slug = `${base}-${randomBytes(2).toString('hex')}`;
    if (!(await db.branch.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
}

const netAgorot = (nis: number) => Math.round((nis * 100) / (1 + VAT_RATE)); // site prices include VAT

function treatmentRows(p: ImportPlace, cats: string[]): Prisma.TreatmentCreateWithoutBranchInput[] {
  const list = (Array.isArray(p.treatments) ? p.treatments : []) as unknown as ImportedTreatment[];
  return list.slice(0, 80).map((t, i) => ({
    name: t.name.slice(0, 120),
    category: t.category && cats.includes(t.category) ? { connect: { slug: t.category } } : undefined,
    priceType: t.priceType,
    priceAgorot: t.priceNis ? netAgorot(t.priceNis) : 0,
    durationMin: t.durationMin ?? null,
    isMedical: t.isMedical,
    requiresDeclaration: t.isMedical,
    onlineBookable: !t.isMedical,
    // No price on the site: kept for the owner to complete, hidden until then.
    isPublished: !!t.priceNis,
    sortOrder: i,
  }));
}

const isCategoryImage = (url: string) => Object.values(CATEGORY_IMAGE).includes(url);

/** Copies the chosen website logo and photos to our storage and sets them on the branch. */
async function applyImages(
  actor: Actor, p: ImportPlace, branchId: string, businessId: string, settings: ImportSettings, want: { logo: boolean; cover: boolean; gallery: boolean },
): Promise<{ logo: boolean; photos: number } | null> {
  if (!settings.useWebsiteImages || (!p.logoUrl && !p.photoUrls.length)) return null;
  if (!want.logo && !want.cover && !want.gallery) return null;
  const copied = await copyListingImages({ name: p.name, logoUrl: want.logo ? p.logoUrl : null, photoUrls: want.cover || want.gallery ? p.photoUrls : [] }, actor.id, businessId, settings.maxListingPhotos);
  const [cover, ...rest] = copied.photos;
  const data: Prisma.BranchUpdateInput = {};
  if (want.logo && copied.logoUrl) data.logoUrl = copied.logoUrl;
  if (want.cover && cover) {
    data.coverUrl = cover.url;
    data.coverAlt = p.name;
  }
  const gallery = want.cover ? rest : copied.photos;
  if (want.gallery && gallery.length) data.gallery = gallery as unknown as Prisma.InputJsonValue;
  if (Object.keys(data).length) await db.branch.update({ where: { id: branchId }, data });
  return { logo: !!data.logoUrl, photos: copied.photos.length };
}

async function audit(actor: Actor, action: string, p: ImportPlace, meta: Record<string, unknown>) {
  await db.auditLog.create({ data: { actorId: actor.id, action, subjectType: 'import_place', subjectId: p.id, meta: meta as Prisma.InputJsonValue } });
}

/** New listing from an import record. Unclaimed, live, with our category photo until the owner adds theirs. */
export async function approvePlace(actor: Actor, id: string): Promise<OpResult> {
  const p = await db.importPlace.findUnique({ where: { id } });
  if (!p) return { ok: false, error: 'not_found' };
  if (!(OPEN_FOR_DECISION as readonly string[]).includes(p.status)) return { ok: false, error: 'state' };
  if (p.reasons.some(r => (BLOCKING as readonly string[]).includes(r))) return { ok: false, error: 'incomplete' };
  const googleId = p.placeId.startsWith('dfs:') ? null : p.placeId;
  if (googleId && (await db.branch.findUnique({ where: { googlePlaceId: googleId }, select: { id: true } }))) return { ok: false, error: 'exists' };
  const settings = await loadSettings(db);
  // Provider ratings reach the listing only when the source's terms allow it (setting); never Google content.
  const rating = settings.publishProviderRatings && p.ratingProvider === 'dataforseo' ? { googleRating: p.googleRating, googleReviewCount: p.googleReviewCount } : { googleRating: null, googleReviewCount: null };

  const cats = p.categories.filter(c => CATEGORIES.some(x => x.slug === c));
  const city = p.citySlug ? await db.city.findUnique({ where: { slug: p.citySlug }, select: { id: true, name: true } }) : null;
  const slug = await uniqueSlug(p);
  const medical = cats.some(c => CATEGORIES.find(x => x.slug === c)?.isMedical);

  try {
    const branch = await db.$transaction(async tx => {
      // Optimistic lock: a second click or a second reviewer cannot approve the same record twice.
      const claimed = await tx.importPlace.updateMany({ where: { id, status: { in: [...OPEN_FOR_DECISION] } }, data: { status: 'approved' } });
      if (!claimed.count) throw new Error('state');
      const biz = await tx.business.create({ data: { status: 'live', type: p.businessType ?? (medical ? 'clinic' : 'salon') } });
      const b = await tx.branch.create({
        data: {
          businessId: biz.id,
          name: p.name,
          slug,
          regionSlug: p.regionSlug as RegionSlug,
          cityId: city?.id ?? null,
          cityName: city?.name ?? p.cityName ?? '',
          address: p.address.replace(/,?\s*ישראל$/, ''),
          lat: p.lat,
          lng: p.lng,
          phone: p.phone,
          whatsapp: p.whatsapp,
          email: p.email,
          hours: (p.hours ?? []) as Prisma.InputJsonValue,
          status: 'live',
          isClaimed: false,
          coverUrl: CATEGORY_IMAGE[cats[0]] ?? null,
          coverAlt: CATEGORY_IMAGE[cats[0]] ? `${CATEGORIES.find(c => c.slug === cats[0])!.name} ב${city?.name ?? p.cityName ?? 'ישראל'}` : null,
          ...rating,
          googlePlaceUrl: p.googleMapsUri,
          googlePlaceId: googleId,
          googleSyncedAt: rating.googleRating != null ? new Date() : null,
          description: p.description ?? composeDescription(p),
          faqs: Array.isArray(p.faqs) ? (p.faqs as Prisma.InputJsonValue) : [],
          accessible: p.accessible === true,
          freeParking: p.freeParking === true,
          wazeUrl: `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`,
          websiteUrl: p.website,
          instagram: p.instagram,
          categories: { create: cats.map(c => ({ categorySlug: c })) },
          treatments: { create: treatmentRows(p, cats) },
        },
      });
      await tx.importPlace.update({ where: { id }, data: { branchId: b.id, reviewedById: actor.id, reviewedAt: new Date() } });
      return b;
    });
    const images = await applyImages(actor, p, branch.id, branch.businessId, settings, { logo: true, cover: true, gallery: true });
    await audit(actor, 'import_approve', p, { branchId: branch.id, images });
    return { ok: true, branchId: branch.id, slug: branch.slug };
  } catch (e) {
    if (e instanceof Error && e.message === 'state') return { ok: false, error: 'state' };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: false, error: 'exists' };
    throw e;
  }
}

/** Fold an import record into an existing listing: fills only what the listing is missing. */
export async function mergePlace(actor: Actor, id: string, branchId: string): Promise<OpResult> {
  const p = await db.importPlace.findUnique({ where: { id } });
  if (!p) return { ok: false, error: 'not_found' };
  if (['approved', 'merged', 'rejected'].includes(p.status)) return { ok: false, error: 'state' };
  const b = await db.branch.findUnique({ where: { id: branchId }, include: { categories: true, _count: { select: { treatments: true } } } });
  if (!b) return { ok: false, error: 'no_branch' };
  const googleId = p.placeId.startsWith('dfs:') ? null : p.placeId;
  const placeTaken = googleId ? await db.branch.findUnique({ where: { googlePlaceId: googleId }, select: { id: true } }) : null;
  const settings = await loadSettings(db);
  const withRating = settings.publishProviderRatings && p.ratingProvider === 'dataforseo';
  if (placeTaken && placeTaken.id !== b.id) return { ok: false, error: 'exists' };

  const cats = p.categories.filter(c => CATEGORIES.some(x => x.slug === c));
  const emptyHours = !Array.isArray(b.hours) || b.hours.length === 0;
  await db.$transaction(async tx => {
    const claimed = await tx.importPlace.updateMany({ where: { id, status: { notIn: ['approved', 'merged', 'rejected'] } }, data: { status: 'merged' } });
    if (!claimed.count) throw new Error('state');
    const google = {
      googlePlaceId: b.googlePlaceId ?? googleId,
      googlePlaceUrl: b.googlePlaceUrl ?? p.googleMapsUri,
      ...(withRating ? { googleRating: p.googleRating ?? b.googleRating, googleReviewCount: p.googleReviewCount ?? b.googleReviewCount, googleSyncedAt: new Date() } : {}),
    };
    if (b.isClaimed) {
      // A claimed listing belongs to its owner: link the Google place and rating, nothing else.
      await tx.branch.update({ where: { id: b.id }, data: google });
      await tx.importPlace.update({ where: { id }, data: { branchId: b.id, reviewedById: actor.id, reviewedAt: new Date() } });
      return;
    }
    await tx.branch.update({
      where: { id: b.id },
      data: {
        phone: b.phone ?? p.phone,
        whatsapp: b.whatsapp ?? p.whatsapp,
        email: b.email ?? p.email,
        websiteUrl: b.websiteUrl ?? p.website,
        instagram: b.instagram ?? p.instagram,
        description: b.description ?? p.description ?? composeDescription(p),
        faqs: (!Array.isArray(b.faqs) || !b.faqs.length) && Array.isArray(p.faqs) ? (p.faqs as Prisma.InputJsonValue) : undefined,
        accessible: b.accessible || p.accessible === true,
        freeParking: b.freeParking || p.freeParking === true,
        wazeUrl: b.wazeUrl ?? (p.lat != null ? `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes` : null),
        lat: b.lat ?? p.lat,
        lng: b.lng ?? p.lng,
        hours: emptyHours && p.hours ? (p.hours as Prisma.InputJsonValue) : undefined,
        ...google,
      },
    });
    const have = new Set(b.categories.map(c => c.categorySlug));
    const add = cats.filter(c => !have.has(c));
    if (add.length) await tx.branchCategory.createMany({ data: add.map(c => ({ branchId: b.id, categorySlug: c })), skipDuplicates: true });
    // The owner's own menu always wins; imported treatments only fill an empty one.
    if (!b._count.treatments) for (const t of treatmentRows(p, [...have, ...add])) await tx.treatment.create({ data: { ...t, branch: { connect: { id: b.id } } } });
    await tx.importPlace.update({ where: { id }, data: { branchId: b.id, reviewedById: actor.id, reviewedAt: new Date() } });
  });
  // Images only fill what an unclaimed listing is missing; a claimed listing's photos belong to its owner.
  const galleryEmpty = !Array.isArray(b.gallery) || b.gallery.length === 0;
  const images = b.isClaimed ? null : await applyImages(actor, p, b.id, b.businessId, settings, { logo: !b.logoUrl, cover: !b.coverUrl || isCategoryImage(b.coverUrl), gallery: galleryEmpty });
  await audit(actor, 'import_merge', p, { branchId: b.id, images });
  return { ok: true, branchId: b.id, slug: b.slug };
}

export async function rejectPlace(actor: Actor, id: string, note: string | null): Promise<OpResult> {
  const p = await db.importPlace.findUnique({ where: { id } });
  if (!p) return { ok: false, error: 'not_found' };
  const r = await db.importPlace.updateMany({
    where: { id, status: { notIn: ['approved', 'merged'] } },
    data: { status: 'rejected', note: note?.slice(0, 300) ?? null, reviewedById: actor.id, reviewedAt: new Date() },
  });
  if (!r.count) return { ok: false, error: 'state' };
  await audit(actor, 'import_reject', p, { note });
  return { ok: true };
}

export async function markDuplicate(actor: Actor, id: string, ofId: string): Promise<OpResult> {
  if (id === ofId) return { ok: false, error: 'invalid' };
  const r = await db.importPlace.updateMany({
    where: { id, status: { notIn: ['approved', 'merged'] } },
    data: { status: 'duplicate', dupOfId: ofId, reviewedById: actor.id, reviewedAt: new Date() },
  });
  return r.count ? { ok: true } : { ok: false, error: 'state' };
}

/** Undo reject or duplicate: back into the queue with fresh checks. */
export async function restorePlace(actor: Actor, id: string): Promise<OpResult> {
  const r = await db.importPlace.updateMany({
    where: { id, status: { in: ['rejected', 'duplicate', 'closed'] } },
    data: { status: 'extracted', reviewedById: null, reviewedAt: null, note: null },
  });
  if (!r.count) return { ok: false, error: 'state' };
  await requalify(id);
  return { ok: true };
}

// ---------- edits ----------

async function mxOk(domain: string): Promise<boolean | null> {
  try {
    const mx = await dns.resolveMx(domain);
    return mx.some(r => r.exchange && r.exchange !== '.');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENODATA') return dns.resolve4(domain).then(a => a.length > 0, () => false);
    if (code === 'ENOTFOUND') return false;
    return null;
  }
}

export interface PlaceEdit {
  logoUrl?: string | null;
  photoUrls?: string[];
  name?: string;
  phone?: string;
  email?: string;
  website?: string;
  categories?: string[];
  citySlug?: string | null;
}

export async function editPlace(actor: Actor, id: string, e: PlaceEdit): Promise<OpResult> {
  const p = await db.importPlace.findUnique({ where: { id } });
  if (!p) return { ok: false, error: 'not_found' };
  if (['approved', 'merged'].includes(p.status)) return { ok: false, error: 'state' };
  const data: Prisma.ImportPlaceUpdateInput = {};
  if (e.name !== undefined) {
    if (!e.name.trim()) return { ok: false, error: 'name' };
    data.name = e.name.trim().slice(0, 120);
  }
  if (e.phone !== undefined) {
    const ph = e.phone.trim() ? normalizeIlPhone(e.phone) : null;
    if (e.phone.trim() && !ph) return { ok: false, error: 'phone' };
    data.phone = ph;
  }
  if (e.email !== undefined) {
    const em = e.email.trim() ? cleanEmail(e.email) : null;
    if (e.email.trim() && !em) return { ok: false, error: 'email' };
    data.email = em;
    data.emailSource = em ? 'manual' : null;
    data.emailMx = em ? await mxOk(emailDomain(em)) : null;
    if (em && data.emailMx === false) return { ok: false, error: 'email_mx' };
  }
  if (e.website !== undefined) {
    if (e.website.trim()) {
      const w = classifyWebsite(e.website);
      if (!w.url || !KEEP_AS_WEBSITE.includes(w.kind)) return { ok: false, error: w.kind === 'booking' ? 'website_booking' : 'website_directory' };
      data.website = w.url;
      data.websiteKind = w.kind;
    } else {
      data.website = null;
      data.websiteKind = null;
    }
  }
  if (e.logoUrl !== undefined || e.photoUrls !== undefined) {
    const cand = ((p.crawl as { imageCandidates?: { logos?: string[]; photos?: string[] } } | null)?.imageCandidates ?? {}) as { logos?: string[]; photos?: string[] };
    const allowed = new Set([...(cand.logos ?? []), ...(cand.photos ?? []), ...(p.logoUrl ? [p.logoUrl] : []), ...p.photoUrls]);
    if (e.logoUrl !== undefined) {
      if (e.logoUrl && !allowed.has(e.logoUrl)) return { ok: false, error: 'invalid' };
      data.logoUrl = e.logoUrl;
    }
    if (e.photoUrls !== undefined) {
      if (e.photoUrls.some(u => !allowed.has(u))) return { ok: false, error: 'invalid' };
      data.photoUrls = e.photoUrls.slice(0, 20);
    }
  }
  if (e.categories !== undefined) data.categories = e.categories.filter(c => CATEGORIES.some(x => x.slug === c));
  if (e.citySlug !== undefined) {
    const c = CITIES.find(x => x.slug === e.citySlug);
    if (e.citySlug && !c) return { ok: false, error: 'city' };
    data.citySlug = c?.slug ?? null;
    if (c) {
      data.cityName = c.name;
      data.regionSlug = c.region as RegionSlug;
    }
  }
  const edited = [...new Set([...(((p.crawl as { editedFields?: string[] } | null)?.editedFields ?? []) as string[]), ...Object.keys(e)])];
  data.crawl = { ...((p.crawl ?? {}) as object), editedFields: edited } as Prisma.InputJsonValue;
  if (data.email !== undefined) data.emailStatus = data.email ? (data.emailMx ? 'dns_valid' : 'syntax_valid') : null;
  await db.importPlace.update({ where: { id }, data });
  await audit(actor, 'import_edit', p, { fields: Object.keys(e) });
  await requalify(id);
  return { ok: true };
}

/** Re-runs the duplicate, match and completeness checks for one record (same rules as the worker). */
export async function requalify(id: string) {
  const p = await db.importPlace.findUniqueOrThrow({ where: { id } });
  const rules = await loadSettings(db);
  if (['approved', 'merged', 'rejected'].includes(p.status) || (p.status === 'duplicate' && p.reviewedById)) return;
  const near = { lat: { gte: p.lat - 0.005, lte: p.lat + 0.005 }, lng: { gte: p.lng - 0.006, lte: p.lng + 0.006 } };
  const or = <T>(xs: Array<T | false>) => xs.filter(Boolean) as T[];
  const [branches, others] = await Promise.all([
    db.branch.findMany({
      where: { OR: or<Prisma.BranchWhereInput>([near, !!p.phone && { phone: p.phone }, !!p.email && { email: p.email }, { googlePlaceId: p.placeId }]) },
      select: { id: true, name: true, lat: true, lng: true, phone: true, email: true, websiteUrl: true, googlePlaceId: true },
      take: 200,
    }),
    db.importPlace.findMany({
      where: {
        id: { not: p.id },
        createdAt: { lt: p.createdAt },
        status: { notIn: ['rejected', 'duplicate', 'closed'] },
        OR: or<Prisma.ImportPlaceWhereInput>([near, !!p.phone && { phone: p.phone }, !!p.email && { email: p.email }]),
      },
      take: 200,
    }),
  ]);
  const self: PoolItem = { id: p.id, kind: 'import', name: p.name, lat: p.lat, lng: p.lng, phone: p.phone, email: p.email, website: p.website, googlePlaceId: p.placeId.startsWith('dfs:') ? null : p.placeId };
  const bp = new MatchPool();
  for (const b of branches) bp.add({ id: b.id, kind: 'branch', name: b.name, lat: b.lat, lng: b.lng, phone: b.phone, email: b.email, website: b.websiteUrl, googlePlaceId: b.googlePlaceId });
  const ip = new MatchPool();
  for (const o of others) ip.add({ id: o.id, kind: 'import', name: o.name, lat: o.lat, lng: o.lng, phone: o.phone, email: o.email, website: o.website, googlePlaceId: o.placeId });

  const twin = ip.best(self, p.id);
  if (twin && twin.score >= DUPLICATE_AT && isStrong(twin.reasons)) {
    await db.importPlace.update({ where: { id }, data: { status: 'duplicate', dupOfId: twin.item.id, reasons: twin.reasons } });
    return;
  }
  const existing = bp.best(self);
  const possible = !!existing && existing.score >= POSSIBLE_MATCH_AT;
  const maybeTwin = twin && twin.score >= POSSIBLE_MATCH_AT ? twin : null;
  const crawl = (p.crawl ?? {}) as Record<string, unknown>;
  const tier = p.emailSource === 'manual' ? 'own' : ((crawl.emailTier as 'own' | 'free' | 'other' | null | undefined) ?? pickEmail(p.email ? [p.email] : [], p.website)?.tier ?? null);
  const shared = !!p.phone && [...branches, ...others].some(x => x.phone === p.phone && x.id !== existing?.item.id && x.id !== maybeTwin?.item.id);
  const q = qualify({
    name: p.name,
    phone: p.phone,
    email: p.email,
    emailMx: p.emailMx,
    emailTier: tier,
    categories: p.categories,
    businessStatus: p.businessStatus,
    citySlug: p.citySlug,
    notBeauty: crawl.notBeauty === true || crawl.skipped === 'off_topic',
    extractionFailed: typeof crawl.extractError === 'string',
      emailFromSearch: p.emailSource === 'search',
    possibleExisting: possible,
    possibleDuplicate: !!maybeTwin,
    sharedPhone: shared,
    hasWebsite: !!p.website,
    hasLocation: !!(p.address || p.citySlug || (p.lat != null && p.lng != null)),
    phoneConflict: crawl.phoneConflict === true,
    hoursConflict: crawl.hoursConflict === true,
        websiteUnverified: crawl.siteBelongs === 'unknown' && !!p.website,
  }, { requirePhoneOrEmail: rules.requirePhoneOrEmail, requireEmail: rules.requireEmail, requirePhoneOrWebsite: rules.requirePhoneOrWebsite });
  await db.importPlace.update({
    where: { id },
    data: {
      status: q.status,
      reasons: q.reasons,
      dupOfId: maybeTwin?.item.id ?? null,
      matchBranchId: possible ? existing!.item.id : null,
      matchScore: possible ? existing!.score : null,
      matchReasons: possible ? existing!.reasons : [],
    },
  });
}
