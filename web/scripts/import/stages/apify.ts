// Stage 2E: Apify actors for the gaps DataForSEO and the business's own website leave behind
// (src/lib/import/apify.ts explains the three actors; sites that need JavaScript are the render stage's job). Runs only inside enhance runs, for the listings
// whose plan names the step (src/lib/import/enrichPlan.ts).
//
// One task = one actor run over a small batch. Its request key reserves the gross maximum against the
// run budget, the per-run Apify cap and the monthly Apify cap before the actor is started; the run id
// is written on the task at once, so a worker that stops mid-way resumes the same actor run instead of
// paying for a second one. The recorded cost is what Apify reports for the run (usageTotalUsd).

import { Prisma, type ImportPlace, type ImportRun } from '@prisma/client';
import {
  APIFY_PROVIDER, apifyErrorKind, facebookFacts, facebookInput, instagramFacts, instagramHandle, instagramInput, mapsFacts, mapsInput, profileMatches,
  type ApifyActorKind, type FacebookItem, type InstagramItem, type MapsItem, type ProfileFacts,
} from '../../../src/lib/import/apify';
import { BudgetExceeded, commit, monthKey, release, reserve, uncertain, withCaps } from '../../../src/lib/import/budget';
import { cleanEmail, emailDomain, siteHost } from '../../../src/lib/import/email';
import { largerGoogleImage } from '../../../src/lib/import/dataforseo';
import { apifyItemUsd, pricing, toMicros } from '../../../src/lib/import/pricing';
import type { SocialAccount, Socials } from '../../../src/lib/import/socials';
import { expiryFor, mayPublish } from '../../../src/lib/import/sourcePolicy';
import { classifyWebsite, KEEP_AS_WEBSITE } from '../../../src/lib/import/websiteKind';
import { bump, db, hasMx, heartbeat, log, setStats, settings, Stop } from '../ctx';
import { apifyConfigured, datasetItems, getRun, startActorRun, type ApifyRun } from '../providers/apify';

export const APIFY_KINDS: ApifyActorKind[] = ['maps', 'facebook', 'instagram'];
export const taskKind = (k: ApifyActorKind) => `apify_${k}`;

export interface ApifyTarget {
  id: string; // import record id
  placeId?: string | null;
  cid?: string | null;
  handle?: string | null; // instagram
  url?: string | null; // facebook page or website
}

interface TaskParams {
  kind: ApifyActorKind;
  targets: ApifyTarget[];
  requestKey?: string;
  apifyRunId?: string;
  datasetId?: string;
  startedAt?: number;
  polls?: number;
}

const POLL_WAIT_SECS = 45;
const MAX_WAIT_MS = 32 * 60_000; // actor timeout is 30 minutes

/** Creates the actor tasks of a run from the per-record plans. Returns how many tasks were created per kind. */
export async function seedApifyTasks(run: ImportRun, plans: Map<string, Set<string>>, places: Array<Pick<ImportPlace, 'id' | 'placeId' | 'sourceId' | 'provider' | 'website' | 'instagram' | 'facebook' | 'socials' | 'crawl'>>): Promise<Record<string, number>> {
  const s = await settings();
  const out: Record<string, number> = {};
  const batches: Record<ApifyActorKind, number> = { maps: 50, facebook: 20, instagram: 50 };
  const targetsOf = (kind: ApifyActorKind): ApifyTarget[] =>
    places
      .filter(p => plans.get(p.id)?.has(kind))
      .map(p => {
        const socials = (p.socials ?? {}) as Socials;
        if (kind === 'maps') return { id: p.id, placeId: p.placeId.startsWith('dfs:') ? null : p.placeId, cid: p.provider === 'dataforseo' && p.sourceId && /^\d+$/.test(p.sourceId) ? p.sourceId : null };
        if (kind === 'instagram') return { id: p.id, handle: instagramHandle(p.instagram ?? socials.instagram?.url) };
        return { id: p.id, url: p.facebook ?? socials.facebook?.url ?? null };
      })
      .filter(t => (t.placeId || t.cid || t.handle || t.url));
  if (!s.apifyEnabled) return out;
  const tasks: Prisma.ImportTaskCreateManyInput[] = [];
  for (const kind of APIFY_KINDS) {
    const enabled = kind === 'maps' ? s.apifyMaps : kind === 'instagram' ? s.apifyInstagram : s.apifyFacebook;
    if (!enabled) continue;
    const targets = targetsOf(kind);
    for (let i = 0; i < targets.length; i += batches[kind]) {
      const slice = targets.slice(i, i + batches[kind]);
      tasks.push({ runId: run.id, key: `${taskKind(kind)}:${i}`, kind: taskKind(kind), params: { kind, targets: slice } as unknown as Prisma.InputJsonValue });
      out[kind] = (out[kind] ?? 0) + slice.length;
    }
  }
  if (tasks.length) await db.importTask.createMany({ data: tasks, skipDuplicates: true });
  return out;
}

function estimateFor(kind: ApifyActorKind, targets: ApifyTarget[]): bigint {
  const p = pricing();
  return toMicros(Math.max(0.001, apifyItemUsd(kind, p) * targets.length * p.apify.reserveFactor));
}

/** Runs one pending or dispatched Apify task of the given kind. Returns false when none is left. */
export async function apifyStage(run: ImportRun, kind: ApifyActorKind): Promise<boolean> {
  const task = await db.importTask.findFirst({ where: { runId: run.id, kind: taskKind(kind), status: { in: ['pending', 'dispatched'] } }, orderBy: { createdAt: 'asc' } });
  if (!task) return false;
  await heartbeat(run.id);
  const s = await settings();
  if (s.killSwitch) throw new Stop('kill switch on');
  const params = task.params as unknown as TaskParams;
  if (!apifyConfigured()) {
    await db.importTask.updateMany({ where: { runId: run.id, kind: { startsWith: 'apify_' }, status: 'pending' }, data: { status: 'failed', error: 'APIFY_TOKEN not set on the worker' } });
    await setStats(run.id, { apifyMissingToken: true });
    log('apify: APIFY_TOKEN not set, actor tasks skipped');
    return true;
  }
  const estimate = estimateFor(kind, params.targets);

  if (!params.apifyRunId) {
    const requestKey = params.requestKey ?? `apify:${task.id}`;
    try {
      const st = await reserve(db, withCaps({
        runId: run.id, provider: 'apify', endpoint: pricing().apify.actors[kind], requestKey, estimateMicros: estimate,
        caps: [{ key: `apify:run:${run.id}`, limitMicros: toMicros(s.apifyBudgetUsd) }, { key: monthKey('apify'), limitMicros: toMicros(s.apifyMonthlyUsd) }],
        meta: { kind, items: params.targets.length },
      }));
      if (st === 'exists') {
        await db.importTask.update({ where: { id: task.id }, data: { status: 'needs_reconciliation', error: 'already sent', params: { ...params, requestKey } as unknown as Prisma.InputJsonValue } });
        return true;
      }
    } catch (e) {
      if (e instanceof BudgetExceeded) {
        await db.importTask.update({ where: { id: task.id }, data: { status: 'done', error: 'budget' } });
        await setStats(run.id, { budgetHit: true, apifyBudgetHit: e.scope });
        log(`apify ${kind}: budget reached (${e.scope}), task skipped`);
        return true;
      }
      throw e;
    }
    await db.importTask.update({ where: { id: task.id }, data: { status: 'dispatched', params: { ...params, requestKey } as unknown as Prisma.InputJsonValue } });
    const input =
      kind === 'maps' ? mapsInput(params.targets.map(t => ({ id: t.id, placeId: t.placeId ?? null, cid: t.cid ?? null })), { maxImages: s.apifyMaxImages })
      : kind === 'instagram' ? instagramInput([...new Set(params.targets.map(t => t.handle!).filter(Boolean))])
      : facebookInput([...new Set(params.targets.map(t => t.url!).filter(Boolean))]);
    const started = await startActorRun(pricing().apify.actors[kind], input, { timeoutSecs: 1800, memoryMb: 2048 });
    if (started.kind === 'not_sent') {
      await release(db, requestKey, started.message);
      await db.importTask.update({ where: { id: task.id }, data: { status: 'failed', error: started.message } });
      return true;
    }
    if (started.kind === 'uncertain') {
      await uncertain(db, requestKey, estimate, started.message);
      await db.importTask.update({ where: { id: task.id }, data: { status: 'needs_reconciliation', error: started.message } });
      return true;
    }
    if (started.kind === 'error') {
      await release(db, requestKey, started.message);
      const why = apifyErrorKind(started.status, `${started.type ?? ''} ${started.message}`);
      await db.importTask.update({ where: { id: task.id }, data: { status: 'failed', error: `Apify ${started.type ?? started.status}: ${started.message}` } });
      // Out of credit or a bad token stops the run so staff see it and the recover button applies; anything else skips the batch.
      if (why === 'funds' || why === 'auth') throw new Error(`Apify ${started.type ?? started.status ?? ''}: ${started.message}`);
      log(`apify ${kind}: start failed`, started.status, started.message);
      return true;
    }
    Object.assign(params, { requestKey, apifyRunId: started.run.id, datasetId: started.run.defaultDatasetId, startedAt: Date.now(), polls: 0 });
    await db.importTask.update({ where: { id: task.id }, data: { params: params as unknown as Prisma.InputJsonValue } });
    await bump(run.id, { apifyRuns: 1, [`apify_${kind}_items`]: params.targets.length });
    log(`apify ${kind}: run ${started.run.id} started for ${params.targets.length} records`);
  }

  // Wait for the run, renewing the lease between polls.
  let final: ApifyRun | null = null;
  let unavailable = 0;
  const startedAt = params.startedAt ?? Date.now();
  while (!final) {
    await heartbeat(run.id);
    const r = await getRun(params.apifyRunId!, POLL_WAIT_SECS);
    if (r.kind === 'unavailable') {
      if (++unavailable >= 6) throw new Error(`Apify unreachable while waiting for run ${params.apifyRunId}: ${r.message}`);
      await new Promise(res => setTimeout(res, 20_000));
      continue;
    }
    if (r.kind === 'error') {
      // The run is gone (deleted on Apify?): keep the estimate as spent and let staff reconcile.
      await uncertain(db, params.requestKey!, estimate, `run lookup ${r.status}: ${r.message}`);
      await db.importTask.update({ where: { id: task.id }, data: { status: 'needs_reconciliation', error: `run lookup failed: ${r.message}` } });
      return true;
    }
    if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(r.run.status)) final = r.run;
    else if (Date.now() - startedAt > MAX_WAIT_MS) {
      await commit(db, params.requestKey!, r.run.usageTotalUsd != null ? toMicros(r.run.usageTotalUsd) : null, estimate);
      await db.importTask.update({ where: { id: task.id }, data: { status: 'failed', error: `actor run still ${r.run.status} after 32 minutes` } });
      return true;
    }
  }
  const cost = final.usageTotalUsd != null ? toMicros(final.usageTotalUsd) : null;
  await commit(db, params.requestKey!, cost, estimate);
  if (final.status !== 'SUCCEEDED') {
    await db.importTask.update({ where: { id: task.id }, data: { status: 'failed', error: `actor run ${final.status}: ${final.statusMessage ?? ''}`.trim() } });
    await bump(run.id, { apifyFailedRuns: 1 });
    return true;
  }
  const items = await datasetItems(final.defaultDatasetId || params.datasetId || '');
  if (!items) {
    await db.importTask.update({ where: { id: task.id }, data: { status: 'failed', error: 'dataset unreadable' } });
    return true;
  }
  const costUsd = final.usageTotalUsd ?? Number(estimate) / 1_000_000;
  const n = await apply(kind, params.targets, items, s, { runId: params.apifyRunId!, costUsd });
  await db.importTask.update({ where: { id: task.id }, data: { status: 'done', found: n } });
  await bump(run.id, { [`apify_${kind}_matched`]: n });
  log(`apify ${kind}: ${items.length} items, ${n} records updated, $${costUsd.toFixed(4)}`);
  return true;
}

type Obs = Prisma.FieldObservationCreateManyInput;
type Crawl = Record<string, unknown> & { imageCandidates?: { logos?: string[]; photos?: string[] }; mediaCandidates?: Array<Record<string, unknown>>; editedFields?: string[]; apify?: Record<string, unknown> };

async function apply(kind: ApifyActorKind, targets: ApifyTarget[], items: unknown[], s: Awaited<ReturnType<typeof settings>>, meta: { runId: string; costUsd: number }): Promise<number> {
  const share = targets.length ? meta.costUsd / targets.length : 0;
  let n = 0;
  for (const t of targets) {
    const p = await db.importPlace.findUnique({ where: { id: t.id } });
    if (!p) continue;
    const changed =
      kind === 'maps' ? await applyMaps(p, t, items as MapsItem[], s, meta.runId)
      : kind === 'instagram' ? await applyProfile(p, 'instagram', pickInstagram(t, items as InstagramItem[], s), s, meta.runId)
      : await applyProfile(p, 'facebook', pickFacebook(t, items as FacebookItem[]), s, meta.runId);
    if (changed) n++;
    const costs = (p.costs as Record<string, number> | null) ?? {};
    await db.importPlace.update({ where: { id: p.id }, data: { costs: { ...costs, apifyUsd: (costs.apifyUsd ?? 0) + share } as Prisma.InputJsonValue } });
  }
  return n;
}

const obsRow = (p: ImportPlace, provider: string, field: string, value: unknown, sourceUrl: string | null, confidence: number, evidence: string, status?: string, s?: Awaited<ReturnType<typeof settings>>): Obs => ({
  importPlaceId: p.id, field, value: value as Prisma.InputJsonValue, provider, sourceUrl, retrievedAt: new Date(), confidence, evidence: evidence.slice(0, 300),
  retention: expiryFor(provider) ? 'until_expiry' : 'permanent', expiresAt: expiryFor(provider),
  publishable: mayPublish(provider, field, { publishProviderRatings: s?.publishProviderRatings, useProviderImages: s?.useProviderImages, useWebsiteImages: s?.useWebsiteImages }), status,
});

async function saveObs(p: ImportPlace, provider: string, obs: Obs[]) {
  await db.$transaction([db.fieldObservation.deleteMany({ where: { importPlaceId: p.id, provider } }), db.fieldObservation.createMany({ data: obs })]);
}

const addCandidates = (crawl: Crawl, urls: Array<{ url: string; pageUrl: string | null; provider: string; evidence: string }>, logos: string[]) => {
  const c = crawl.imageCandidates ?? {};
  const known = new Set([...(c.photos ?? [])]);
  const fresh = urls.filter(u => !known.has(u.url));
  crawl.imageCandidates = { logos: [...new Set([...(c.logos ?? []), ...logos])], photos: [...(c.photos ?? []), ...fresh.map(u => u.url)] };
  crawl.mediaCandidates = [...(crawl.mediaCandidates ?? []), ...fresh.map(u => ({ ...u, retrievedAt: new Date().toISOString() }))].slice(0, 60);
};

async function applyMaps(p: ImportPlace, t: ApifyTarget, items: MapsItem[], s: Awaited<ReturnType<typeof settings>>, runId: string): Promise<boolean> {
  const it = items.find(x => (t.placeId && x.placeId === t.placeId) || (t.cid && x.cid != null && String(x.cid) === t.cid));
  const crawl = ((p.crawl ?? {}) as Crawl);
  crawl.apify = { ...(crawl.apify ?? {}), maps: { at: new Date().toISOString(), runId, found: !!it } };
  if (!it) {
    await db.importPlace.update({ where: { id: p.id }, data: { crawl: crawl as Prisma.InputJsonValue } });
    return false;
  }
  const f = mapsFacts(it, { maxPhotos: s.apifyMaxImages });
  const provider = APIFY_PROVIDER.maps;
  const src = f.sourceUrl;
  const edited = new Set(crawl.editedFields ?? []);
  const obs: Obs[] = [];
  const data: Prisma.ImportPlaceUpdateInput = {};
  if (f.phone) {
    obs.push(obsRow(p, provider, 'phone', f.phone, src, 0.8, 'Phone on the Google Business Profile', 'published', s));
    if (!p.phone && !edited.has('phone')) data.phone = f.phone;
    else if (p.phone && f.phone !== p.phone) (crawl as Record<string, unknown>).phoneConflict = true;
  }
  if (f.website) {
    const w = classifyWebsite(f.website);
    obs.push(obsRow(p, provider, 'website', f.website, src, 0.7, `Website link on the Google Business Profile (${w.kind})`, undefined, s));
    if (!p.website && !edited.has('website') && w.url && KEEP_AS_WEBSITE.includes(w.kind)) Object.assign(data, { website: w.url, websiteKind: w.kind, siteDomain: w.kind === 'own' ? siteHost(w.url) : null });
    if (w.kind === 'booking' && !p.bookingUrl) data.bookingUrl = w.url;
  }
  for (const b of f.bookingLinks) if (!p.bookingUrl && !data.bookingUrl && classifyWebsite(b).kind === 'booking') data.bookingUrl = b;
  if (f.hours) {
    obs.push(obsRow(p, provider, 'hours', f.hours, src, 0.8, 'Opening hours on the Google Business Profile', undefined, s));
    if (!p.hours) data.hours = f.hours as unknown as Prisma.InputJsonValue;
  }
  if (f.description) {
    obs.push(obsRow(p, provider, 'description', f.description, src, 0.7, 'The owner\'s description on the Google Business Profile', undefined, s));
    if (!p.description && !edited.has('description')) data.description = f.description;
  }
  if (f.accessible != null) {
    obs.push(obsRow(p, provider, 'accessible', f.accessible, src, 0.8, 'Accessibility attributes on the Google Business Profile', undefined, s));
    if (p.accessible == null) data.accessible = f.accessible;
  }
  if (f.freeParking != null) {
    obs.push(obsRow(p, provider, 'free_parking', f.freeParking, src, 0.8, 'Parking attributes on the Google Business Profile', undefined, s));
    if (p.freeParking == null) data.freeParking = f.freeParking;
  }
  if (f.rating) {
    obs.push(obsRow(p, provider, 'rating', f.rating, src, 0.9, `Google rating ${f.rating.value} from ${f.rating.count} reviews`, undefined, s));
    if (p.googleRating == null) Object.assign(data, { googleRating: f.rating.value, googleReviewCount: f.rating.count, ratingProvider: provider });
  }
  if (f.claimedOnProvider != null && crawl.claimedOnProvider == null) crawl.claimedOnProvider = f.claimedOnProvider;
  if (f.closed) {
    data.businessStatus = f.closed === 'permanently' ? 'CLOSED_PERMANENTLY' : 'CLOSED_TEMPORARILY';
    const reason = f.closed === 'permanently' ? 'closed_on_google' : 'temporarily_closed';
    if (!p.reasons.includes(reason)) data.reasons = [...p.reasons, reason];
  }
  if (f.photos.length && s.useProviderImages) {
    const photos = f.photos.map(u => largerGoogleImage(u, 'photo'));
    for (const u of photos) obs.push(obsRow(p, provider, 'photo', u, src, 0.5, 'Google Business Profile photo (via Apify)', undefined, s));
    addCandidates(crawl, photos.map(url => ({ url, pageUrl: src, provider: 'google_profile', evidence: 'Google Business Profile photo (via Apify)' })), []);
    if (!edited.has('photoUrls')) data.photoUrls = [...new Set([...p.photoUrls, ...photos])].slice(0, s.maxListingPhotos);
  }
  if (!p.googleMapsUri && src) data.googleMapsUri = src;
  (crawl.apify as Record<string, unknown>).maps = { at: new Date().toISOString(), runId, found: true, photos: f.photos.length, closed: f.closed, filled: Object.keys(data) };
  await saveObs(p, provider, obs);
  await db.importPlace.update({ where: { id: p.id }, data: { ...data, crawl: crawl as Prisma.InputJsonValue } });
  return Object.keys(data).length > 0;
}

function pickInstagram(t: ApifyTarget, items: InstagramItem[], s: Awaited<ReturnType<typeof settings>>): ProfileFacts | null {
  const it = items.find(x => x.username?.toLowerCase() === t.handle);
  return it ? instagramFacts(it, { maxPosts: s.apifyMaxPosts }) : null;
}

function pickFacebook(t: ApifyTarget, items: FacebookItem[]): ProfileFacts | null {
  const want = t.url ? t.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').toLowerCase() : '';
  const it = items.find(x => {
    const u = (x.pageUrl ?? x.facebookUrl ?? '').replace(/^https?:\/\/(www\.|m\.)?/, '').replace(/\/$/, '').toLowerCase();
    return !!u && (u === want || u.startsWith(want) || want.startsWith(u));
  });
  return it ? facebookFacts(it) : null;
}

/** Facts from the business's own social profile. Nothing is taken from a profile that does not confirm the business. */
async function applyProfile(p: ImportPlace, network: 'instagram' | 'facebook', f: ProfileFacts | null, s: Awaited<ReturnType<typeof settings>>, runId: string): Promise<boolean> {
  const provider = network === 'instagram' ? APIFY_PROVIDER.instagram : APIFY_PROVIDER.facebook;
  const crawl = ((p.crawl ?? {}) as Crawl);
  const socials = { ...((p.socials ?? {}) as Socials) };
  const prev = socials[network];
  const mark = (checked: SocialAccount['checked'], extra: Record<string, unknown> = {}) => {
    crawl.apify = { ...(crawl.apify ?? {}), [network]: { at: new Date().toISOString(), runId, checked, ...extra } };
    if (prev) socials[network] = { ...prev, checked };
  };
  if (!f || f.unavailable) {
    mark('unavailable');
    await db.importPlace.update({ where: { id: p.id }, data: { crawl: crawl as Prisma.InputJsonValue, socials: socials as Prisma.InputJsonValue } });
    return false;
  }
  const match = profileMatches(f, { domain: p.siteDomain ?? siteHost(p.website), phone: p.phone, whatsapp: p.whatsapp });
  const obs: Obs[] = [];
  const url = f.url ?? prev?.url ?? null;
  if (!match) {
    mark('no_match', { name: f.name, followers: f.followers });
    if (url) obs.push(obsRow(p, provider, 'social', { network, url }, url, 0.2, 'The profile neither links to the business site nor shows its phone: not confirmed as this business', 'rejected_no_match', s));
    await saveObs(p, provider, obs);
    await db.importPlace.update({ where: { id: p.id }, data: { crawl: crawl as Prisma.InputJsonValue, socials: socials as Prisma.InputJsonValue } });
    return false;
  }
  const edited = new Set(crawl.editedFields ?? []);
  const data: Prisma.ImportPlaceUpdateInput = {};
  const via = match === 'links_site' ? 'profile_links_site' : 'profile_shows_phone';
  if (url) {
    const acc: SocialAccount = { url, verified: true, via: prev?.verified ? prev.via : via, sources: [...new Set([...(prev?.sources ?? []), provider])], checked: 'match' };
    socials[network] = acc;
    obs.push(obsRow(p, provider, 'social', { network, url }, url, 0.9, match === 'links_site' ? 'The profile links to the business website' : 'The profile shows the business phone', 'verified', s));
    if (!edited.has(network) && !p[network]) data[network] = url;
  }
  if (f.email && cleanEmail(f.email)) {
    const email = cleanEmail(f.email)!;
    const mx = await hasMx(emailDomain(email));
    obs.push(obsRow(p, provider, 'email', email, url, 0.7, `Contact email shown on the ${network} profile`, mx ? 'dns_valid' : 'syntax_valid', s));
    if (!p.email && !edited.has('email') && mx !== false) Object.assign(data, { email, emailSource: network, emailStatus: mx ? 'dns_valid' : 'syntax_valid', emailMx: mx, emails: [...new Set([...p.emails, email])] });
  }
  // Phone and opening hours come from the Google Business Profile or the website only; a social page's
  // numbers and hours are kept as evidence for the review screen and never written to the record.
  if (f.phone) obs.push(obsRow(p, provider, 'phone', f.phone, url, 0.5, `Phone shown on the ${network} profile (evidence only)`, 'evidence', s));
  if (f.hours) obs.push(obsRow(p, provider, 'hours', f.hours, url, 0.5, `Opening hours on the ${network} page (evidence only)`, 'evidence', s));
  for (const l of f.links) {
    const w = classifyWebsite(l);
    if (!p.website && !data.website && !edited.has('website') && w.url && w.kind === 'own') {
      obs.push(obsRow(p, provider, 'website', w.url, url, 0.7, `Website link on the ${network} profile`, undefined, s));
      Object.assign(data, { website: w.url, websiteKind: 'own', siteDomain: siteHost(w.url) });
    }
    if (w.kind === 'booking' && !p.bookingUrl && !data.bookingUrl) data.bookingUrl = w.url;
  }
  if (s.useProviderImages) {
    const photos = f.photos.map(x => ({ url: x.url, pageUrl: x.pageUrl ?? url, provider: network, evidence: x.caption ? `${network} post: ${x.caption}` : `${network} ${network === 'facebook' ? 'cover photo' : 'post'}` }));
    for (const x of photos) obs.push(obsRow(p, provider, 'photo', x.url, x.pageUrl, 0.5, x.evidence, undefined, s));
    if (f.logo) obs.push(obsRow(p, provider, 'logo', f.logo, url, 0.5, `Profile picture of the business's ${network} account`, undefined, s));
    addCandidates(crawl, photos, f.logo ? [f.logo] : []);
    if (!edited.has('photoUrls') && photos.length) data.photoUrls = [...new Set([...p.photoUrls, ...photos.map(x => x.url)])].slice(0, s.maxListingPhotos);
    if (!edited.has('logoUrl') && !p.logoUrl && f.logo) data.logoUrl = f.logo;
  }
  mark('match', { verified: true, via, bio: f.bio, name: f.name, followers: f.followers, photos: f.photos.length, filled: Object.keys(data) });
  await saveObs(p, provider, obs);
  await db.importPlace.update({ where: { id: p.id }, data: { ...data, socials: socials as Prisma.InputJsonValue, crawl: crawl as Prisma.InputJsonValue } });
  return true;
}

