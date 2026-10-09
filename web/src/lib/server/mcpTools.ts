import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Area, Level } from '@/components/ops/roles';
import { INDEX_SECTION_KEYS } from '@/lib/indexing';
import { decideAiAction } from './aiActions';
import { runTool as runAssistantTool, type Proposal } from './assistant';
import { db } from './db';
import { listGaps } from './enhanceRuns';
import { PlatformSettingsSchema, platformSettings } from './platformSettings';
import { sitePages } from './seo';
import { loadBranchEdit, type BranchEdit, type TreatmentRow } from '@/app/ops/businesses/branchEdit';
import { listBusinesses, loadBusiness } from '@/app/ops/businesses/data';
import { enhanceBranchesAction, estimateCompletionAction, saveBusinessDetailsAction, setBusinessStatusAction } from '@/app/ops/businesses/actions';
import { generateAltAction, saveContentAction, saveDetailsAction, saveFactsAction, saveMediaAction, saveTreatmentsAction } from '@/app/ops/businesses/[id]/branches/[branchId]/actions';
import { analytics30, indexingFacts, pageRows } from '@/app/ops/content/data';
import { saveSeoAction, setIndexingAction } from '@/app/ops/content/actions';
import { listReports, listReviews } from '@/app/ops/moderation/data';
import { moderateReviewAction, setReportStatusAction } from '@/app/ops/moderation/actions';
import { listCampaigns } from '@/app/ops/sponsored/data';
import { createCampaignAction, reviewCampaignAction } from '@/app/ops/sponsored/actions';
import { listClients, privacyRequests } from '@/app/ops/clients/data';
import { blockClientAction, completePrivacyRequestAction } from '@/app/ops/clients/actions';
import { saveMaintenanceMessageAction, saveMedicalDisclaimerAction, saveNumbersAction, setFlagAction } from '@/app/ops/settings/actions';
import {
  articleLinksAction, createArticleAction, createTagAction, deleteArticleAction, getArticleAction, getAuthorAction, listArticlesAction, listAuthorsAction, listCategoriesAction, listMediaAction, listTagsAction,
  publishArticleAction, replaceInArticleAction, scheduleArticleAction, unpublishArticleAction, updateArticleAction, updateMediaAction, uploadMediaAction, upsertAuthorAction, upsertCategoryAction, validateArticleAction,
} from '@/app/ops/magazine/actions';
import { ArticleCreateSchema, ArticlePatchSchema, AuthorInputSchema, CategoryInputSchema } from './articles';
import { MediaMetaSchema, UploadSchema } from './articleMedia';
import { ARTICLE_PATH_PREFIX } from '@/lib/articleHtml';
import { DEFAULT_OG_IMAGE, SITE_NAME } from '@/lib/seo/meta';
import { LOGO_SIZE, LOGO_URL, ORG_ID, absoluteUrl } from '@/lib/seo/schema';
import { siteUrl } from './site';
import { sitemapEntries } from './sitemapEntries';
import { copyListingImages, type MediaProvenance } from './importMedia';
import type { Prisma } from '@prisma/client';

// Everything the MCP server offers Claude: the whole admin, as tools. Reads return the same data the
// admin screens show; writes call the same server actions the screens call, so validation, audit rows,
// decisions and page refreshes are identical to a person doing it by hand. Each tool names the admin
// area and level it needs; the server offers a caller only the tools their role allows (src/lib/server/mcp.ts).
// The actions read the acting staff member from the actor context the server sets per call.

export interface McpCallContext { proposals: Proposal[]; source: string; actor: { id: string; opsRole: string | null } }

export interface McpTool {
  name: string;
  description: string;
  area: Area;
  level: Level;
  write: boolean;
  schema: z.ZodObject<z.ZodRawShape> | null;
  run: (args: Record<string, unknown>, ctx: McpCallContext) => Promise<unknown>;
}

const uuid = z.string().uuid();
const limit = z.number().int().min(1).max(100).optional();
const fail = (r: { ok: false; error: string; fields?: Record<string, string> }) => ({ ok: false, error: r.error, ...(r.fields ? { fields: r.fields } : {}) });
const result = (r: { ok: boolean; error?: string; fields?: Record<string, string> } & Record<string, unknown>) => (r.ok ? { ...r, ok: true as const } : fail(r as { ok: false; error: string; fields?: Record<string, string> }));

async function branchOr404(id: string): Promise<BranchEdit | { error: string }> {
  const b = await loadBranchEdit(id);
  return b ?? { error: 'branch not found' };
}

const HoursRow = z.object({ open: z.string().max(5), close: z.string().max(5), closed: z.boolean(), unknown: z.boolean() });
const DetailsPatch = z.object({
  name: z.string().max(120).optional(), slug: z.string().max(120).optional(), regionSlug: z.string().max(40).optional(), cityName: z.string().max(80).optional(), address: z.string().max(200).optional(),
  lat: z.string().max(20).optional(), lng: z.string().max(20).optional(), phone: z.string().max(30).optional(), whatsapp: z.string().max(30).optional(), email: z.string().max(160).optional(),
  websiteUrl: z.string().max(500).optional(), wazeUrl: z.string().max(500).optional(), googlePlaceUrl: z.string().max(500).optional(), googlePlaceId: z.string().max(200).optional(),
  accessible: z.boolean().optional(), freeParking: z.boolean().optional(), onlineBooking: z.boolean().optional(), status: z.enum(['draft', 'live', 'unpublished']).optional(), isClaimed: z.boolean().optional(), noindex: z.boolean().optional(),
  cats: z.array(z.string().max(60)).max(20).optional(), primaryCat: z.string().max(60).optional(), medicalResponsibleId: z.string().max(60).optional(), hours: z.array(HoursRow).length(7).optional(),
});
const ContentPatch = z.object({ description: z.string().max(6000).optional(), faqs: z.array(z.object({ q: z.string().max(300), a: z.string().max(2000) })).max(12).optional(), metaTitle: z.string().max(120).optional(), metaDescription: z.string().max(320).optional(), editorialHeading: z.string().max(40).optional(), ownerApproved: z.boolean().optional() });
const MediaPatch = z.object({ coverUrl: z.string().max(80).optional(), coverAlt: z.string().max(200).optional(), logoUrl: z.string().max(80).optional(), gallery: z.array(z.object({ url: z.string().max(80), alt: z.string().max(200), tag: z.string().max(20).optional() })).max(24).optional(), videos: z.array(z.object({ id: z.string().max(20), title: z.string().max(200).optional() })).max(12).optional() });
const FactsPatch = z.object({ instagram: z.string().max(60).optional(), facebook: z.string().max(300).optional(), tiktok: z.string().max(300).optional(), youtube: z.string().max(300).optional(), establishedYear: z.string().max(4).optional(), languages: z.string().max(200).optional(), teamSize: z.string().max(4).optional(), team: z.array(z.object({ name: z.string().max(80), role: z.string().max(80).optional(), bio: z.string().max(400).optional(), sourceUrl: z.string().max(400).optional() })).max(30).optional(), accessibleKnown: z.enum(['unknown', 'yes', 'no']).optional(), parkingKnown: z.enum(['unknown', 'yes', 'no']).optional() });
const TreatmentUpsert = z.object({
  id: uuid.optional().describe('מזהה טיפול קיים לעדכון; בלי מזהה נוצר טיפול חדש'),
  name: z.string().max(120).optional(), description: z.string().max(1000).optional(), categorySlug: z.string().max(60).optional(),
  priceType: z.enum(['fixed', 'from', 'per_unit', 'per_ml', 'per_area', 'range', 'package', 'free', 'on_request']).optional(),
  price: z.string().max(10).optional().describe('בשקלים שלמים'), priceMax: z.string().max(10).optional(), priceNote: z.string().max(80).optional(), duration: z.string().max(4).optional().describe('דקות'),
  isPublished: z.boolean().optional(), isMedical: z.boolean().optional(), requiresDeclaration: z.boolean().optional(), onlineBookable: z.boolean().optional(), taxIncluded: z.enum(['unknown', 'yes', 'no']).optional(),
});

const SETTING_NUMBERS = ['basicMonthlyNis', 'advancedMonthlyNis', 'sponsoredWeeklyNis', 'sponsoredMaxPerList', 'vatRatePct', 'retryFirstDays', 'retrySecondDays', 'hideInDebtDays', 'giftCardMinYears'] as const;
const SETTING_FLAGS = ['onlineBooking', 'giftCards', 'waitlist', 'clientAssistant', 'maintenanceMode'] as const;

export const MCP_TOOLS: McpTool[] = [
  // ---------- overview and finance ----------
  { name: 'platform_summary', area: 'overview', level: 'view', write: false, schema: null, description: 'מצב הפלטפורמה עכשיו: עסקים לפי מצב, MRR, הזמנות החודש וכל התורים שמחכים לאדם, עם קישור לכל מסך.', run: (a, c) => runAssistantTool('platform_summary', a, c.proposals, c.source) },
  { name: 'billing_overview', area: 'accounting', level: 'view', write: false, schema: z.object({ months: z.number().int().min(1).max(24).optional() }), description: 'הכנסות הפלטפורמה לפי חודש (מנויים ומקומות ממומנים), מדיניות המע״מ והמנויים בחוב.', run: (a, c) => runAssistantTool('billing_overview', a, c.proposals, c.source) },
  { name: 'analytics_30d', area: 'content', level: 'view', write: false, schema: null, description: 'אנליטיקס פנימי ל־30 יום: צפיות בפרופילים, פניות, התחלות הזמנה, ניווטי Waze והפרופילים הנצפים.', run: () => analytics30() },
  { name: 'platform_settings', area: 'settings', level: 'view', write: false, schema: null, description: 'הגדרות הפלטפורמה: מחירים, מע״מ להצגה, מדיניות חיוב, תכונות, תחזוקה, הרשאות תפקידים, אינדוקס.', run: () => platformSettings() },
  { name: 'audit_log', area: 'audit', level: 'view', write: false, schema: z.object({ action: z.string().max(60).optional().describe('סינון לפי סוג פעולה, למשל branch_edit'), business_id: uuid.optional(), limit }), description: 'יומן הפעולות (append-only): מי עשה מה ומתי, כולל קריאות MCP.', run: async a => {
    const rows = await db.auditLog.findMany({ where: { ...(a.action ? { action: String(a.action) } : {}), ...(a.business_id ? { businessId: String(a.business_id) } : {}) }, orderBy: { createdAt: 'desc' }, take: Number(a.limit ?? 50), select: { id: true, actorId: true, action: true, subjectType: true, subjectId: true, businessId: true, meta: true, createdAt: true } });
    const ids = [...new Set(rows.map(r => r.actorId).filter((x): x is string => !!x))];
    const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } }) : [];
    const who = new Map(users.map(u => [u.id, u.fullName || u.email || u.id]));
    return rows.map(r => ({ ...r, actor: r.actorId ? who.get(r.actorId) ?? null : 'system' }));
  } },

  // ---------- businesses and listings ----------
  { name: 'search_businesses', area: 'businesses', level: 'view', write: false, schema: z.object({ query: z.string().max(120).optional(), status: z.enum(['pending', 'live', 'past_due', 'hidden']).optional(), in_debt: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() }), description: 'חיפוש עסקים לפי שם, מצב או חוב: מזהה, שם, מצב, תוכנית, סניפים, אזורים, מנוי וחיוב.', run: (a, c) => runAssistantTool('search_businesses', a, c.proposals, c.source) },
  { name: 'list_businesses', area: 'businesses', level: 'view', write: false, schema: z.object({ filter: z.enum(['all', 'live', 'past_due', 'pending', 'hidden', 'no_subscription']).optional(), q: z.string().max(120).optional(), region: z.string().max(40).optional(), category: z.string().max(60).optional(), claimed: z.enum(['all', 'claimed', 'unclaimed']).optional(), plan: z.enum(['all', 'basic', 'advanced', 'none']).optional(), limit }), description: 'רשימת העסקים כמו במסך ״עסקים״, עם הסינונים שלו (מצב, אזור, תחום, בעלות, תוכנית).', run: a => listBusinesses({ filter: (a.filter as 'all') ?? 'all', q: String(a.q ?? ''), region: a.region as string | undefined, category: a.category as string | undefined, claimed: a.claimed as 'all' | undefined, plan: a.plan as 'all' | undefined, take: Number(a.limit ?? 50) }) },
  { name: 'get_business', area: 'businesses', level: 'view', write: false, schema: z.object({ business_id: uuid }), description: 'כרטיס העסק: פרטים משפטיים, בעלים, מנוי, סניפים עם קטגוריות ומצב, צוות ורישיונות, בקשות אימות, החלטות, חיובים, מקומות ממומנים ומחלוקות.', run: async a => {
    const b = await loadBusiness(String(a.business_id));
    if (!b) return { error: 'business not found' };
    const { branches, staff, providerConnections, ...rest } = b;
    return { ...rest, branches: branches.map(br => ({ id: br.id, name: br.name, slug: br.slug, regionSlug: br.regionSlug, cityName: br.cityName, status: br.status, isClaimed: br.isClaimed, noindex: br.noindex, categories: br.categories.map(c => ({ slug: c.categorySlug, primary: c.isPrimary })), medicalResponsible: br.medicalResponsible?.displayName ?? null, updatedAt: br.updatedAt })), staff, providers: providerConnections };
  } },
  { name: 'update_business', area: 'businesses', level: 'edit', write: true, schema: z.object({ business_id: uuid, legalName: z.string().max(200).optional(), companyNo: z.string().max(12).optional(), type: z.enum(['clinic', 'medspa', 'cosmetics', 'salon']).optional(), invoiceEmail: z.string().max(160).optional(), accountantEmail: z.string().max(160).optional(), chainKey: z.string().max(120).optional() }), description: 'עדכון פרטי העסק (שם משפטי, ח.פ., סוג, דוא״ל לחשבוניות ולרואה החשבון, מפתח רשת). שדות שלא נשלחו נשארים.', run: async a => {
    const b = await db.business.findUnique({ where: { id: String(a.business_id) }, select: { id: true, legalName: true, companyNo: true, type: true, invoiceEmail: true, accountantEmail: true, chainKey: true } });
    if (!b) return { error: 'business not found' };
    return result(await saveBusinessDetailsAction({ id: b.id, legalName: (a.legalName as string) ?? b.legalName ?? '', companyNo: (a.companyNo as string) ?? b.companyNo ?? '', type: (a.type as 'salon') ?? b.type, invoiceEmail: (a.invoiceEmail as string) ?? b.invoiceEmail ?? '', accountantEmail: (a.accountantEmail as string) ?? b.accountantEmail ?? '', chainKey: (a.chainKey as string) ?? b.chainKey ?? '' }));
  } },
  { name: 'set_business_status', area: 'businesses', level: 'edit', write: true, schema: z.object({ business_id: uuid, status: z.enum(['pending', 'live', 'past_due', 'hidden']), reason: z.string().max(300).optional() }), description: 'שינוי מצב העסק: live מפרסם, hidden מסיר מהמדריך, pending/past_due לפי המצב. נרשם כהחלטה עם סיבה והעמודים הציבוריים מתרעננים.', run: async a => result(await setBusinessStatusAction({ id: String(a.business_id), status: a.status as 'live', reason: a.reason as string | undefined })) },
  { name: 'list_branches', area: 'businesses', level: 'view', write: false, schema: z.object({ q: z.string().max(120).optional(), region: z.string().max(40).optional(), city: z.string().max(80).optional().describe('שם העיר'), category: z.string().max(60).optional(), status: z.enum(['draft', 'live', 'unpublished']).optional(), claimed: z.boolean().optional(), noindex: z.boolean().optional(), business_id: uuid.optional(), limit }), description: 'רשימת סניפים (פרופילים ציבוריים) עם סינון לפי טקסט, אזור, עיר, תחום, מצב, בעלות, noindex או עסק.', run: async a => {
    const rows = await db.branch.findMany({
      where: {
        ...(a.q ? { OR: [{ name: { contains: String(a.q), mode: 'insensitive' } }, { slug: { contains: String(a.q), mode: 'insensitive' } }, { address: { contains: String(a.q), mode: 'insensitive' } }] } : {}),
        ...(a.region ? { regionSlug: a.region as never } : {}), ...(a.city ? { cityName: String(a.city) } : {}), ...(a.category ? { categories: { some: { categorySlug: String(a.category) } } } : {}),
        ...(a.status ? { status: a.status as 'live' } : {}), ...(typeof a.claimed === 'boolean' ? { isClaimed: a.claimed } : {}), ...(typeof a.noindex === 'boolean' ? { noindex: a.noindex } : {}), ...(a.business_id ? { businessId: String(a.business_id) } : {}),
      },
      orderBy: { updatedAt: 'desc' }, take: Number(a.limit ?? 50),
      select: { id: true, businessId: true, name: true, slug: true, regionSlug: true, cityName: true, status: true, isClaimed: true, noindex: true, updatedAt: true, categories: { select: { categorySlug: true, isPrimary: true } }, business: { select: { status: true } } },
    });
    return rows.map(b => ({ id: b.id, business_id: b.businessId, name: b.name, slug: b.slug, region: b.regionSlug, city: b.cityName, status: b.status, business_status: b.business.status, claimed: b.isClaimed, noindex: b.noindex, categories: b.categories.map(c => c.categorySlug), primary: b.categories.find(c => c.isPrimary)?.categorySlug ?? null, updated: b.updatedAt, admin_href: `/ops/businesses/${b.businessId}/branches/${b.id}` }));
  } },
  { name: 'get_branch', area: 'businesses', level: 'view', write: false, schema: z.object({ branch_id: uuid }), description: 'הפרופיל המלא של סניף כמו בעורך: פרטים, תוכן (תיאור, שאלות ותשובות, מטא), מדיה, עובדות וצוות, טיפולים עם מחירים, מצב ההשלמה והחוסרים.', run: a => branchOr404(String(a.branch_id)) },
  { name: 'update_branch_details', area: 'businesses', level: 'edit', write: true, schema: z.object({ branch_id: uuid, patch: DetailsPatch }), description: 'עדכון פרטי הסניף: שם, slug, אזור, עיר, כתובת, קואורדינטות, טלפון, וואטסאפ, דוא״ל, אתר, Waze, Google, דגלים, מצב (draft/live/unpublished), בעלות, noindex, קטגוריות וראשית, אחראי רפואי, שעות (7 שורות). שדות שלא נשלחו נשארים.', run: async a => {
    const b = await branchOr404(String(a.branch_id)); if ('error' in b) return b;
    return result(await saveDetailsAction(b.id, { ...b.details, ...(a.patch as object) }));
  } },
  { name: 'update_branch_content', area: 'businesses', level: 'edit', write: true, schema: z.object({ branch_id: uuid, patch: ContentPatch }), description: 'עדכון תוכן הסניף: תיאור, שאלות ותשובות, כותרת ותיאור מטא, כותרת המדור, סימון ״טקסט מאושר״ (הכותב האוטומטי לא יחליף).', run: async a => {
    const b = await branchOr404(String(a.branch_id)); if ('error' in b) return b;
    return result(await saveContentAction(b.id, { ...b.content, ...(a.patch as object) }));
  } },
  { name: 'update_branch_media', area: 'businesses', level: 'edit', write: true, schema: z.object({ branch_id: uuid, patch: MediaPatch }), description: 'עדכון מדיה: שער ותיאורו, לוגו, גלריה (כתובות /media/... של העסק עם תיאור נגישות ותגית), סרטוני YouTube. העלאת קבצים חדשים נעשית בעורך; כאן משנים, מסירים ומסדרים.', run: async a => {
    const b = await branchOr404(String(a.branch_id)); if ('error' in b) return b;
    const p = a.patch as z.infer<typeof MediaPatch>;
    const media = { ...b.media, ...(p.coverUrl !== undefined ? { coverUrl: p.coverUrl } : {}), ...(p.coverAlt !== undefined ? { coverAlt: p.coverAlt } : {}), ...(p.logoUrl !== undefined ? { logoUrl: p.logoUrl } : {}),
      ...(p.gallery ? { gallery: p.gallery.map(g => ({ url: g.url, alt: g.alt, tag: g.tag ?? '' })) } : {}),
      ...(p.videos ? { videos: p.videos.map(v => { const old = b.media.videos.find(x => x.id === v.id); return { id: v.id, title: v.title ?? old?.title ?? '', status: old?.status ?? 'ok', source: old?.source ?? 'owner' }; }) } : {}) };
    return result(await saveMediaAction(b.id, media));
  } },
  { name: 'add_branch_photos', area: 'businesses', level: 'edit', write: true, schema: z.object({
    branch_id: uuid,
    photos: z.array(z.object({
      url: z.string().url().max(2000).describe('כתובת https ציבורית של התמונה'),
      page_url: z.string().url().max(2000).optional().describe('העמוד או הפרופיל שבו נמצאה'),
      provider: z.enum(['website', 'instagram', 'facebook', 'google_profile']).optional(),
      alt: z.string().min(4).max(200).optional().describe('תיאור נגישות בעברית'),
    })).max(8).optional(),
    logo_url: z.string().url().max(2000).optional().describe('נשמר רק כשאין לוגו'),
  }), description: 'הוספת תמונות וסמל לסניף מכתובות ציבוריות (למשל מאתר העסק או מאינסטגרם שלו): כל תמונה נבדקת (סוג, גודל, איכות, כפילויות), מומרת ל־WebP ונשמרת אצלנו עם רישום המקור. התמונות מתווספות לגלריה (עד 24); אם אין תמונת שער, הטובה ביותר הופכת לשער; לוגו נשמר רק כשאין. סניף בבעלות מאומתת לא משתנה.', run: async (a, ctx) => {
    const b = await branchOr404(String(a.branch_id)); if ('error' in b) return b;
    if (b.details.isClaimed) return { ok: false, error: 'claimed: the owner manages this listing' };
    const photos = (a.photos ?? []) as Array<{ url: string; page_url?: string; provider?: 'website' | 'instagram' | 'facebook' | 'google_profile'; alt?: string }>;
    const wantLogo = !b.media.logoUrl && typeof a.logo_url === 'string' ? a.logo_url : null;
    const room = Math.max(0, 24 - b.media.gallery.length);
    if (!wantLogo && (!photos.length || !room)) return { ok: false, error: photos.length ? 'gallery_full' : 'nothing_to_add' };
    const copied = await copyListingImages({
      name: b.details.name, cityName: b.details.cityName, logoUrl: wantLogo, photoUrls: room ? photos.map(p => p.url) : [],
      candidates: photos.map(p => ({ url: p.url, pageUrl: p.page_url ?? null, provider: p.provider ?? 'website', alt: p.alt ?? null })),
    }, ctx.actor.id, b.businessId, Math.min(room, photos.length));
    const altBySource = new Map(photos.filter(p => p.alt).map(p => [p.url, p.alt!.trim()]));
    const sourceOf = new Map(copied.provenance.map(p => [p.url, p.sourceUrl]));
    const added = copied.photos.slice(0, room).map(p => ({ url: p.url, alt: altBySource.get(sourceOf.get(p.url) ?? '') ?? p.alt, tag: '' }));
    const coverEmpty = !b.media.coverUrl || !b.media.coverUrl.startsWith('/media/');
    const cover = coverEmpty ? added[0] : undefined;
    const rest = cover ? added.slice(1) : added;
    const media = {
      ...b.media,
      ...(cover ? { coverUrl: cover.url, coverAlt: cover.alt } : {}),
      ...(copied.logoUrl ? { logoUrl: copied.logoUrl } : {}),
      gallery: [...b.media.gallery, ...rest].slice(0, 24),
    };
    if (!added.length && !copied.logoUrl) return { ok: true, added: 0, cover: false, logo: false, rejected: photos.length, note: 'no image passed the checks (broken, too small, a graphic or a duplicate)' };
    const saved = await saveMediaAction(b.id, media);
    if (!saved.ok) return fail(saved);
    if (copied.provenance.length) {
      const row = await db.branch.findUnique({ where: { id: b.id }, select: { mediaProvenance: true } });
      const prev = (Array.isArray(row?.mediaProvenance) ? row!.mediaProvenance : []) as unknown as MediaProvenance[];
      await db.branch.update({ where: { id: b.id }, data: { mediaProvenance: [...prev, ...copied.provenance] as unknown as Prisma.InputJsonValue } });
    }
    return { ok: true, added: added.length, cover: !!cover, logo: !!copied.logoUrl, rejected: photos.length - added.length };
  } },
  { name: 'generate_alt_text', area: 'businesses', level: 'edit', write: true, schema: z.object({ branch_id: uuid, url: z.string().max(80).describe('כתובת /media/... מתוך get_branch'), kind: z.enum(['cover', 'logo', 'gallery']), tag: z.string().max(20).optional() }), description: 'תיאור נגישות לתמונה ב־AI (Claude). מחזיר את הטקסט; שמירה דרך update_branch_media.', run: async a => result(await generateAltAction(String(a.branch_id), { url: String(a.url), kind: a.kind as 'cover', tag: a.tag as string | undefined })) },
  { name: 'update_branch_facts', area: 'businesses', level: 'edit', write: true, schema: z.object({ branch_id: uuid, patch: FactsPatch }), description: 'עדכון עובדות: רשתות חברתיות, שנת הקמה, שפות, גודל צוות, אנשי צוות שמופיעים באתר, נגישות וחניה (לא ידוע/כן/לא).', run: async a => {
    const b = await branchOr404(String(a.branch_id)); if ('error' in b) return b;
    const p = a.patch as z.infer<typeof FactsPatch>;
    const team = p.team ? p.team.map(t => ({ name: t.name, role: t.role ?? '', bio: t.bio ?? '', sourceUrl: t.sourceUrl ?? '' })) : b.facts.team;
    return result(await saveFactsAction(b.id, { ...b.facts, ...p, team }));
  } },
  { name: 'set_branch_treatments', area: 'businesses', level: 'edit', write: true, schema: z.object({ branch_id: uuid, upsert: z.array(TreatmentUpsert).max(100).optional().describe('טיפולים לעדכון (עם id) או ליצירה (בלי id)'), delete: z.array(uuid).max(200).optional().describe('מזהי טיפולים למחיקה') }), description: 'תפריט הטיפולים: עדכון טיפולים קיימים, הוספת חדשים ומחיקה, עם כל העמודות (סוג מחיר, מחיר, טווח, הערה, משך, מפורסם, רפואי, הצהרה, הזמנה אונליין, מע״מ).', run: async a => {
    const b = await branchOr404(String(a.branch_id)); if ('error' in b) return b;
    const del = new Set((a.delete as string[] | undefined) ?? []);
    const rows: TreatmentRow[] = b.treatments.filter(t => !t.id || !del.has(t.id));
    for (const [i, u] of ((a.upsert as z.infer<typeof TreatmentUpsert>[] | undefined) ?? []).entries()) {
      const idx = u.id ? rows.findIndex(r => r.id === u.id) : -1;
      if (u.id && idx < 0) return { ok: false, error: `treatment ${u.id} is not on this branch` };
      const base: TreatmentRow = idx >= 0 ? rows[idx] : { key: `new-${i}`, id: null, name: '', description: '', categorySlug: '', priceType: 'fixed', price: '', priceMax: '', priceNote: '', duration: '', isPublished: true, isMedical: false, requiresDeclaration: false, onlineBookable: true, taxIncluded: 'unknown', source: 'owner' };
      const { id: _id, ...patch } = u;
      const next = { ...base, ...patch } as TreatmentRow;
      if (idx >= 0) rows[idx] = next; else rows.push(next);
    }
    return result(await saveTreatmentsAction(b.id, { rows, deleted: [...del] }));
  } },
  { name: 'list_gaps', area: 'businesses', level: 'view', write: false, schema: z.object({ region: z.string().max(40).optional(), city: z.string().max(80).optional(), category: z.string().max(60).optional(), q: z.string().max(120).optional(), missing: z.string().max(40).optional().describe('מדור חסר, למשל description, faqs, photos, treatments, hours'), status: z.string().max(40).optional(), claimed: z.enum(['all', 'claimed', 'unclaimed']).optional(), live: z.enum(['all', 'live']).optional(), limit, offset: z.number().int().min(0).max(100000).optional().describe('כמה שורות לדלג (לעימוד)'), sort: z.enum(['updated', 'created']).optional().describe('updated (ברירת מחדל): עודכנו לאחרונה קודם; created: לפי סדר יצירה, יציב לעימוד') }), description: 'החוסרים בפרופילים (מסך ״חוסרים והשלמה ב־AI״): מוכנות, מדורים חסרים, התוכנית האוטומטית והריצה האחרונה לכל סניף.', run: a => listGaps({ region: a.region as string | undefined, city: a.city as string | undefined, category: a.category as string | undefined, q: a.q as string | undefined, missing: a.missing as string | undefined, status: a.status as string | undefined, claimed: a.claimed as 'all' | undefined, live: a.live as 'all' | undefined, take: Number(a.limit ?? 50), skip: Number(a.offset ?? 0), order: a.sort === 'created' ? 'created' : 'updated' }) },
  { name: 'estimate_ai_completion', area: 'businesses', level: 'view', write: false, schema: z.object({ branch_ids: z.array(uuid).min(1).max(500) }), description: 'אומדן לפני השלמה ב־AI: כמה פרופילים, אילו שלבים ועלות משוערת בדולרים.', run: async a => result(await estimateCompletionAction(a.branch_ids as string[])) },
  { name: 'run_ai_completion', area: 'businesses', level: 'edit', write: true, schema: z.object({ branch_ids: z.array(uuid).min(1).max(500), mode: z.enum(['auto', 'rewrite', 'site', 'images']).optional().describe('auto: התוכנית לפי החוסרים; rewrite: תיאור ושאלות מחדש; site: קריאת האתר מחדש; images: תמונות'), label: z.string().max(120).optional() }), description: 'מפעיל ריצת השלמה ב־AI על פרופילים (עולה כסף אצל ספקי ה־AI; הריצה רצה אצל העובד ומדווחת במסך הייבוא). פרופילים בבעלות מאומתת מדולגים.', run: async a => {
    const r = await enhanceBranchesAction(a.branch_ids as string[], (a.mode as 'auto') ?? 'auto', a.label as string | undefined);
    return r.ok ? { ok: true, count: r.count, run_id: r.runId, budget_usd: r.budgetUsd, plan: r.plan, seeded: r.seeded, skipped: r.skipped, href: r.runId ? `/ops/import/review?run=${r.runId}` : null } : { ok: false, error: r.error, skipped: r.skipped };
  } },

  // ---------- pages, SEO and indexing ----------
  { name: 'list_pages', area: 'content', level: 'view', write: false, schema: null, description: 'העמודים הציבוריים הקבועים (בית, אזורים, תחומים, תוכן, משפטי) עם הכותרת, התיאור, מילת המפתח, מצב האינדקס וציון ה־SEO של כל אחד, וכן אינדקס המגזין (/magazine) ותבנית כתובת המאמרים (/magazine/{slug}).', run: async () => {
    const rows = await pageRows();
    return { pages: rows, magazine: { index: '/magazine', articleUrlPattern: `${ARTICLE_PATH_PREFIX}{slug}`, categoryUrlPattern: '/magazine/category/{slug}', note: 'מאמרים נוצרים ב־create_article; ה־SEO שלהם נערך בשדות המאמר, לא ב־update_page_seo' } };
  } },
  { name: 'update_page_seo', area: 'content', level: 'edit', write: true, schema: z.object({ path: z.string().max(120).describe('הנתיב מתוך list_pages, למשל /treatments/facials'), title: z.string().max(120).optional().describe('ריק = ברירת המחדל של הקוד'), description: z.string().max(320).optional(), keyword: z.string().max(60).optional(), noindex: z.boolean().optional() }), description: 'עדכון ה־SEO של עמוד קבוע: כותרת, תיאור, מילת מפתח ו־noindex. שדות שלא נשלחו נשארים; מחרוזת ריקה מחזירה לברירת המחדל.', run: async a => {
    const path = String(a.path);
    if (!sitePages().some(p => p.path === path)) return { error: 'unknown page; use list_pages' };
    const cur = await db.pageSeo.findUnique({ where: { path } });
    return result(await saveSeoAction({ path, title: (a.title as string) ?? cur?.title ?? '', description: (a.description as string) ?? cur?.description ?? '', keyword: (a.keyword as string) ?? cur?.keyword ?? '', noindex: (a.noindex as boolean) ?? cur?.noindex ?? false }));
  } },
  { name: 'get_indexing', area: 'content', level: 'view', write: false, schema: null, description: 'מצב האינדוקס: המתג הראשי, STAGING, כל אזור ציבורי (דלוק/כבוי וכמה עמודים), חריגים (עמודים ופרופילים ב־noindex) וגודל מפת האתר.', run: () => indexingFacts() },
  { name: 'set_indexing', area: 'content', level: 'edit', write: true, schema: z.object({ target: z.enum(['site', ...INDEX_SECTION_KEYS.map(k => `section:${k}`)] as [string, ...string[]]).describe('site למתג הראשי, או section:<key> לאזור'), value: z.boolean() }), description: 'הדלקה או כיבוי של האינדוקס לכל האתר או לאזור (home, regions, cities, categories, cityCategories, profiles, content, legal). כבוי: noindex ויציאה ממפת האתר; robots.txt והמפה מתרעננים מיד.', run: async a => result(await setIndexingAction(String(a.target), Boolean(a.value))) },
  { name: 'revalidate_pages', area: 'content', level: 'edit', write: true, schema: z.object({ paths: z.array(z.string().max(200).regex(/^\//)).min(1).max(50).describe('נתיבים ציבוריים, למשל /dan או /treatments/facials; / מרענן הכול') }), description: 'ריענון המטמון של עמודים ציבוריים אחרי שינוי, בלי לחכות למחזור הרגיל.', run: async a => {
    for (const p of a.paths as string[]) { if (p === '/') revalidatePath('/', 'layout'); else revalidatePath(p); }
    return { ok: true, revalidated: a.paths };
  } },

  // ---------- magazine: authors, taxonomy, media, articles, site data ----------
  { name: 'list_authors', area: 'magazine', level: 'view', write: false, schema: z.object({ include_inactive: z.boolean().optional() }), description: 'כותבי המגזין: מזהה, slug, שם, תפקיד וביו (כשמולאו), תמונה, קישורי sameAs, מספר המאמרים. ברירת המחדל למאמרים: קורל קרדי (koral-kardi).', run: a => listAuthorsAction({ includeInactive: Boolean(a.include_inactive) }) },
  { name: 'get_author', area: 'magazine', level: 'view', write: false, schema: z.object({ author: z.string().max(80).describe('מזהה או slug') }), description: 'כרטיס כותב אחד.', run: a => getAuthorAction(String(a.author)) },
  { name: 'upsert_author', area: 'magazine', level: 'edit', write: true, schema: AuthorInputSchema.describe('עם id מעדכן, בלי id יוצר'), description: 'יצירה או עדכון של כותב (שם, תפקיד וביו אופציונליים, תמונה מ־upload_media, קישורי sameAs, פעיל). התפקיד והביו מוצגים בעמוד רק כשהם מלאים.', run: a => upsertAuthorAction(a) },
  { name: 'list_categories', area: 'magazine', level: 'view', write: false, schema: null, description: 'קטגוריות המגזין: מזהה, slug, שם, תיאור, עמוד האב (עמוד התחום), מספר מאמרים מפורסמים וכתובת עמוד הקטגוריה (/magazine/category/{slug}).', run: () => listCategoriesAction() },
  { name: 'upsert_category', area: 'magazine', level: 'edit', write: true, schema: CategoryInputSchema, description: 'יצירה או עדכון של קטגוריה במגזין (slug, שם, תיאור, parentPagePath של עמוד התחום). בלי id ועם slug קיים מעדכן את הקיימת. מאמר חדש בקטגוריה מקבל את עמוד האב שלה כברירת מחדל.', run: a => upsertCategoryAction(a) },
  { name: 'list_tags', area: 'magazine', level: 'view', write: false, schema: null, description: 'תגיות המגזין עם מספר המאמרים המפורסמים בכל אחת.', run: () => listTagsAction() },
  { name: 'create_tag', area: 'magazine', level: 'edit', write: true, schema: z.object({ name: z.string().min(2).max(60), slug: z.string().max(60).optional() }), description: 'יצירת תגית (slug נגזר מהשם כשלא נשלח). תגית קיימת מוחזרת כפי שהיא.', run: a => createTagAction({ name: String(a.name), slug: a.slug as string | undefined }) },
  { name: 'upload_media', area: 'magazine', level: 'edit', write: true, schema: UploadSchema, description: 'העלאת תמונה למגזין מכתובת ציבורית או מ־base64: נבדקת (JPEG/PNG/WebP, עד 8MB, לפחות 200px), מומרת ל־WebP עד 1600px ונשמרת. חובה alt בעברית; אפשר title, caption ושם קובץ (אותיות לטיניות קטנות ומקפים). מחזיר מזהה, כתובת, רוחב וגובה.', run: a => uploadMediaAction(a) },
  { name: 'update_media', area: 'magazine', level: 'edit', write: true, schema: z.object({ media_id: uuid, patch: MediaMetaSchema.partial() }), description: 'עדכון alt, title, caption או שם הקובץ של תמונה שהועלתה.', run: a => updateMediaAction(String(a.media_id), a.patch) },
  { name: 'list_media', area: 'magazine', level: 'view', write: false, schema: z.object({ q: z.string().max(120).optional().describe('חיפוש ב־alt, בכותרת ובשם הקובץ'), kind: z.string().max(20).nullable().optional().describe('ברירת מחדל article; null לכל התמונות הציבוריות'), page: z.number().int().min(1).optional(), page_size: z.number().int().min(1).max(100).optional() }), description: 'תמונות המגזין שהועלו, עם כתובת, alt, מידות ומשקל.', run: a => listMediaAction({ q: a.q as string | undefined, kind: a.kind as string | null | undefined, page: a.page as number | undefined, pageSize: a.page_size as number | undefined }) },
  { name: 'list_articles', area: 'magazine', level: 'view', write: false, schema: z.object({ status: z.enum(['draft', 'scheduled', 'published', 'unpublished', 'all']).optional(), category: z.string().max(80).optional().describe('מזהה או slug'), author: z.string().max(80).optional().describe('מזהה או slug'), search: z.string().max(120).optional(), from: z.string().max(40).optional().describe('ISO; לפי updatedAt'), to: z.string().max(40).optional(), include_deleted: z.boolean().optional(), page: z.number().int().min(1).optional(), page_size: z.number().int().min(1).max(100).optional() }), description: 'רשימת המאמרים עם סינון לפי מצב, קטגוריה, כותב, טקסט וטווח תאריכים, בעימוד. כל שורה: מזהה, כותרת, slug, כתובת קנונית, מצב, תאריכים, מספר מילים, עמוד אב ומילת מפתח.', run: a => listArticlesAction({ status: a.status as 'all' | undefined, category: a.category as string | undefined, author: a.author as string | undefined, search: a.search as string | undefined, from: a.from as string | undefined, to: a.to as string | undefined, includeDeleted: Boolean(a.include_deleted), page: a.page as number | undefined, pageSize: a.page_size as number | undefined }) },
  { name: 'get_article', area: 'magazine', level: 'view', write: false, schema: z.object({ article: z.string().max(140).describe('מזהה או slug') }), description: 'המאמר המלא: כל השדות, ה־HTML המסונן, המחבר והסוקר, הקטגוריה והתגיות, התמונה הראשית, שדות ה־SEO, JSON-LD נוסף ו־updatedAt לעדכון בטוח.', run: a => getArticleAction(String(a.article)) },
  { name: 'create_article', area: 'magazine', level: 'edit', write: true, schema: ArticleCreateSchema, description: 'יצירת מאמר (טיוטה). חובה title; slug נגזר מהכותרת כשלא נשלח (עברית או לטינית קטנה עם מקפים); slug תפוס מחזיר conflict. bodyHtml מסונן לתגיות המותרות (h2,h3,p,ul,ol,li,table,thead,tbody,tr,th,td,strong,em,a,figure,img,figcaption,blockquote,br,hr); סקריפטי JSON-LD נשמרים בנפרד. מחזיר את המאמר והכתובת הקנונית.', run: a => createArticleAction(a) },
  { name: 'update_article', area: 'magazine', level: 'edit', write: true, schema: z.object({ article_id: uuid, patch: ArticlePatchSchema, expected_updated_at: z.string().max(40).optional().describe('updatedAt מ־get_article; ערך ישן מחזיר stale') }), description: 'עדכון חלקי של מאמר: רק השדות שנשלחו משתנים. expected_updated_at מגן מפני דריסה. מאמר מפורסם מתרענן באתר. מחזיר את המאמר והכתובת הקנונית.', run: a => updateArticleAction(String(a.article_id), a.patch, a.expected_updated_at as string | undefined) },
  { name: 'publish_article', area: 'magazine', level: 'edit', write: true, schema: z.object({ article_id: uuid, note: z.string().max(300).optional() }), description: 'פרסום מאמר: נבדק קודם (כותרת, גוף, מחבר, alt לתמונות, קישורים פנימיים) ונדחה עם שגיאה ברורה כשלא עובר. כשההגדרה ״פרסום דרך תור האישורים״ דלוקה, נפתחת בקשה בתור במקום פרסום. העמוד, /magazine, מפת האתר ועמוד האב מתרעננים. מחזיר את הכתובת הקנונית.', run: (a, c) => publishArticleAction(String(a.article_id), { note: a.note as string | undefined, source: c.source }) },
  { name: 'unpublish_article', area: 'magazine', level: 'edit', write: true, schema: z.object({ article_id: uuid, reason: z.string().max(300).optional() }), description: 'הורדת מאמר מהאתר (unpublished): העמוד מחזיר 404 ויוצא ממפת האתר; התוכן נשמר.', run: a => unpublishArticleAction(String(a.article_id), a.reason as string | undefined) },
  { name: 'schedule_article', area: 'magazine', level: 'edit', write: true, schema: z.object({ article_id: uuid, scheduled_for: z.string().max(40).describe('YYYY-MM-DDTHH:mm בשעון ישראל (Asia/Jerusalem), או ISO עם אזור זמן') }), description: 'תזמון פרסום לזמן עתידי בשעון ישראל. המאמר נבדק כמו בפרסום; בהגיע הזמן הוא מתפרסם ברינדור הבא של המגזין או מפת האתר.', run: a => scheduleArticleAction(String(a.article_id), String(a.scheduled_for)) },
  { name: 'delete_article', area: 'magazine', level: 'edit', write: true, schema: z.object({ article_id: uuid, reason: z.string().max(300).optional() }), description: 'מחיקה רכה: המאמר יורד מהאתר ונעלם מהרשימות (include_deleted מראה אותו), השורה נשמרת.', run: a => deleteArticleAction(String(a.article_id), a.reason as string | undefined) },
  { name: 'replace_in_article', area: 'magazine', level: 'edit', write: true, schema: z.object({ article_id: uuid, find: z.string().min(1).max(5000).describe('טקסט או HTML מדויק מתוך bodyHtml'), replace: z.string().max(20000), all: z.boolean().optional().describe('להחליף כל מופע; בלי זה טקסט שמופיע יותר מפעם אחת נדחה'), expected_updated_at: z.string().max(40).optional() }), description: 'החלפה ממוקדת בגוף המאמר (למשל הוספת קישור פנימי לפסקה קיימת). התוצאה מסוננת מחדש ונשמרת; המאמר מתרענן.', run: a => replaceInArticleAction(String(a.article_id), String(a.find), String(a.replace ?? ''), { all: Boolean(a.all), expectedUpdatedAt: a.expected_updated_at as string | undefined }) },
  { name: 'get_article_links', area: 'magazine', level: 'view', write: false, schema: z.object({ article_id: uuid }), description: 'הקישורים של מאמר: יוצאים פנימיים (עם בדיקה שהנתיב קיים) וחיצוניים, ונכנסים ממאמרים אחרים (כולל ״קריאה נוספת״).', run: a => articleLinksAction(String(a.article_id)) },
  { name: 'validate_article', area: 'magazine', level: 'view', write: false, schema: z.object({ article_id: uuid, patch: ArticlePatchSchema.optional().describe('לבדוק שינוי לפני שמירה') }), description: 'בדיקה יבשה בלי שמירה: alt חסר, H1 בגוף, קישורים פנימיים שבורים, נתיבים שלא קיימים, מחבר או תמונה ראשית חסרים, מטא ריק או ארוך, תגיות לא סגורות. מחזיר publishable ורשימת ממצאים לפי חומרה.', run: a => validateArticleAction(String(a.article_id), a.patch) },
  { name: 'get_sitemap_urls', area: 'magazine', level: 'view', write: false, schema: z.object({ type: z.enum(['home', 'treatments', 'regions', 'category', 'region', 'city', 'cityCategory', 'profile', 'content', 'legal', 'magazine', 'magazineCategory', 'article']).optional(), limit: z.number().int().min(1).max(5000).optional() }), description: 'כל הכתובות החיות במפת האתר (אותו מקור כמו /sitemap.xml) עם סוג, כותרת ו־lastmod; לסינון לפי סוג.', run: async a => {
    const all = await sitemapEntries();
    const rows = (a.type ? all.filter(e => e.type === a.type) : all).slice(0, Number(a.limit ?? 5000));
    return { total: all.length, returned: rows.length, urls: rows.map(e => ({ url: e.url, path: e.path, type: e.type, title: e.title, lastmod: e.lastModified })) };
  } },
  { name: 'get_site_settings', area: 'magazine', level: 'view', write: false, schema: null, description: 'נתוני האתר לכותבים: שם האתר, כתובת, תמונת שיתוף ברירת מחדל, @id של הארגון ב־JSON-LD, שם ולוגו המפרסם, שפה (he-IL), אזור זמן, תבנית כתובת המאמרים ומצב מתג האישורים.', run: async () => {
    const s = await platformSettings();
    return {
      siteName: SITE_NAME, siteUrl: siteUrl(), locale: 'he-IL', timezone: 'Asia/Jerusalem', dir: 'rtl',
      defaultOgImage: absoluteUrl(DEFAULT_OG_IMAGE), organizationId: ORG_ID, publisher: { name: SITE_NAME, logo: LOGO_URL, logoWidth: LOGO_SIZE.width, logoHeight: LOGO_SIZE.height },
      magazineIndex: '/magazine', articleUrlPattern: `${ARTICLE_PATH_PREFIX}{slug}`, categoryUrlPattern: '/magazine/category/{slug}', defaultAuthorSlug: 'koral-kardi', publishRequiresApproval: s.magazinePublishApproval,
      allowedBodyTags: ['h2', 'h3', 'p', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'strong', 'em', 'a', 'figure', 'img', 'figcaption', 'blockquote', 'br', 'hr', 'script[type=application/ld+json]'],
      externalLinkRel: 'nofollow noopener noreferrer',
    };
  } },

  // ---------- trust: reviews, reports, disputes, sponsored ----------
  { name: 'list_reviews', area: 'moderation', level: 'view', write: false, schema: z.object({ status: z.enum(['submitted', 'published', 'rejected', 'removed', 'all']).optional() }), description: 'ביקורות לפי מצב (ברירת מחדל: ממתינות לפרסום), עם הסניף, הדירוג, הטקסט ותשובת העסק.', run: a => listReviews((a.status as 'submitted') ?? 'submitted') },
  { name: 'moderate_review', area: 'moderation', level: 'edit', write: true, schema: z.object({ review_id: uuid, action: z.enum(['publish', 'reject', 'remove']), reason: z.string().max(500).optional().describe('חובה בדחייה ובהסרה') }), description: 'פרסום, דחייה או הסרה של ביקורת, עם סיבה. נרשם כהחלטה והפרופיל מתרענן.', run: async a => result(await moderateReviewAction({ id: String(a.review_id), action: a.action as 'publish', reason: a.reason as string | undefined })) },
  { name: 'list_reports', area: 'moderation', level: 'view', write: false, schema: z.object({ include_closed: z.boolean().optional() }), description: 'דיווחים ותיקונים שהגיעו מטופס יצירת הקשר על עסקים.', run: a => listReports(Boolean(a.include_closed)) },
  { name: 'set_report_status', area: 'moderation', level: 'edit', write: true, schema: z.object({ report_id: uuid, status: z.enum(['new', 'in_progress', 'closed']), note: z.string().max(300).optional() }), description: 'שינוי מצב דיווח: חדש, בטיפול, סגור.', run: async a => result(await setReportStatusAction({ id: String(a.report_id), status: a.status as 'new', note: a.note as string | undefined })) },
  { name: 'list_disputes', area: 'disputes', level: 'view', write: false, schema: z.object({ filter: z.enum(['open', 'all']).optional() }), description: 'מחלוקות מקדמה ושובר: טענה, עובדות המערכת, המדיניות שהוצגה, ההמלצה והמצב.', run: async a => (await import('@/app/ops/disputes/data')).listDisputes((a.filter as 'open') ?? 'open') }, // lazy: the disputes data pulls the clinic context (next/navigation)
  { name: 'open_dispute', area: 'disputes', level: 'edit', write: true, schema: z.object({ kind: z.enum(['deposit', 'gift_card']), ref: z.string().min(3).max(40).describe('מספר תור (BF-...) או קוד שובר'), claim: z.string().min(5).max(1500) }), description: 'פתיחת מחלוקת מתוך תור או שובר; העובדות נמשכות מהמערכת.', run: async a => result(await (await import('@/app/ops/disputes/actions')).openDisputeAction({ kind: a.kind as 'deposit', ref: String(a.ref), claim: String(a.claim) })) },
  { name: 'decide_dispute', area: 'disputes', level: 'edit', write: true, schema: z.object({ dispute_id: uuid, status: z.enum(['recommended_refund', 'closed_policy_upheld', 'escalated_legal']), note: z.string().max(600).optional() }), description: 'הכרעה במחלוקת: המלצה להחזר, המדיניות נאכפה, או העברה ליועמ״ש. לא מזיז כסף.', run: async a => result(await (await import('@/app/ops/disputes/actions')).decideDisputeAction({ id: String(a.dispute_id), status: a.status as 'recommended_refund', note: a.note as string | undefined })) },
  { name: 'list_campaigns', area: 'sponsored', level: 'view', write: false, schema: z.object({ filter: z.enum(['pending', 'all']).optional() }), description: 'מקומות ממומנים: ממתינים לבדיקה או הכול, עם הבדיקות האוטומטיות, הקיבולת והסכום.', run: a => listCampaigns((a.filter as 'pending') ?? 'pending') },
  { name: 'review_campaign', area: 'sponsored', level: 'edit', write: true, schema: z.object({ campaign_id: uuid, decision: z.enum(['approve', 'reject']), note: z.string().max(600).optional().describe('חובה בדחייה') }), description: 'אישור או דחייה של מקום ממומן; ממצאים חוסמים מונעים אישור.', run: async a => result(await reviewCampaignAction({ id: String(a.campaign_id), decision: a.decision as 'approve', note: a.note as string | undefined })) },
  { name: 'create_campaign', area: 'sponsored', level: 'edit', write: true, schema: z.object({ branch_id: uuid, region: z.string().max(40), category: z.string().max(60), week_start: z.string().max(10).optional().describe('YYYY-MM-DD; ברירת מחדל השבוע הבא'), weeks: z.number().int().min(1).max(12), line: z.string().min(3).max(90), featured_treatment: z.string().max(80).optional() }), description: 'הזמנת מקום ממומן בשם עסק (הזמנה ידנית), נכנסת לבדיקה.', run: async a => result(await createCampaignAction({ branchId: String(a.branch_id), region: String(a.region), category: String(a.category), weekStart: a.week_start as string | undefined, weeks: Number(a.weeks), line: String(a.line), featuredTreatment: a.featured_treatment as string | undefined })) },

  // ---------- clients and privacy ----------
  { name: 'list_clients', area: 'clients', level: 'view', write: false, schema: z.object({ filter: z.enum(['all', 'consented', 'blocked']).optional(), q: z.string().max(120).optional(), limit }), description: 'חשבונות לקוחות: שם, טלפון, דוא״ל, עיר, הזמנות, ביקור אחרון, הסכמה, חסימה. בלי פרטי בריאות.', run: a => listClients({ filter: (a.filter as 'all') ?? 'all', q: String(a.q ?? ''), take: Number(a.limit ?? 50) }) },
  { name: 'block_client', area: 'clients', level: 'edit', write: true, schema: z.object({ client_id: uuid, block: z.boolean(), reason: z.string().max(300).optional() }), description: 'חסימה או שחרור של חשבון לקוח (כניסה נדחית בזמן חסימה; הרשומות נשארות).', run: async a => result(await blockClientAction({ id: String(a.client_id), block: Boolean(a.block), reason: a.reason as string | undefined })) },
  { name: 'privacy_requests', area: 'clients', level: 'view', write: false, schema: null, description: 'בקשות פרטיות פתוחות (מחיקה, עיון, תיקון) עם תאריכי היעד.', run: () => privacyRequests() },
  { name: 'complete_privacy_request', area: 'clients', level: 'edit', write: true, schema: z.object({ kind: z.enum(['delete', 'access', 'correction']), request_id: uuid, outcome: z.enum(['done', 'rejected']), note: z.string().max(300).optional() }), description: 'סגירת בקשת פרטיות. מחיקה שבוצעה מבצעת אנונימיזציה של החשבון (שם, טלפון, דוא״ל והסכמות מוסרים; ההזמנות נשארות לקליניקות).', run: async a => result(await completePrivacyRequestAction({ kind: a.kind as 'delete', id: String(a.request_id), outcome: a.outcome as 'done', note: a.note as string | undefined })) },

  // ---------- AI queue ----------
  { name: 'approvals_queue', area: 'ai', level: 'view', write: false, schema: null, description: 'בקשות AI שמחכות לאישור אדם.', run: (a, c) => runAssistantTool('approvals_queue', a, c.proposals, c.source) },
  { name: 'propose_action', area: 'ai', level: 'edit', write: true, schema: z.object({ action: z.enum(['hide_business', 'restore_business', 'note']), business_id: uuid, reason: z.string().min(3).max(1000) }), description: 'מגיש הצעה לתור האישורים במקום לבצע ישירות (למשל כשרוצים שאדם יאשר הסתרת עסק).', run: (a, c) => runAssistantTool('propose_action', a, c.proposals, c.source) },
  { name: 'decide_ai_action', area: 'ai', level: 'edit', write: true, schema: z.object({ action_id: uuid, decision: z.enum(['approve', 'reject']), note: z.string().max(300).optional() }), description: 'אישור (ומיד ביצוע) או דחייה של בקשה בתור האישורים.', run: async (a, c) => {
    const actor = c as unknown as { actor?: { id: string; opsRole: string | null } };
    if (!actor.actor) return { error: 'no actor' };
    const r = await decideAiAction(actor.actor, String(a.action_id), a.decision as 'approve', a.note as string | undefined);
    revalidatePath('/ops/ai'); revalidatePath('/ops');
    return r;
  } },

  // ---------- platform settings ----------
  { name: 'update_platform_settings', area: 'settings', level: 'edit', write: true, schema: z.object({
    numbers: z.object(Object.fromEntries(SETTING_NUMBERS.map(k => [k, z.number().optional()]))).optional().describe('מחירים (ש״ח), מע״מ להצגה (%), ימי ניסיון חיוב, הסתרה בחוב, שנות תוקף שובר'),
    flags: z.object(Object.fromEntries(SETTING_FLAGS.map(k => [k, z.boolean().optional()]))).optional().describe('onlineBooking, giftCards, waitlist, clientAssistant, maintenanceMode'),
    maintenance_message: z.string().max(300).optional(),
    medical_disclaimer: z.string().min(20).max(800).optional().describe('הסבר ״טיפול רפואי״ שמוצג בפרופילים ליד טיפולים רפואיים ללא רופא רשום'),
    medical_stated_disclaimer: z.string().min(20).max(800).optional().describe('ההסבר כשהעסק מציין רופא בשמו או בצוות והרישיון טרם נבדק; חייב להכיל {name}'),
  }), description: 'עדכון הגדרות הפלטפורמה: מספרים (מחירים, מע״מ, מדיניות חיוב), מתגי תכונות, מצב תחזוקה והודעתו, הסבר הטיפול הרפואי. שדות שלא נשלחו נשארים.', run: async a => {
    const cur = await platformSettings();
    const out: Record<string, unknown> = {};
    const nums = a.numbers as Partial<Record<(typeof SETTING_NUMBERS)[number], number>> | undefined;
    if (nums && Object.keys(nums).length) {
      const merged = Object.fromEntries(SETTING_NUMBERS.map(k => [k, nums[k] ?? cur[k]]));
      const check = PlatformSettingsSchema.pick(Object.fromEntries(SETTING_NUMBERS.map(k => [k, true])) as Record<(typeof SETTING_NUMBERS)[number], true>).safeParse(merged);
      if (!check.success) return { ok: false, error: check.error.issues.map(i => `${String(i.path[0])}: ${i.message}`).join('; ') };
      out.numbers = await saveNumbersAction(merged);
    }
    const flags = a.flags as Partial<Record<(typeof SETTING_FLAGS)[number], boolean>> | undefined;
    if (flags) for (const [k, v] of Object.entries(flags)) if (typeof v === 'boolean') out[k] = await setFlagAction(k, v);
    if (typeof a.maintenance_message === 'string') out.maintenance_message = await saveMaintenanceMessageAction(a.maintenance_message);
    if (typeof a.medical_disclaimer === 'string') out.medical_disclaimer = await saveMedicalDisclaimerAction(a.medical_disclaimer);
    if (typeof a.medical_stated_disclaimer === 'string') out.medical_stated_disclaimer = await saveMedicalDisclaimerAction(a.medical_stated_disclaimer, 'stated');
    return { ok: true, saved: out };
  } },
];

/** Tools grouped by admin area, for the consent page and the admin tab. */
export const toolsByArea = (): Array<{ area: Area; tools: McpTool[] }> => {
  const m = new Map<Area, McpTool[]>();
  for (const t of MCP_TOOLS) m.set(t.area, [...(m.get(t.area) ?? []), t]);
  return [...m.entries()].map(([area, tools]) => ({ area, tools }));
};
