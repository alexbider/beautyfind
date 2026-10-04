import 'server-only';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { AREAS, LEVELS, OPS_ROLES, type PermissionOverrides } from '@/components/ops/roles';
import { INDEX_SECTION_KEYS } from '@/lib/indexing';
import { DEFAULT_MEDICAL_DISCLAIMER } from '@/lib/medical';
import { PLAN_MONTHLY_NIS, VAT_RATE } from '@/lib/pricing';
import { db } from './db';

// Platform settings edited on /ops/settings (one row, JSON). Code constants are the defaults, so a
// fresh database behaves exactly as before; a saved value overrides them where the server reads them
// (plan prices on billing screens, the sponsored weekly price, feature flags, maintenance mode).

const Level = z.enum(LEVELS as [string, ...string[]]);

export const PlatformSettingsSchema = z.object({
  // Pricing (NIS per live branch per month; sponsored per week). Defaults from src/lib/pricing.ts.
  basicMonthlyNis: z.number().int().min(0).max(100_000).default(PLAN_MONTHLY_NIS.basic),
  advancedMonthlyNis: z.number().int().min(0).max(100_000).default(PLAN_MONTHLY_NIS.advanced),
  sponsoredWeeklyNis: z.number().int().min(0).max(100_000).default(364),
  sponsoredMaxPerList: z.number().int().min(0).max(10).default(2),
  // VAT shown on clinic prices (Israeli VAT). Platform invoices carry no Israeli VAT (docs/decisions.md).
  vatRatePct: z.number().min(0).max(50).default(Math.round(VAT_RATE * 100)),
  // Billing policy for failed subscription charges (M23: day 0, 3, 7, 14).
  retryFirstDays: z.number().int().min(1).max(60).default(3),
  retrySecondDays: z.number().int().min(1).max(60).default(7),
  hideInDebtDays: z.number().int().min(1).max(180).default(14),
  giftCardMinYears: z.number().int().min(5).max(20).default(5), // the law requires at least five years
  // Features
  onlineBooking: z.boolean().default(true),
  giftCards: z.boolean().default(true),
  waitlist: z.boolean().default(true),
  clientAssistant: z.boolean().default(false),
  maintenanceMode: z.boolean().default(false),
  maintenanceMessage: z.string().max(300).default('האתר בתחזוקה קצרה. הזמנות קיימות אינן נפגעות; נחזור בעוד זמן קצר.'),
  // The medical treatment disclaimer shown on profiles next to medical treatments without a doctor on file (src/lib/medical.ts).
  medicalDisclaimer: z.string().min(20).max(800).default(DEFAULT_MEDICAL_DISCLAIMER),
  // Indexing (/ops/content, tab אינדוקס): the master switch and the public sections search engines may
  // index. A missing section means on. STAGING=1 on the deployment blocks everything regardless.
  indexSite: z.boolean().default(true),
  indexSections: z.partialRecord(z.enum(INDEX_SECTION_KEYS), z.boolean()).default({}),
  // Team: per-role area levels (ops is always full). Stored sparsely.
  // partialRecord: zod 4's record with an enum key is exhaustive, and the overrides are sparse.
  rolePermissions: z.partialRecord(z.enum(OPS_ROLES as [string, ...string[]]), z.partialRecord(z.enum(AREAS as [string, ...string[]]), Level)).default({}),
  // Messages: draft copy per template id, for the WhatsApp/Meta submission.
  templateDrafts: z.record(z.string(), z.string().max(2000)).default({}),
});

export type PlatformSettings = z.infer<typeof PlatformSettingsSchema>;
export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = PlatformSettingsSchema.parse({});

function parse(values: unknown): PlatformSettings {
  const r = PlatformSettingsSchema.safeParse(values ?? {});
  return r.success ? r.data : DEFAULT_PLATFORM_SETTINGS;
}

export async function platformSettings(): Promise<PlatformSettings> {
  const row = await db.platformSettings.findUnique({ where: { id: 1 } }).catch(() => null);
  return parse(row?.values);
}

export async function savePlatformSettings(actorId: string, patch: Partial<PlatformSettings>): Promise<PlatformSettings> {
  const cur = await platformSettings();
  const merged = PlatformSettingsSchema.parse({ ...cur, ...patch });
  await db.platformSettings.upsert({ where: { id: 1 }, create: { id: 1, values: merged as unknown as Prisma.InputJsonValue, updatedById: actorId }, update: { values: merged as unknown as Prisma.InputJsonValue, updatedById: actorId } });
  await db.auditLog.create({ data: { actorId, action: 'platform_settings', subjectType: 'platform_settings', subjectId: actorId, meta: { keys: Object.keys(patch) } } });
  return merged;
}

export const permissionOverrides = async (): Promise<PermissionOverrides> => (await platformSettings()).rolePermissions as PermissionOverrides;
