import 'server-only';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { AREAS, LEVELS, OPS_ROLES, type PermissionOverrides } from '@/components/ops/roles';
import { INDEX_SECTION_KEYS } from '@/lib/indexing';
import { DEFAULT_MEDICAL_DISCLAIMER, DEFAULT_MEDICAL_STATED_DISCLAIMER } from '@/lib/medical';
import { MarketPricesSchema } from '@/lib/marketPrices';
import { PLAN_MONTHLY_NIS, VAT_RATE } from '@/lib/pricing';
import { DEFAULT_FREE_MONTH_QUOTA, DEFAULT_HOME_MONTHLY_NIS, DEFAULT_LIST_MONTHLY_NIS, DEFAULT_MAKE_GOOD_VISITS, DEFAULT_SLOTS_PER_PAGE } from '@/lib/sponsored';
import { db } from './db';

// Platform settings edited on /ops/settings (one row, JSON). Code constants are the defaults, so a
// fresh database behaves exactly as before; a saved value overrides them where the server reads them
// (plan prices on billing screens, the sponsored monthly prices, feature flags, maintenance mode).

const Level = z.enum(LEVELS as [string, ...string[]]);

export const PlatformSettingsSchema = z.object({
  // Pricing (NIS per live branch per month). Defaults from src/lib/pricing.ts.
  basicMonthlyNis: z.number().int().min(0).max(100_000).default(PLAN_MONTHLY_NIS.basic),
  advancedMonthlyNis: z.number().int().min(0).max(100_000).default(PLAN_MONTHLY_NIS.advanced),
  // Sponsored placements, by the month (src/lib/sponsored.ts): a city + category list or a treatment page,
  // and the homepage; slots per page; the free first month quota; the make-good threshold.
  sponsoredListMonthlyNis: z.number().int().min(0).max(100_000).default(DEFAULT_LIST_MONTHLY_NIS),
  sponsoredHomeMonthlyNis: z.number().int().min(0).max(100_000).default(DEFAULT_HOME_MONTHLY_NIS),
  sponsoredSlotsPerPage: z.number().int().min(0).max(20).default(DEFAULT_SLOTS_PER_PAGE),
  sponsoredFreeMonthQuota: z.number().int().min(0).max(10_000).default(DEFAULT_FREE_MONTH_QUOTA),
  sponsoredMakeGoodVisits: z.number().int().min(0).max(10_000).default(DEFAULT_MAKE_GOOD_VISITS),
  // Weekly-era keys, kept so a saved settings row still parses; nothing reads them.
  sponsoredWeeklyNis: z.number().int().min(0).max(100_000).optional(),
  sponsoredMaxPerList: z.number().int().min(0).max(20).optional(),
  // VAT shown on clinic prices (Israeli VAT). Platform invoices carry no Israeli VAT (docs/decisions.md).
  vatRatePct: z.number().min(0).max(50).default(Math.round(VAT_RATE * 100)),
  // Billing policy for failed subscription charges (M23: day 0, 3, 7, 14).
  retryFirstDays: z.number().int().min(1).max(60).default(3),
  retrySecondDays: z.number().int().min(1).max(60).default(7),
  hideInDebtDays: z.number().int().min(1).max(180).default(14),
  giftCardMinYears: z.number().int().min(5).max(20).default(5), // the law requires at least five years
  // Google Analytics 4 measurement ID (G-XXXXXXX). Empty means no analytics tag. The tag loads only after
  // the visitor allows measurement cookies (src/components/analytics/GoogleAnalytics.tsx).
  analyticsMeasurementId: z.string().trim().toUpperCase().regex(/^(G-[A-Z0-9]{4,20})?$/, 'מזהה בפורמט G-XXXXXXX').max(24).default(''),
  // Features
  onlineBooking: z.boolean().default(true),
  giftCards: z.boolean().default(true),
  waitlist: z.boolean().default(true),
  clientAssistant: z.boolean().default(false),
  maintenanceMode: z.boolean().default(false),
  maintenanceMessage: z.string().max(300).default('האתר בתחזוקה קצרה. הזמנות קיימות אינן נפגעות; נחזור בעוד זמן קצר.'),
  // The medical treatment disclaimer shown on profiles next to medical treatments without a doctor on file (src/lib/medical.ts).
  medicalDisclaimer: z.string().min(20).max(800).default(DEFAULT_MEDICAL_DISCLAIMER),
  // The same popover when the business names a doctor whose license is not checked; {name} is the stated doctor.
  medicalStatedDisclaimer: z.string().min(20).max(800).refine(t => t.includes('{name}'), 'חייב להכיל {name}').default(DEFAULT_MEDICAL_STATED_DISCLAIMER),
  // Indexing (/ops/content, tab אינדוקס): the master switch and the public sections search engines may
  // index. A missing section means on. STAGING=1 on the deployment blocks everything regardless.
  indexSite: z.boolean().default(true),
  indexSections: z.partialRecord(z.enum(INDEX_SECTION_KEYS), z.boolean()).default({}),
  // Google indexing (/ops/content, tab גוגל): the Indexing API and URL Inspection runner in
  // src/lib/server/googleIndexing.ts. Off until a person turns it on; the service account key is an env secret.
  googleIndexing: z.object({
    enabled: z.boolean().default(false),
    submitNew: z.boolean().default(true), // new sitemap URLs go to Google on the next run (and right after an article is published)
    submitBacklog: z.boolean().default(true), // URLs Google has not indexed (or not inspected yet) are sent within the daily quota
    inspect: z.boolean().default(true), // URL Inspection API checks which URLs are indexed
    dailySubmitLimit: z.number().int().min(1).max(2000).default(200), // Google's default Indexing API quota is 200 a day
    dailyInspectLimit: z.number().int().min(0).max(2000).default(2000), // URL Inspection allows 2,000 a day per property
    property: z.string().trim().max(200).default(''), // Search Console property; empty means SITE_URL with a trailing slash
  }).prefault({}),
  // Messaggio (/ops/messages): SMS and WhatsApp for verification codes (src/lib/vendors/messaggio.ts). The API
  // key is a secret (platform_secrets or MESSAGGIO_LOGIN), never stored here.
  messaggio: z.object({
    enabled: z.boolean().default(false),
    sms: z.boolean().default(true),
    whatsapp: z.boolean().default(true),
    smsSender: z.string().trim().max(11).default('BeautyFind'), // alphanumeric sender id, up to 11 characters
    whatsappSender: z.string().trim().max(64).default(''), // the WhatsApp sender registered in Messaggio
    whatsappTemplate: z.string().trim().max(120).default(''), // approved authentication template; empty sends text
    fallbackToSms: z.boolean().default(true), // a WhatsApp send the API refuses is retried once as SMS
    baseUrl: z.string().trim().url().max(200).default('https://msg.messaggio.com/api/v1'),
  }).prefault({}),
  // Twilio (/ops/messages): SMS for verification codes (src/lib/vendors/twilio.ts). When on, every SMS code goes
  // through Twilio, including the SMS fallback of a WhatsApp code. Account SID and Auth Token are secrets.
  twilio: z.object({
    enabled: z.boolean().default(false),
    from: z.string().trim().max(20).default(''), // E.164 Twilio number or alphanumeric sender ID
    messagingServiceSid: z.string().trim().max(40).default(''), // MG…; takes precedence over `from`
    // Voice calls read the code aloud (the ownership claim's "שיחה קולית"). They need a Twilio phone number with
    // voice; empty means `from` when that is a phone number. The voice is a Twilio text-to-speech voice for Hebrew.
    voiceFrom: z.string().trim().max(20).default(''),
    voice: z.string().trim().max(60).default('Google.he-IL-Standard-A'),
    // WhatsApp through the same Twilio account (src/lib/server/whatsapp.ts): service notices go as approved Content
    // templates from this sender, and fall back to SMS when WhatsApp cannot deliver. `whatsappForSms` also sends
    // notices asked as SMS by WhatsApp first (cheaper in Israel); verification codes keep their own route.
    whatsappEnabled: z.boolean().default(false),
    whatsappFrom: z.string().trim().max(20).default(''),
    whatsappForSms: z.boolean().default(true),
    // template id → the Twilio Content template made for it and its WhatsApp approval state.
    whatsappTemplates: z.record(z.string().max(60), z.object({
      sid: z.string().max(40),
      name: z.string().max(80),
      vars: z.array(z.string().max(40)).max(20),
      skeleton: z.string().max(2000),
      status: z.string().max(30).default('unsubmitted'),
      reason: z.string().max(300).optional(),
    })).default({}),
  }).prefault({}),
  // Email (/ops/messages): every email goes through Resend (src/lib/vendors/resend.ts) when this is on and an API key is
  // stored. The key is a secret (platform_secrets or RESEND_API_KEY). The from address must be on a domain verified in Resend.
  email: z.object({
    enabled: z.boolean().default(false),
    from: z.string().trim().max(160).default('BeautyFind <noreply@beautyfind.co.il>'),
    replyTo: z.string().trim().max(160).default(''),
    // Reply tracking (/ops/emails): each email gets its own reply address r-<token>@<replyDomain>, a subdomain whose MX
    // points to Resend (receiving), so a reply is matched to its email, stored and forwarded to `forwardTo`.
    // Empty replyDomain means replies go to replyTo as before.
    replyDomain: z.string().trim().toLowerCase().max(120).default(''),
    forwardTo: z.string().trim().max(160).default('hello@beautyfind.co.il'),
  }).prefault({}),
  // Team: per-role area levels (ops is always full). Stored sparsely.
  // partialRecord: zod 4's record with an enum key is exhaustive, and the overrides are sparse.
  rolePermissions: z.partialRecord(z.enum(OPS_ROLES as [string, ...string[]]), z.partialRecord(z.enum(AREAS as [string, ...string[]]), Level)).default({}),
  // Messages: draft copy per template id, for the WhatsApp/Meta submission.
  templateDrafts: z.record(z.string(), z.string().max(2000)).default({}),
  // Market price ranges per treatment category (src/lib/marketPrices.ts). Absent means the seed file; staff
  // edits on /ops/settings store the whole document here, with the staff-only fields.
  marketPrices: MarketPricesSchema.optional(),
  // Magazine: when on, publish_article (MCP and admin) files a proposal in the approvals queue instead of
  // publishing; a person approves on /ops/ai and the approval publishes.
  magazinePublishApproval: z.boolean().default(false),
  // Automations (/ops/automations): each switch stops new messages of that kind and holds the ones already queued.
  // Claim invites start off: they go to businesses that never asked to hear from us, so staff send them in batches.
  automations: z.object({
    reviewRequest: z.boolean().default(true), // M6, three days after a completed booking
    reminderSms: z.boolean().default(true), // M2 by SMS when the client left no email or email is not connected
    giftDelivery: z.boolean().default(true), // M14 on the send date the buyer picked
    giftExpiry: z.boolean().default(true), // M15, 90 and 30 days before a gift card with a balance expires
    paymentFailed: z.boolean().default(true), // M23, days 0, 3, 7 and 14 of a failed subscription charge
    sponsored: z.boolean().default(true), // M22: approved, rejected, started, ended
    onboarding: z.boolean().default(true), // welcome, finish the profile, add a card
    claimInvites: z.boolean().default(false), // one invite per unclaimed business, sent in staff batches
  }).prefault({}),
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
