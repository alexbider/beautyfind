// One Place Details call for the address in Hebrew (Places API New, languageCode he). Essentials SKU:
// id, formattedAddress and addressComponents only, never a wildcard. Shared by the import (approvePlace)
// and the batch script; the key stays in the server environment and is never logged.

import { parseGoogleAddress, type GoogleAddress } from './address';

const BASE = process.env.PLACES_BASE_URL || 'https://places.googleapis.com/v1';
export const ADDRESS_FIELD_MASK = 'id,formattedAddress,addressComponents';
/** The gross list price of one call at the essentials SKU (src/lib/import/pricing.ts: 5 USD per 1000). */
export const ADDRESS_CALL_USD = 0.005;

export class PlacesAddressError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** A Google place id (not DataForSEO's dfs: key). */
export const validPlaceId = (id: string | null | undefined): id is string => !!id && !id.startsWith('dfs:') && /^[A-Za-z0-9_-]{10,300}$/.test(id);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The place's address in Hebrew, null when Google has no such place (404). Throws on other errors. */
export async function fetchGoogleAddress(placeId: string, opts: { key?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<GoogleAddress | null> {
  const key = opts.key ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set');
  const f = opts.fetchImpl ?? fetch;
  for (let attempt = 0; ; attempt++) {
    const res = await f(`${BASE}/places/${encodeURIComponent(placeId)}?languageCode=he&regionCode=IL`, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': ADDRESS_FIELD_MASK, 'Accept-Language': 'he' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    if (res.ok) return parseGoogleAddress(await res.json());
    if (res.status === 404) return null;
    // 429 is Google's per-minute quota: wait out the minute, up to five times. 5xx: a short backoff.
    if (res.status === 429 && attempt < 5) {
      await sleep(15_000 * (attempt + 1));
      continue;
    }
    if (res.status >= 500 && attempt < 3) {
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    throw new PlacesAddressError(res.status, (await res.text()).slice(0, 300));
  }
}
