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
import { BLOCKING, qualify, RunScope, type ImportedTreatment } from '@/lib/import/rules';

export type OpResult = { ok: true; branchId?: string; slug?: string } | { ok: false; error: string };
type Actor = { id: string };

const OPEN_FOR_DECISION = ['ready', 'needs_review'] as const;

// ---------- runs ----------

export async function createRun(actor: Actor, input: { label: string; scope: unknown; maxRequests: number; maxExtractions: number | null }) {
  const scope = RunScope.parse(input.scope);
  if (!scope.nearby && !scope.text) throw new Error('no_source');
  if (!scope.all && !scope.cities.length) throw new Error('no_cities');
  return db.importRun.create({
    data: {
      label: input.label.trim().slice(0, 80) || 'ייבוא',
      scope,
      maxRequests: Math.max(20, Math.min(200_000, Math.round(input.maxRequests))),
      maxExtractions: input.maxExtractions == null ? null : Math.max(0, Math.round(input.maxExtractions)),
      createdById: actor.id,
    },
  });
}

export async function setRunStatus(runId: string, action: 'pause' | 'resume' | 'cancel') {
  if (action === 'pause') return db.importRun.updateMany({ where: { id: runId, status: { in: ['queued', 'running'] } }, data: { status: 'paused' } });
  if (action === 'resume') return db.importRun.updateMany({ where: { id: runId, status: { in: ['paused', 'failed'] } }, data: { status: 'queued', error: null } });
  return db.importRun.updateMany({ where: { id: runId, status: { in: ['queued', 'running', 'paused', 'failed'] } }, data: { status: 'canceled', finishedAt: new Date() } });
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

async function audit(actor: Actor, action: string, p: ImportPlace, meta: Record<string, unknown>) {
  await db.auditLog.create({ data: { actorId: actor.id, action, subjectType: 'import_place', subjectId: p.id, meta: meta as Prisma.InputJsonValue } });
}

/** New listing from an import record. Unclaimed, live, with our category photo until the owner adds theirs. */
export async function approvePlace(actor: Actor, id: string): Promise<OpResult> {
  const p = await db.importPlace.findUnique({ where: { id } });
  if (!p) return { ok: false, error: 'not_found' };
  if (!(OPEN_FOR_DECISION as readonly string[]).includes(p.status)) return { ok: false, error: 'state' };
  if (p.reasons.some(r => (BLOCKING as readonly string[]).includes(r))) return { ok: false, error: 'incomplete' };
  if (await db.branch.findUnique({ where: { googlePlaceId: p.placeId }, select: { id: true } })) return { ok: false, error: 'exists' };

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
          googleRating: p.googleRating,
          googleReviewCount: p.googleReviewCount,
          googlePlaceUrl: p.googleMapsUri,
          googlePlaceId: p.placeId,
          googleSyncedAt: new Date(),
          description: p.description,
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
    await audit(actor, 'import_approve', p, { branchId: branch.id });
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
  const placeTaken = await db.branch.findUnique({ where: { googlePlaceId: p.placeId }, select: { id: true } });
  if (placeTaken && placeTaken.id !== b.id) return { ok: false, error: 'exists' };

  const cats = p.categories.filter(c => CATEGORIES.some(x => x.slug === c));
  const emptyHours = !Array.isArray(b.hours) || b.hours.length === 0;
  await db.$transaction(async tx => {
    const claimed = await tx.importPlace.updateMany({ where: { id, status: { notIn: ['approved', 'merged', 'rejected'] } }, data: { status: 'merged' } });
    if (!claimed.count) throw new Error('state');
    const google = {
      googlePlaceId: b.googlePlaceId ?? p.placeId,
      googleRating: p.googleRating ?? b.googleRating,
      googleReviewCount: p.googleReviewCount ?? b.googleReviewCount,
      googlePlaceUrl: b.googlePlaceUrl ?? p.googleMapsUri,
      googleSyncedAt: new Date(),
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
        description: b.description ?? p.description,
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
  await audit(actor, 'import_merge', p, { branchId: b.id });
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
  if (e.website !== undefined) data.website = e.website.trim() || null;
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
  await db.importPlace.update({ where: { id }, data });
  await audit(actor, 'import_edit', p, { fields: Object.keys(data) });
  await requalify(id);
  return { ok: true };
}

/** Re-runs the duplicate, match and completeness checks for one record (same rules as the worker). */
export async function requalify(id: string) {
  const p = await db.importPlace.findUniqueOrThrow({ where: { id } });
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
  const self: PoolItem = { id: p.id, kind: 'import', name: p.name, lat: p.lat, lng: p.lng, phone: p.phone, email: p.email, website: p.website, googlePlaceId: p.placeId };
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
    possibleExisting: possible,
    possibleDuplicate: !!maybeTwin,
    sharedPhone: shared,
  });
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
