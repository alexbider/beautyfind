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
    publish: { name: true, address: true, location: true, phone: true, website: true, google_profile: true, booking: true, whatsapp: true, social: true, hours: true, categories: true, email: true, rating: false, photo: false },
    note: 'Business facts (name, address, phone, website, hours) are published as facts after review. The Google rating and review count (publishProviderRatings) and the profile logo and main photo (useProviderImages) are on by the product owner\'s decision of 2026-09-25; each can be switched off in the settings.',
  },
  website: {
    retention: { kind: 'permanent' },
    keepRawPayload: false,
    publish: { email: true, phone: true, whatsapp: true, social: true, booking: true, hours: true, address: true, service: true, logo: false, photo: false },
    note: 'Facts the business publishes on its own site. Its logo and photos are used only when the useWebsiteImages setting is on, only the ones staff pick in review, and the owner can replace or remove them after claiming.',
  },
  google: {
    retention: { kind: 'none' }, // per-field exceptions in googleFields.FIELD_RETENTION_DAYS
    keepRawPayload: false,
    publish: { placeId: true },
    note: 'Google content is shown through the provider view with attribution, never copied into listing fields. Only the place id is stored permanently.',
  },
  apify_google_maps: {
    retention: { kind: 'permanent' },
    keepRawPayload: false,
    publish: { phone: true, website: true, hours: true, booking: true, location: true, rating: false, photo: false, description: false, accessible: true, free_parking: true },
    note: 'Google Business Profile data read through an Apify actor: the same facts and the same limits as DataForSEO (rating and photos only under the provider settings). The owner\'s profile description is evidence for the editorial packet, never copied as our text.',
  },
  apify_instagram: {
    retention: { kind: 'permanent' },
    keepRawPayload: false,
    publish: { social: true, email: true, phone: true, logo: false, photo: false },
    note: 'The business\'s own Instagram profile, used only after the profile itself confirms the business (a link to its site or its phone). Bio text is evidence; the profile picture and recent posts are image candidates from the business\'s own published account, under useProviderImages.',
  },
  apify_facebook: {
    retention: { kind: 'permanent' },
    keepRawPayload: false,
    publish: { social: true, email: true, phone: true, website: true, hours: true, logo: false, photo: false },
    note: 'The business\'s own Facebook page, same confirmation rule as Instagram. About text is evidence for the editorial packet.',
  },
  apify_site: {
    retention: { kind: 'permanent' },
    keepRawPayload: false,
    publish: { email: true, phone: true, whatsapp: true, social: true, booking: true, hours: true, address: true, service: true, logo: false, photo: false },
    note: 'The business\'s own website rendered with a browser through Apify when our crawler could not read it. Same publication rules as the website source; robots.txt is respected; sites that blocked us are never sent.',
  },
  owner: { retention: { kind: 'permanent' }, keepRawPayload: false, publish: {}, note: 'Owner-confirmed values win over every other source.' },
  staff: { retention: { kind: 'permanent' }, keepRawPayload: false, publish: {}, note: 'Staff edits in the review screen.' },
};

/** Providers whose Google rating summary may reach the listing (under publishProviderRatings). */
export const RATING_PROVIDERS = ['dataforseo', 'apify_google_maps'];
export const ratingProviderOk = (provider: string | null | undefined) => !!provider && RATING_PROVIDERS.includes(provider);

export function mayPublish(provider: string, field: string, overrides?: { publishProviderRatings?: boolean; useWebsiteImages?: boolean; useProviderImages?: boolean }): boolean {
  if (field === 'rating' && provider === 'dataforseo' && overrides?.publishProviderRatings) return true;
  if ((field === 'logo' || field === 'photo') && provider === 'website' && overrides?.useWebsiteImages) return true;
  if ((field === 'logo' || field === 'photo') && provider === 'dataforseo' && overrides?.useProviderImages) return true;
  if (field === 'rating' && provider === 'apify_google_maps' && overrides?.publishProviderRatings) return true;
  if ((field === 'logo' || field === 'photo') && ['apify_google_maps', 'apify_instagram', 'apify_facebook'].includes(provider) && overrides?.useProviderImages) return true;
  if ((field === 'logo' || field === 'photo') && provider === 'apify_site' && overrides?.useWebsiteImages) return true;
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
