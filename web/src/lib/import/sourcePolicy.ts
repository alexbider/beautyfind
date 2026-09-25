// What we may keep and publish from each source. A paid API does not by itself grant unrestricted
// republication or image rights: publication flags stay conservative until the terms are confirmed.
// Edit here (and record the decision in docs/decisions.md) when a source's terms are checked.

export type Retention = { kind: 'permanent' } | { kind: 'days'; days: number } | { kind: 'none' };

export interface SourcePolicy {
  retention: Retention; // for observations from this source
  keepRawPayload: boolean; // raw provider responses are not stored unless allowed
  publish: Record<string, boolean>; // field -> may become a public listing fact
  note: string;
}

export const SOURCE_POLICY: Record<string, SourcePolicy> = {
  dataforseo: {
    retention: { kind: 'permanent' },
    keepRawPayload: false,
    publish: { name: true, address: true, location: true, phone: true, website: true, hours: true, categories: true, email: true, rating: false, photo: false },
    note: 'Business facts (name, address, phone, website, hours) are published as facts after review. Ratings and photos stay off until DataForSEO and underlying-source terms for republication are confirmed.',
  },
  website: {
    retention: { kind: 'permanent' },
    keepRawPayload: false,
    publish: { email: true, phone: true, whatsapp: true, social: true, booking: true, hours: true, address: true, service: true, logo: false },
    note: 'Facts the business publishes on its own site. Logos and images are candidates only until the owner confirms reuse.',
  },
  google: {
    retention: { kind: 'none' }, // per-field exceptions in googleFields.FIELD_RETENTION_DAYS
    keepRawPayload: false,
    publish: { placeId: true },
    note: 'Google content is shown through the provider view with attribution, never copied into listing fields. Only the place id is stored permanently.',
  },
  owner: { retention: { kind: 'permanent' }, keepRawPayload: false, publish: {}, note: 'Owner-confirmed values win over every other source.' },
  staff: { retention: { kind: 'permanent' }, keepRawPayload: false, publish: {}, note: 'Staff edits in the review screen.' },
};

export function mayPublish(provider: string, field: string, overrides?: { publishProviderRatings?: boolean }): boolean {
  if (field === 'rating' && provider === 'dataforseo' && overrides?.publishProviderRatings) return true;
  const p = SOURCE_POLICY[provider];
  if (!p) return false;
  return p.publish[field] ?? (provider === 'owner' || provider === 'staff');
}

export function expiryFor(provider: string, from = new Date()): Date | null {
  const r = SOURCE_POLICY[provider]?.retention;
  if (!r || r.kind === 'permanent') return null;
  if (r.kind === 'none') return from;
  return new Date(from.getTime() + r.days * 86_400_000);
}
