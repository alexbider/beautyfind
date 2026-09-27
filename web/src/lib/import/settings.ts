// Import settings, stored as one JSON row (import_settings) and edited from /ops/import.
// Every value has a safe default: the pilot defaults below apply until staff change them.

import { z } from 'zod';

export const ImportSettingsSchema = z.object({
  // Emergency stop: no paid provider call is dispatched while this is on.
  killSwitch: z.boolean().default(false),
  // Stage 1
  dataforseoEnabled: z.boolean().default(true),
  pilotRecordLimit: z.number().int().min(1).max(100_000).default(100),
  pilotBudgetUsd: z.number().min(0).max(10_000).default(1),
  dfsPageSize: z.number().int().min(10).max(1000).default(1000),
  // Stage 2A: websites. Progressive budget: crawlMaxPages relevant pages first, extended once to
  // crawlMaxPagesExtended only while template fields are still missing (docs/coverage-manifest.md).
  crawlMaxPages: z.number().int().min(1).max(12).default(5),
  crawlMaxPagesExtended: z.number().int().min(1).max(20).default(12),
  recheckOkDays: z.number().int().min(1).max(365).default(30),
  recheckFailDays: z.number().int().min(1).max(90).default(7),
  browserFallback: z.boolean().default(false),
  browserMaxPerRun: z.number().int().min(0).max(5000).default(25),
  llmEnabled: z.boolean().default(false),
  llmBudgetUsd: z.number().min(0).max(1000).default(0),
  // Stage 2C: editorial writing (description, FAQs, meta, service summaries) from the evidence packet.
  // One structured call per changed evidence packet, at most one repair call, cached by evidence hash.
  editorialEnabled: z.boolean().default(true),
  editorialBudgetUsd: z.number().min(0).max(1000).default(3),
  editorialMaxPerRun: z.number().int().min(0).max(20_000).default(300),
  // Stage 2D: media and video
  youtubeEnabled: z.boolean().default(true), // oEmbed without a key; Data API when YOUTUBE_API_KEY is set
  youtubeQuotaPerRun: z.number().int().min(0).max(100_000).default(2_000), // Data API units (daily quota is 10,000 by default)
  youtubeMaxVideos: z.number().int().min(0).max(6).default(3),
  imageDerivatives: z.boolean().default(true), // WebP derivatives for approved images (sharp)
  mapsEmbedEnabled: z.boolean().default(true), // the public map needs NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY as well
  // Stage 2E: Apify actors for the gaps the site and DataForSEO leave (needs APIFY_TOKEN on the worker).
  apifyEnabled: z.boolean().default(true),
  apifyMaps: z.boolean().default(true), // Google Maps place details and profile photos
  apifyInstagram: z.boolean().default(true), // the business's Instagram profile (verifies the account, bio, posts)
  apifyFacebook: z.boolean().default(true), // the business's Facebook page
  apifyRender: z.boolean().default(true), // browser crawl of sites our crawler could not read (never blocked or robots sites)
  apifyBudgetUsd: z.number().min(0).max(1000).default(5), // per run
  apifyMonthlyUsd: z.number().min(0).max(10_000).default(50),
  apifyMaxImages: z.number().int().min(0).max(30).default(10), // Google profile photos per place
  apifyMaxPosts: z.number().int().min(0).max(12).default(6), // recent Instagram image posts kept as gallery candidates (verified accounts only)
  apifyRenderPages: z.number().int().min(1).max(20).default(8), // pages per site for the browser crawl
  // Written by the worker at every start: which server-side keys it had. The admin shows it as the connection status.
  workerStatus: z.object({ at: z.string(), dataforseo: z.boolean(), anthropic: z.boolean(), apify: z.boolean(), youtube: z.boolean(), blob: z.boolean(), browser: z.boolean() }).optional(),
  // Stage 2B: Google (display data only)
  googleEnabled: z.boolean().default(false),
  googleRunCallCap: z.number().int().min(0).max(10_000).default(50),
  googleDailyUsd: z.number().min(0).max(1000).default(2),
  googleMonthlyUsd: z.number().min(0).max(10_000).default(20),
  googlePhotoCap: z.number().int().min(0).max(1000).default(0),
  // Publication
  // The product owner's rule (2026-09-25): a phone or an email is enough to publish.
  requirePhoneOrEmail: z.boolean().default(true),
  requireEmail: z.boolean().default(false),
  requirePhoneOrWebsite: z.boolean().default(false),
  // Google rating and review count (from DataForSEO) shown on listings with a link to the Google reviews.
  publishProviderRatings: z.boolean().default(true),
  // Logo and main photo from the business's Google profile (via DataForSEO), when its own site has none.
  useProviderImages: z.boolean().default(true),
  // Logo and photos from the business's own website, chosen in review and copied on approval.
  useWebsiteImages: z.boolean().default(true),
  // For listings with fewer than 5 photos: photos from the business's own posts on its Google profile.
  googlePostPhotos: z.boolean().default(true),
  maxListingPhotos: z.number().int().min(0).max(20).default(8), // the gallery shows 5 (1 large, 4 small); a few more for the lightbox
});
export type ImportSettings = z.infer<typeof ImportSettingsSchema>;

export const DEFAULT_SETTINGS: ImportSettings = ImportSettingsSchema.parse({});

/** Parses a stored value; unknown keys are dropped and bad values fall back to defaults. */
export function parseSettings(raw: unknown): ImportSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(ImportSettingsSchema.shape)) {
    const one = (ImportSettingsSchema.shape as Record<string, z.ZodType>)[key].safeParse(obj[key]);
    out[key] = one.success ? one.data : (DEFAULT_SETTINGS as Record<string, unknown>)[key];
  }
  return out as ImportSettings;
}

type Db = { importSettings: { findUnique: (a: { where: { id: number } }) => Promise<{ values: unknown } | null> } };

export async function loadSettings(db: Db): Promise<ImportSettings> {
  const row = await db.importSettings.findUnique({ where: { id: 1 } });
  return parseSettings(row?.values);
}
