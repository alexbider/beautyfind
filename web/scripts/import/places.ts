// Google Places API (New) client for the import worker. Every call is counted against the run's
// budget before it is made, so a run can never spend more than its cap.

import type { Box } from '../../src/lib/import/geo';
import { boxCenter, boxRadius } from '../../src/lib/import/geo';

const BASE = process.env.PLACES_BASE_URL || 'https://places.googleapis.com/v1';

// Fields we store. Phone, website, hours and rating put these calls in the Enterprise price tier.
const PLACE_FIELDS = [
  'id', 'displayName', 'formattedAddress', 'addressComponents', 'location', 'types', 'primaryType', 'nationalPhoneNumber',
  'internationalPhoneNumber', 'websiteUri', 'regularOpeningHours', 'rating', 'userRatingCount', 'googleMapsUri', 'businessStatus',
];
const FIELD_MASK = PLACE_FIELDS.map(f => `places.${f}`).join(',');

export interface GPlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  addressComponents?: Array<{ longText: string; shortText: string; types: string[] }>;
  location?: { latitude: number; longitude: number };
  types?: string[];
  primaryType?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  regularOpeningHours?: { periods?: Array<{ open?: { day?: number; hour?: number; minute?: number }; close?: { day?: number; hour?: number; minute?: number } }> };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  businessStatus?: string;
}

export class PlacesError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Throws when the run has no budget left; `spend` must increment the counter atomically. */
export type Spend = () => Promise<void>;

async function call<T>(path: string, body: unknown, fieldMask: string, spend: Spend): Promise<T> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set');
  for (let attempt = 0; ; attempt++) {
    await spend();
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return (await res.json()) as T;
    const text = await res.text();
    // 429 and 5xx are worth retrying; the spend above still counts, which keeps the cap honest.
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise(r => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    throw new PlacesError(res.status, text.slice(0, 500));
  }
}

const common = { languageCode: 'he', regionCode: 'IL' };

/** Up to 20 places of the given types inside the circle around the box, nearest first. */
export async function searchNearby(box: Box, types: string[], spend: Spend): Promise<GPlace[]> {
  const c = boxCenter(box);
  const r = await call<{ places?: GPlace[] }>(
    '/places:searchNearby',
    {
      ...common,
      includedTypes: types,
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
      locationRestriction: { circle: { center: { latitude: c.lat, longitude: c.lng }, radius: Math.min(boxRadius(box), 50_000) } },
    },
    FIELD_MASK,
    spend,
  );
  return r.places ?? [];
}

/** One page (up to 20) of a text search restricted to the box. */
export async function searchText(query: string, box: Box, pageToken: string | undefined, spend: Spend): Promise<{ places: GPlace[]; next?: string }> {
  const r = await call<{ places?: GPlace[]; nextPageToken?: string }>(
    '/places:searchText',
    {
      ...common,
      textQuery: query,
      pageSize: 20,
      ...(pageToken ? { pageToken } : {}),
      locationRestriction: { rectangle: { low: { latitude: box.s, longitude: box.w }, high: { latitude: box.n, longitude: box.e } } },
    },
    `${FIELD_MASK},nextPageToken`,
    spend,
  );
  return { places: r.places ?? [], next: r.nextPageToken };
}

/**
 * Which of our place types this API key accepts. An unknown type makes the whole nearby call fail,
 * so each one is tried once with a tiny radius at the start of a run.
 */
export async function supportedTypes(types: string[], spend: Spend): Promise<{ ok: string[]; dropped: string[] }> {
  const ok: string[] = [];
  const dropped: string[] = [];
  const tiny: Box = { s: 32.0800, w: 34.7800, n: 32.0801, e: 34.7801 };
  for (const t of types) {
    try {
      await searchNearby(tiny, [t], spend);
      ok.push(t);
    } catch (e) {
      if (e instanceof PlacesError && e.status === 400) dropped.push(t);
      else throw e;
    }
  }
  return { ok, dropped };
}

export const locality = (p: GPlace): string | null =>
  p.addressComponents?.find(c => c.types.includes('locality'))?.longText ??
  p.addressComponents?.find(c => c.types.includes('administrative_area_level_2'))?.longText ??
  null;
