// Dedupe, match against live listings, and decide ready / needs_review / incomplete for every open
// record (whole import, so a business found by two runs stays one record).

import { Prisma, type ImportPlace, type ImportRun } from '@prisma/client';
import { pickEmail } from '../../../src/lib/import/email';
import { DUPLICATE_AT, isStrong, MatchPool, POSSIBLE_MATCH_AT, type PoolItem } from '../../../src/lib/import/match';
import { qualify } from '../../../src/lib/import/rules';
import { db, heartbeat, log, setStats, settings } from '../ctx';

const OPEN: ImportPlace['status'][] = ['extracted', 'ready', 'needs_review', 'incomplete', 'duplicate', 'closed'];

export async function check(run: ImportRun) {
  await heartbeat(run.id);
  const s = await settings();
  const places = await db.importPlace.findMany({ where: { status: { in: [...OPEN, 'approved', 'merged'] } }, orderBy: { createdAt: 'asc' } });
  const branches = await db.branch.findMany({ select: { id: true, name: true, lat: true, lng: true, phone: true, email: true, websiteUrl: true, googlePlaceId: true } });

  const branchPool = new MatchPool();
  for (const b of branches) branchPool.add({ id: b.id, kind: 'branch', name: b.name, lat: b.lat, lng: b.lng, phone: b.phone, email: b.email, website: b.websiteUrl, googlePlaceId: b.googlePlaceId });

  const importPool = new MatchPool();
  const dupIds = new Set<string>();
  const updates: Array<{ id: string; data: Prisma.ImportPlaceUpdateInput }> = [];
  const asItem = (p: ImportPlace): PoolItem => ({ id: p.id, kind: 'import', name: p.name, lat: p.lat, lng: p.lng, phone: p.phone, email: p.email, website: p.website, googlePlaceId: p.placeId.startsWith('dfs:') ? null : p.placeId });

  for (const p of places) {
    const item = asItem(p);
    const final = p.status === 'approved' || p.status === 'merged' || (p.status === 'duplicate' && p.reviewedById);
    if (final) {
      if (p.status === 'duplicate') dupIds.add(p.id);
      else importPool.add(item);
      continue;
    }
    const twin = importPool.best(item, p.id);
    if (twin && twin.score >= DUPLICATE_AT && isStrong(twin.reasons)) {
      dupIds.add(p.id);
      updates.push({ id: p.id, data: { status: 'duplicate', dupOfId: twin.item.id, reasons: twin.reasons, matchReasons: twin.reasons } });
      continue;
    }
    importPool.add(item);

    const existing = branchPool.best({ ...item }, undefined);
    const crawl = (p.crawl ?? {}) as Record<string, unknown>;
    if (existing && existing.reasons.includes('same_place_id')) {
      updates.push({ id: p.id, data: { status: 'merged', branchId: existing.item.id, matchBranchId: existing.item.id, matchScore: 1, matchReasons: existing.reasons } });
      continue;
    }
    const possible = !!existing && existing.score >= POSSIBLE_MATCH_AT;
    const maybeTwin = twin && twin.score >= POSSIBLE_MATCH_AT ? twin : null;
    const tier = p.emailSource === 'manual' ? 'own' : (pickEmail(p.email ? [p.email] : [], p.website)?.tier ?? null);
    const q = qualify(
      {
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
        sharedPhone: false,
        hasWebsite: !!p.website,
        hasLocation: !!(p.address || p.citySlug || (p.lat != null && p.lng != null)),
        phoneConflict: crawl.phoneConflict === true,
        hoursConflict: crawl.hoursConflict === true,
        websiteUnverified: crawl.siteBelongs === 'unknown' && !!p.website,
      },
      { requirePhoneOrEmail: s.requirePhoneOrEmail, requireEmail: s.requireEmail, requirePhoneOrWebsite: s.requirePhoneOrWebsite },
    );
    updates.push({
      id: p.id,
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

  // Same phone as a different business: a person should look (chains, shared receptions).
  const phonePool = new MatchPool();
  for (const p of places) if (!dupIds.has(p.id) && p.status !== 'closed') phonePool.add(asItem(p));
  for (const b of branches) phonePool.add({ id: b.id, kind: 'branch', name: b.name, lat: b.lat, lng: b.lng, phone: b.phone, email: null, website: null });
  const byId = new Map(places.map(p => [p.id, p]));
  for (const u of updates) {
    const status = u.data.status as string;
    if (status !== 'ready' && status !== 'needs_review') continue;
    const p = byId.get(u.id)!;
    const skip = new Set<string>([...(p.matchBranchId ? [p.matchBranchId] : []), ...((u.data.matchBranchId as string | null) ? [u.data.matchBranchId as string] : [])]);
    if (phonePool.sharesPhone(asItem(p), p.id, skip)) u.data = { ...u.data, status: 'needs_review', reasons: [...((u.data.reasons as string[]) ?? []), 'shared_phone'] };
  }
  for (let i = 0; i < updates.length; i += 200) {
    await db.$transaction(updates.slice(i, i + 200).map(u => db.importPlace.update({ where: { id: u.id }, data: u.data })));
  }

  // Provider ratings on published listings: only when the source's terms allow it (setting).
  if (s.publishProviderRatings) {
    for (const p of places.filter(x => x.branchId && (x.status === 'approved' || x.status === 'merged') && x.ratingProvider === 'dataforseo')) {
      await db.branch.updateMany({ where: { id: p.branchId!, googlePlaceId: p.placeId }, data: { googleRating: p.googleRating, googleReviewCount: p.googleReviewCount, googleSyncedAt: new Date() } });
    }
  }

  const counts = await db.importPlace.groupBy({ by: ['status'], where: { runId: run.id }, _count: true });
  await setStats(run.id, { byStatus: Object.fromEntries(counts.map(c => [c.status, c._count])) });
  log(`checked ${updates.length} records`);
}
