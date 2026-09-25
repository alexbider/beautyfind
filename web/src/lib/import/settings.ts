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
  // Stage 2A: websites
  crawlMaxPages: z.number().int().min(1).max(10).default(6),
  recheckOkDays: z.number().int().min(1).max(365).default(30),
  recheckFailDays: z.number().int().min(1).max(90).default(7),
  browserFallback: z.boolean().default(false),
  browserMaxPerRun: z.number().int().min(0).max(5000).default(25),
  llmEnabled: z.boolean().default(false),
  llmBudgetUsd: z.number().min(0).max(1000).default(0),
  // Stage 2B: Google (display data only)
  googleEnabled: z.boolean().default(false),
  googleRunCallCap: z.number().int().min(0).max(10_000).default(50),
  googleDailyUsd: z.number().min(0).max(1000).default(2),
  googleMonthlyUsd: z.number().min(0).max(10_000).default(20),
  googlePhotoCap: z.number().int().min(0).max(1000).default(0),
  // Publication
  requireEmail: z.boolean().default(true), // the product owner's rule: email is mandatory to publish
  requirePhoneOrWebsite: z.boolean().default(true),
  publishProviderRatings: z.boolean().default(false), // until the source's terms are confirmed
  // Logo and photos from the business's own website, chosen in review and copied on approval.
  useWebsiteImages: z.boolean().default(true),
  maxListingPhotos: z.number().int().min(0).max(20).default(6),
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
