import 'server-only';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/server/db';
import { BudgetExceeded, commit, dayKey, monthKey, release, reserve, uncertain, withCaps } from '@/lib/import/budget';
import { fieldMask, GOOGLE_FEATURES, retentionDays, type GoogleFeature } from '@/lib/import/googleFields';
import { pricing, toMicros } from '@/lib/import/pricing';
import { sweepExpired } from '@/lib/import/retention';
import { loadSettings } from '@/lib/import/settings';

// Stage 2B: Google Places (New) as a separate, attributed provider view.
// - Off unless GOOGLE_ENRICHMENT_ENABLED=true and the admin switch is on; the kill switch wins.
// - Only on an explicit staff action (never on page views, cards, crawlers or at import time).
// - Explicit allowlisted field mask; the SKU comes from the highest-tier field.
// - Reserved against daily and monthly caps before the call; Google does not report per-call cost,
//   so the gross list price is committed.
// - Only fields whose policy allows caching are stored (GoogleDisplay), with an expiry. Nothing here
//   is written to listing fields, exports, logs or analytics.

const BASE = process.env.PLACES_BASE_URL || 'https://places.googleapis.com/v1';

export type GoogleLookup =
  | { ok: true; placeId: string; sku: string; fields: Record<string, unknown>; photoUri?: string | null; attributions: unknown[]; cached: boolean }
  | { ok: false; error: string };

export function googleAvailable(): boolean {
  return process.env.GOOGLE_ENRICHMENT_ENABLED === 'true' && !!process.env.GOOGLE_MAPS_API_KEY;
}

async function caps() {
  const s = await loadSettings(db);
  return { s, caps: [{ key: dayKey('google'), limitMicros: toMicros(s.googleDailyUsd) }, { key: monthKey('google'), limitMicros: toMicros(s.googleMonthlyUsd) }] };
}


export async function googleLookup(actor: { id: string }, placeId: string, feature: GoogleFeature): Promise<GoogleLookup> {
  if (!googleAvailable()) return { ok: false, error: 'google_disabled' };
  if (!placeId || placeId.startsWith('dfs:') || !/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) return { ok: false, error: 'no_place_id' };
  const { s, caps: capList } = await caps();
  if (s.killSwitch) return { ok: false, error: 'kill_switch' };
  if (!s.googleEnabled) return { ok: false, error: 'google_disabled' };
  if (feature === 'photo' && s.googlePhotoCap <= 0) return { ok: false, error: 'photos_disabled' };
  await sweepExpired(db);

  // Cached, still-valid display data for this place: no call.
  const cached = await db.googleDisplay.findUnique({ where: { placeId } });
  const wanted = GOOGLE_FEATURES[feature] as readonly string[];
  if (cached && cached.expiresAt > new Date() && wanted.every(f => f in (cached.fields as object))) {
    return { ok: true, placeId, sku: cached.sku, fields: cached.fields as Record<string, unknown>, attributions: [], cached: true };
  }

  const { mask, sku } = fieldMask([...wanted]);
  const price = pricing().google.placeDetailsPer1000[sku] / 1000;
  const est = toMicros(price);
  const key = `gdetails:${placeId}:${feature}:${Date.now()}`;
  try {
    await reserve(db, withCaps({ runId: null, provider: 'google', endpoint: 'places:get', sku, requestKey: key, estimateMicros: est, caps: capList, meta: { feature, actor: actor.id } }));
  } catch (e) {
    if (e instanceof BudgetExceeded) return { ok: false, error: `budget:${e.scope}` };
    throw e;
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}/places/${encodeURIComponent(placeId)}`, {
      headers: { 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY!, 'X-Goog-FieldMask': mask, 'Accept-Language': 'he' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    await uncertain(db, key, est, e instanceof Error ? e.message : 'failed');
    return { ok: false, error: 'no_answer' };
  }
  if (!res.ok) {
    // 4xx before processing are not billed per Google's billing rules for invalid requests; budget it conservatively anyway.
    if (res.status === 400 || res.status === 403 || res.status === 404) await release(db, key, `http_${res.status}`);
    else await commit(db, key, null, est);
    return { ok: false, error: `http_${res.status}` };
  }
  await commit(db, key, null, est);
  const body = (await res.json()) as Record<string, unknown>;

  let photoUri: string | null = null;
  if (feature === 'photo') photoUri = await photo(body, capList);

  // Keep only fields whose policy allows caching, until the shortest allowed expiry.
  const keep: Record<string, unknown> = {};
  let days = Infinity;
  for (const [f, v] of Object.entries(body)) {
    const r = retentionDays(f);
    if (r === 0) continue;
    keep[f] = v;
    if (r !== 'permanent') days = Math.min(days, r);
  }
  if (Object.keys(keep).length) {
    const expiresAt = new Date(Date.now() + (days === Infinity ? 365 : days) * 86_400_000);
    await db.googleDisplay.upsert({
      where: { placeId },
      create: { placeId, fields: keep as Prisma.InputJsonValue, sku, fetchedAt: new Date(), expiresAt },
      update: { fields: keep as Prisma.InputJsonValue, sku, fetchedAt: new Date(), expiresAt },
    });
  }
  await db.auditLog.create({ data: { actorId: actor.id, action: 'google_lookup', subjectType: 'google_place', subjectId: actor.id, meta: { feature, sku } } });
  return { ok: true, placeId, sku, fields: body, photoUri, attributions: (body.attributions as unknown[]) ?? [], cached: false };
}

/** One photo, resolved to a short-lived URI through the Place Photos endpoint. Never stored. */
async function photo(body: Record<string, unknown>, capList: Array<{ key: string; limitMicros: bigint }>): Promise<string | null> {
  const first = (body.photos as Array<{ name?: string }> | undefined)?.[0]?.name;
  if (!first) return null;
  const est = toMicros(pricing().google.placePhotoPer1000 / 1000);
  const key = `gphoto:${first}:${Date.now()}`;
  const s = await loadSettings(db);
  try {
    await reserve(db, withCaps({ runId: null, provider: 'google', endpoint: 'places:photo', sku: 'place_photo', requestKey: key, estimateMicros: est, caps: [...capList, { key: `${dayKey('google')}:photos`, limitMicros: BigInt(s.googlePhotoCap) * est }] }));
  } catch {
    return null;
  }
  try {
    const r = await fetch(`${BASE}/${first}/media?maxWidthPx=800&skipHttpRedirect=true`, { headers: { 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY! }, signal: AbortSignal.timeout(15_000) });
    await commit(db, key, null, est);
    if (!r.ok) return null;
    return ((await r.json()) as { photoUri?: string }).photoUri ?? null;
  } catch (e) {
    await uncertain(db, key, est, e instanceof Error ? e.message : 'failed');
    return null;
  }
}
