// Google Places API (New) field masks: only allowlisted fields, never "*". The SKU (and the price) of a
// Place Details call is set by the highest-tier field in the mask.
//
// Tier assignments follow https://developers.google.com/maps/documentation/places/web-service/data-fields
// (Enterprise: phone numbers, websiteUri, opening hours, rating, userRatingCount, priceLevel;
// Pro: displayName, businessStatus, googleMapsUri, primaryType...). Re-check when Google changes tiers.
// `photos` is budgeted at Pro until its tier is confirmed, which errs on the expensive side.

import type { GoogleSku } from './pricing';

export const FIELD_SKU: Record<string, GoogleSku> = {
  id: 'essentials_ids_only',
  attributions: 'essentials_ids_only',
  formattedAddress: 'essentials',
  shortFormattedAddress: 'essentials',
  addressComponents: 'essentials',
  location: 'essentials',
  types: 'essentials',
  displayName: 'pro',
  businessStatus: 'pro',
  googleMapsUri: 'pro',
  primaryType: 'pro',
  photos: 'pro',
  nationalPhoneNumber: 'enterprise',
  internationalPhoneNumber: 'enterprise',
  websiteUri: 'enterprise',
  regularOpeningHours: 'enterprise',
  currentOpeningHours: 'enterprise',
  rating: 'enterprise',
  userRatingCount: 'enterprise',
  priceLevel: 'enterprise',
  reviews: 'enterprise_atmosphere',
  editorialSummary: 'enterprise_atmosphere',
};

const ORDER: GoogleSku[] = ['essentials_ids_only', 'essentials', 'pro', 'enterprise', 'enterprise_atmosphere'];

export class FieldMaskError extends Error {}

/** Validated field mask string and the SKU it bills at. Unknown or wildcard fields throw. */
export function fieldMask(fields: string[]): { mask: string; sku: GoogleSku } {
  if (!fields.length) throw new FieldMaskError('empty');
  let top = 0;
  for (const f of fields) {
    if (f === '*' || f.includes('*')) throw new FieldMaskError('wildcard');
    const sku = FIELD_SKU[f];
    if (!sku) throw new FieldMaskError(`not_allowlisted:${f}`);
    top = Math.max(top, ORDER.indexOf(sku));
  }
  return { mask: [...new Set(fields)].join(','), sku: ORDER[top] };
}

/**
 * How long each field may be kept. Google allows keeping place IDs indefinitely and latitude/longitude
 * for a limited period (30 days in the terms at the time of writing); other content is used for display
 * only and not stored. Confirm against the current Places policies before changing.
 */
export const FIELD_RETENTION_DAYS: Record<string, number | 'permanent'> = {
  id: 'permanent',
  location: 30,
};
export const retentionDays = (field: string): number | 'permanent' => FIELD_RETENTION_DAYS[field] ?? 0;

/** Named feature presets: the only field groups the app requests. */
export const GOOGLE_FEATURES = {
  // Admin check that the place still exists and matches (cheapest useful call).
  verify: ['id', 'displayName', 'formattedAddress', 'location', 'businessStatus', 'googleMapsUri'],
  // Rating summary display with attribution.
  rating: ['id', 'rating', 'userRatingCount', 'googleMapsUri'],
  // One photo reference for display (resolved through the Place Photos endpoint).
  photo: ['id', 'photos'],
} as const;
export type GoogleFeature = keyof typeof GOOGLE_FEATURES;
