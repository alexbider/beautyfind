'use server';

import type { Prisma, PriceType, RegionSlug } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/access';
import { CATEGORIES, REGIONS, categoryBySlug } from '@/lib/catalog';
import { EMAIL_RE, toE164 } from '@/lib/format';
import { db } from '@/lib/server/db';
import { profileHref } from '@/lib/server/public';
import type { ContentForm, DetailsForm, FactsForm, MediaForm, TreatmentRow } from '../../../branchEdit';

// Staff edits of a listing, section by section. Each save validates like the owner's editor, writes
// one audit row naming the fields that changed, and refreshes the public pages. Nothing here touches
// the import record: the next AI completion only fills what is still empty, so a staff edit stands.

export type SaveResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MEDIA_URL_RE = /^\/media\/[0-9a-f-]{36}$/;
const SLUG_RE = /^[a-z0-9֐-׿]+(?:-[a-z0-9֐-׿]+)*$/;
const s = (max: number) => z.string().max(max);

async function staffFor(branchId: string) {
  const user = await areaUserOrNull('businesses', 'edit');
  if (!user) return null;
  const b = await db.branch.findUnique({ where: { id: branchId }, include: { categories: true } });
  if (!b) return null;
  return { user, b };
}

async function afterSave(actorId: string, b: { id: string; businessId: string; regionSlug: string; slug: string; categories: Array<{ categorySlug: string; isPrimary: boolean }> }, section: string, changed: string[], action = 'branch_edit') {
  await db.auditLog.create({ data: { actorId, action, subjectType: 'branch', subjectId: b.id, businessId: b.businessId, meta: { section, changed } } });
  for (const p of ['/', '/search', `/${b.regionSlug}`, profileHref(b), `/ops/businesses/${b.businessId}`, `/ops/businesses/${b.businessId}/branches/${b.id}`, '/ops/businesses']) revalidatePath(p);
}

const diff = (before: Record<string, unknown>, after: Record<string, unknown>) => Object.keys(after).filter(k => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));

// ---------- details ----------

const Details = z.object({
  name: s(120), slug: s(120), regionSlug: z.enum(REGIONS.map(r => r.slug) as [string, ...string[]]), cityName: s(80), address: s(200), lat: s(20), lng: s(20),
  phone: s(30), whatsapp: s(30), email: s(160), websiteUrl: s(500), wazeUrl: s(500), googlePlaceUrl: s(500), googlePlaceId: s(200),
  accessible: z.boolean(), freeParking: z.boolean(), onlineBooking: z.boolean(),
  status: z.enum(['draft', 'live', 'unpublished']), isClaimed: z.boolean(), noindex: z.boolean(),
  cats: z.array(z.enum(CATEGORIES.map(c => c.slug) as [string, ...string[]])).max(CATEGORIES.length), primaryCat: s(60), medicalResponsibleId: s(60),
  hours: z.array(z.object({ open: s(5), close: s(5), closed: z.boolean(), unknown: z.boolean() })).length(7),
});

export async function saveDetailsAction(branchId: string, input: DetailsForm): Promise<SaveResult> {
  const ctx = await staffFor(branchId);
  if (!ctx) return { ok: false, error: 'אין הרשאה או שהסניף לא נמצא' };
  const p = Details.safeParse(input);
  if (!p.success) return { ok: false, error: 'חלק מהשדות אינם תקינים: ' + p.error.issues.map(i => String(i.path[0])).join(', ') };
  const f = p.data;
  const fields: Record<string, string> = {};
  const name = f.name.trim();
  if (name.length < 2) fields.name = 'נדרש שם, לפחות שני תווים';
  const slug = f.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) fields.slug = 'אותיות, ספרות ומקפים בלבד';
  if (f.address.trim().length < 4) fields.address = 'נדרשת כתובת';
  if (f.cityName.trim().length < 2) fields.cityName = 'נדרשת עיר';
  const lat = f.lat.trim() ? Number(f.lat) : null;
  const lng = f.lng.trim() ? Number(f.lng) : null;
  if ((lat !== null && (Number.isNaN(lat) || lat < 29 || lat > 34)) || (lng !== null && (Number.isNaN(lng) || lng < 34 || lng > 36))) fields.lat = 'קואורדינטות בתחום ישראל (רוחב 29 עד 34, אורך 34 עד 36)';
  if ((lat === null) !== (lng === null)) fields.lat = 'נדרשות שתי הקואורדינטות או אף אחת';
  const phone = f.phone.trim() ? toE164(f.phone) : null;
  if (f.phone.trim() && !phone) fields.phone = 'מספר לא תקין';
  const whatsapp = f.whatsapp.trim() ? toE164(f.whatsapp) : null;
  if (f.whatsapp.trim() && !whatsapp) fields.whatsapp = 'מספר לא תקין';
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) fields.email = 'דוא״ל לא תקין';
  for (const k of ['websiteUrl', 'wazeUrl', 'googlePlaceUrl'] as const) if (f[k].trim() && !/^https?:\/\/\S+$/i.test(f[k].trim())) fields[k] = 'כתובת מלאה שמתחילה ב־http';
  const badHours = f.hours.some(h => !h.unknown && !h.closed && (!TIME_RE.test(h.open) || !TIME_RE.test(h.close)));
  if (badHours) fields.hours = 'שעות בפורמט 09:00 לכל יום פתוח';
  if (!f.cats.length) fields.cats = 'לפחות קטגוריה אחת';
  const primary = f.cats.includes(f.primaryCat) ? f.primaryCat : f.cats[0];
  if (f.medicalResponsibleId) {
    const st = await db.staffMember.findFirst({ where: { id: f.medicalResponsibleId, businessId: ctx.b.businessId } , select: { id: true } });
    if (!st) fields.medicalResponsibleId = 'איש הצוות אינו של העסק';
  }
  if (Object.keys(fields).length) return { ok: false, error: 'יש שדות שדורשים תיקון', fields };
  if (slug !== ctx.b.slug) {
    const taken = await db.branch.findUnique({ where: { slug }, select: { id: true } });
    if (taken) return { ok: false, error: 'הכתובת (slug) כבר תפוסה', fields: { slug: 'תפוס' } };
  }
  const city = await db.city.findFirst({ where: { name: f.cityName.trim() }, select: { id: true } });
  const hours = f.hours.map(h => (h.unknown ? { open: '', close: '', closed: false, unknown: true } : h.closed ? { open: '', close: '', closed: true } : { open: h.open, close: h.close, closed: false }));
  const data: Prisma.BranchUncheckedUpdateInput = {
    name, slug, regionSlug: f.regionSlug as RegionSlug, cityName: f.cityName.trim(), cityId: city?.id ?? null, address: f.address.trim(), lat, lng,
    phone, whatsapp, email: f.email.trim().toLowerCase() || null, websiteUrl: f.websiteUrl.trim() || null, wazeUrl: f.wazeUrl.trim() || null, googlePlaceUrl: f.googlePlaceUrl.trim() || null, googlePlaceId: f.googlePlaceId.trim() || null,
    accessible: f.accessible, freeParking: f.freeParking, onlineBooking: f.onlineBooking, status: f.status, isClaimed: f.isClaimed, noindex: f.noindex, medicalResponsibleId: f.medicalResponsibleId || null,
    hours: hours as unknown as Prisma.InputJsonValue,
  };
  const before = { ...ctx.b, cats: ctx.b.categories.map(c => c.categorySlug).sort(), primaryCat: ctx.b.categories.find(c => c.isPrimary)?.categorySlug ?? null } as unknown as Record<string, unknown>;
  const after = { ...data, cats: [...f.cats].sort(), primaryCat: primary } as unknown as Record<string, unknown>;
  const oldHref = profileHref(ctx.b);
  await db.$transaction(async tx => {
    await tx.branch.update({ where: { id: ctx.b.id }, data });
    await tx.branchCategory.deleteMany({ where: { branchId: ctx.b.id, categorySlug: { notIn: f.cats } } });
    await tx.branchCategory.createMany({ data: f.cats.map(slug => ({ branchId: ctx.b.id, categorySlug: slug, isPrimary: slug === primary })), skipDuplicates: true });
    await tx.branchCategory.updateMany({ where: { branchId: ctx.b.id }, data: { isPrimary: false } });
    await tx.branchCategory.update({ where: { branchId_categorySlug: { branchId: ctx.b.id, categorySlug: primary } }, data: { isPrimary: true } });
  });
  revalidatePath(oldHref);
  await afterSave(ctx.user.id, { ...ctx.b, slug, regionSlug: f.regionSlug as RegionSlug, categories: f.cats.map(c => ({ categorySlug: c, isPrimary: c === primary })) }, 'details', diff(before, after));
  return { ok: true };
}

// ---------- content ----------

const Content = z.object({
  description: s(6000), faqs: z.array(z.object({ q: s(300), a: s(2000) })).max(12), metaTitle: s(120), metaDescription: s(320), editorialHeading: s(40), ownerApproved: z.boolean(),
});

export async function saveContentAction(branchId: string, input: ContentForm): Promise<SaveResult> {
  const ctx = await staffFor(branchId);
  if (!ctx) return { ok: false, error: 'אין הרשאה או שהסניף לא נמצא' };
  const p = Content.safeParse(input);
  if (!p.success) return { ok: false, error: 'חלק מהשדות ארוכים מדי' };
  const f = p.data;
  const faqs = f.faqs.map(x => ({ q: x.q.trim(), a: x.a.trim() })).filter(x => x.q && x.a);
  if (faqs.length !== f.faqs.filter(x => x.q.trim() || x.a.trim()).length) return { ok: false, error: 'לכל שאלה נדרשת תשובה', fields: { faqs: 'שאלה בלי תשובה' } };
  const ed = (ctx.b.editorial ?? null) as Record<string, unknown> | null;
  const editorial = ed || f.editorialHeading.trim() || f.ownerApproved ? ({ ...(ed ?? {}), heading: f.editorialHeading.trim() || (ed?.heading as string | undefined) || 'על העסק', ownerApproved: f.ownerApproved } as Prisma.InputJsonValue) : undefined;
  const data: Prisma.BranchUpdateInput = {
    description: f.description.trim() || null, faqs: faqs as unknown as Prisma.InputJsonValue, metaTitle: f.metaTitle.trim() || null, metaDescription: f.metaDescription.trim() || null,
    ...(editorial !== undefined ? { editorial } : {}),
  };
  const before = { description: ctx.b.description, faqs: ctx.b.faqs, metaTitle: ctx.b.metaTitle, metaDescription: ctx.b.metaDescription, editorial: ctx.b.editorial };
  await db.branch.update({ where: { id: ctx.b.id }, data });
  await afterSave(ctx.user.id, ctx.b, 'content', diff(before, { ...data } as Record<string, unknown>));
  return { ok: true };
}

// ---------- media ----------

const Media = z.object({
  coverUrl: s(80), coverAlt: s(200), logoUrl: s(80),
  gallery: z.array(z.object({ url: s(80), alt: s(200), tag: s(20) })).max(24),
  videos: z.array(z.object({ id: s(20), title: s(200), status: s(20), source: s(20) })).max(12),
});

export async function saveMediaAction(branchId: string, input: MediaForm): Promise<SaveResult> {
  const ctx = await staffFor(branchId);
  if (!ctx) return { ok: false, error: 'אין הרשאה או שהסניף לא נמצא' };
  const p = Media.safeParse(input);
  if (!p.success) return { ok: false, error: 'חלק מהשדות אינם תקינים' };
  const f = p.data;
  const urls = [f.coverUrl, f.logoUrl, ...f.gallery.map(g => g.url)].filter(Boolean);
  if (urls.some(u => !MEDIA_URL_RE.test(u))) return { ok: false, error: 'תמונות חייבות להיות העלאות של המערכת (/media/...)' };
  // New images must be uploads of this business; URLs already on the listing stay valid.
  const current = new Set<string>([ctx.b.coverUrl, ctx.b.logoUrl, ...((Array.isArray(ctx.b.gallery) ? ctx.b.gallery : []) as Array<{ url?: string }>).map(g => g.url)].filter((u): u is string => !!u));
  const fresh = [...new Set(urls.filter(u => !current.has(u)))];
  if (fresh.length) {
    const owned = await db.mediaFile.count({ where: { id: { in: fresh.map(u => u.slice('/media/'.length)) }, businessId: ctx.b.businessId, isPrivate: false } });
    if (owned !== fresh.length) return { ok: false, error: 'אחת התמונות אינה שייכת לעסק. העלו אותה מחדש.' };
  }
  if (f.coverUrl && f.coverAlt.trim().length < 3) return { ok: false, error: 'נדרש תיאור נגישות לתמונת השער', fields: { coverAlt: 'קצר מדי' } };
  if (f.gallery.some(g => g.alt.trim().length < 3)) return { ok: false, error: 'לכל תמונה בגלריה נדרש תיאור', fields: { gallery: 'תיאור חסר' } };
  const ids = f.videos.map(v => v.id.trim()).filter(Boolean);
  if (ids.some(id => !/^[A-Za-z0-9_-]{11}$/.test(id))) return { ok: false, error: 'מזהה YouTube הוא 11 תווים', fields: { videos: 'מזהה לא תקין' } };
  const existing = (Array.isArray(ctx.b.videos) ? ctx.b.videos : []) as Array<Record<string, unknown>>;
  const videos = f.videos.filter(v => v.id.trim()).map(v => {
    const old = existing.find(x => x.id === v.id.trim());
    if (old) return { ...old, title: v.title.trim() || old.title || null };
    // Added by staff: not validated against the Data API here; the profile embeds it click-to-load.
    return { id: v.id.trim(), title: v.title.trim() || null, channelId: null, channelTitle: null, durationSec: null, thumbnail: `https://i.ytimg.com/vi/${v.id.trim()}/hqdefault.jpg`, source: 'owner', sourceUrl: null, validatedAt: new Date().toISOString(), validatedVia: 'oembed', embeddable: true, status: 'ok' };
  });
  const data: Prisma.BranchUpdateInput = {
    coverUrl: f.coverUrl || null, coverAlt: f.coverUrl ? f.coverAlt.trim() : null, logoUrl: f.logoUrl || null,
    gallery: f.gallery.map(g => ({ url: g.url, alt: g.alt.trim(), tag: g.tag || null })) as unknown as Prisma.InputJsonValue,
    videos: videos as unknown as Prisma.InputJsonValue,
  };
  const before = { coverUrl: ctx.b.coverUrl, coverAlt: ctx.b.coverAlt, logoUrl: ctx.b.logoUrl, gallery: ctx.b.gallery, videos: ctx.b.videos };
  await db.branch.update({ where: { id: ctx.b.id }, data });
  await afterSave(ctx.user.id, ctx.b, 'media', diff(before, { ...data } as Record<string, unknown>));
  return { ok: true };
}

// ---------- facts ----------

const Facts = z.object({
  instagram: s(60), facebook: s(300), tiktok: s(300), youtube: s(300), establishedYear: s(4), languages: s(200), teamSize: s(4),
  team: z.array(z.object({ name: s(80), role: s(80), bio: s(400), sourceUrl: s(400) })).max(30),
  accessibleKnown: z.enum(['unknown', 'yes', 'no']), parkingKnown: z.enum(['unknown', 'yes', 'no']),
});

export async function saveFactsAction(branchId: string, input: FactsForm): Promise<SaveResult> {
  const ctx = await staffFor(branchId);
  if (!ctx) return { ok: false, error: 'אין הרשאה או שהסניף לא נמצא' };
  const p = Facts.safeParse(input);
  if (!p.success) return { ok: false, error: 'חלק מהשדות ארוכים מדי' };
  const f = p.data;
  const year = f.establishedYear.trim() ? Number(f.establishedYear) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear())) return { ok: false, error: 'שנת הקמה לא סבירה', fields: { establishedYear: 'בין 1900 להיום' } };
  const teamSize = f.teamSize.trim() ? Number(f.teamSize) : null;
  if (teamSize !== null && (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > 999)) return { ok: false, error: 'גודל צוות לא סביר', fields: { teamSize: '1 עד 999' } };
  const ig = f.instagram.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '');
  if (ig && !/^[A-Za-z0-9._]{1,30}$/.test(ig)) return { ok: false, error: 'שם משתמש אינסטגרם לא תקין', fields: { instagram: 'אותיות, ספרות, נקודה וקו תחתון' } };
  for (const k of ['facebook', 'tiktok', 'youtube'] as const) if (f[k].trim() && !/^https?:\/\/\S+$/i.test(f[k].trim())) return { ok: false, error: `${k}: כתובת מלאה שמתחילה ב־http`, fields: { [k]: 'כתובת מלאה' } };
  const attrs = { ...((ctx.b.attributes ?? {}) as Record<string, unknown>) } as Record<string, { value: boolean | null; source: string; url: string | null }>;
  const triVal = (v: 'unknown' | 'yes' | 'no') => (v === 'yes' ? true : v === 'no' ? false : null);
  attrs.accessible = { value: triVal(f.accessibleKnown), source: 'staff', url: null };
  attrs.parking = { value: triVal(f.parkingKnown), source: 'staff', url: null };
  const data: Prisma.BranchUpdateInput = {
    instagram: ig || null, facebook: f.facebook.trim() || null, tiktok: f.tiktok.trim() || null, youtube: f.youtube.trim() || null,
    establishedYear: year, languages: f.languages.split(/[,،\n]/).map(x => x.trim()).filter(Boolean).slice(0, 12), teamSize,
    team: f.team.map(t => ({ name: t.name.trim(), role: t.role.trim(), bio: t.bio.trim() || null, sourceUrl: t.sourceUrl.trim() || null })).filter(t => t.name) as unknown as Prisma.InputJsonValue,
    attributes: attrs as unknown as Prisma.InputJsonValue,
    accessible: f.accessibleKnown === 'yes', freeParking: f.parkingKnown === 'yes',
  };
  const before = { instagram: ctx.b.instagram, facebook: ctx.b.facebook, tiktok: ctx.b.tiktok, youtube: ctx.b.youtube, establishedYear: ctx.b.establishedYear, languages: ctx.b.languages, teamSize: ctx.b.teamSize, team: ctx.b.team, attributes: ctx.b.attributes, accessible: ctx.b.accessible, freeParking: ctx.b.freeParking };
  await db.branch.update({ where: { id: ctx.b.id }, data });
  await afterSave(ctx.user.id, ctx.b, 'facts', diff(before, { ...data } as Record<string, unknown>));
  return { ok: true };
}

// ---------- treatments ----------

const PRICE_TYPES = ['fixed', 'from', 'per_unit', 'per_ml', 'per_area', 'range', 'package', 'free', 'on_request'] as const;
const Treatment = z.object({
  key: s(64), id: z.string().uuid().nullable(), name: s(120), description: s(1000), categorySlug: s(60), priceType: z.enum(PRICE_TYPES),
  price: s(10), priceMax: s(10), priceNote: s(80), duration: s(4), isPublished: z.boolean(), isMedical: z.boolean(), requiresDeclaration: z.boolean(), onlineBookable: z.boolean(), taxIncluded: z.enum(['unknown', 'yes', 'no']), source: s(20),
});

export async function saveTreatmentsAction(branchId: string, input: { rows: TreatmentRow[]; deleted: string[] }): Promise<SaveResult> {
  const ctx = await staffFor(branchId);
  if (!ctx) return { ok: false, error: 'אין הרשאה או שהסניף לא נמצא' };
  const p = z.object({ rows: z.array(Treatment).max(200), deleted: z.array(z.string().uuid()).max(500) }).safeParse(input);
  if (!p.success) return { ok: false, error: 'חלק מהשורות אינן תקינות' };
  const existing = await db.treatment.findMany({ where: { branchId }, select: { id: true } });
  const known = new Set(existing.map(t => t.id));
  const fields: Record<string, string> = {};
  const nis = (v: string) => (v.trim() ? Number(v.replace(/[,\s₪]/g, '')) : null);
  const rows = p.data.rows.map((r, i) => {
    const name = r.name.trim();
    if (name.length < 2) fields[r.key] = 'נדרש שם טיפול';
    if (r.id && !known.has(r.id)) fields[r.key] = 'הטיפול לא שייך לסניף הזה';
    const price = nis(r.price);
    const priceMax = nis(r.priceMax);
    const needsPrice = !['on_request', 'free'].includes(r.priceType);
    if (needsPrice && (price === null || Number.isNaN(price) || price <= 0 || price > 200_000)) fields[r.key] = 'מחיר בשקלים שלמים, גדול מאפס';
    if (r.priceType === 'range' && (priceMax === null || Number.isNaN(priceMax) || (price !== null && priceMax <= price))) fields[r.key] = 'לטווח נדרש מחיר מרבי גדול מהמחיר';
    if (!needsPrice && r.price.trim()) fields[r.key] = 'ללא מחיר: השאירו את המחיר ריק';
    const duration = r.duration.trim() ? Number(r.duration) : null;
    if (duration !== null && (!Number.isInteger(duration) || duration <= 0 || duration > 600)) fields[r.key] = 'משך בדקות, עד 600';
    const cat = r.categorySlug ? categoryBySlug(r.categorySlug) : undefined;
    if (r.categorySlug && !cat) fields[r.key] = 'קטגוריה לא מוכרת';
    const isMedical = r.isMedical || !!cat?.isMedical;
    return {
      id: r.id, data: {
        name, description: r.description.trim() || null, categorySlug: cat?.slug ?? null, priceType: r.priceType as PriceType,
        priceAgorot: needsPrice && price !== null ? Math.round(price * 100) : r.priceType === 'free' ? 0 : null,
        priceMaxAgorot: r.priceType === 'range' && priceMax !== null ? Math.round(priceMax * 100) : null,
        priceNote: r.priceNote.trim() || null, durationMin: duration, isPublished: r.isPublished, isMedical, requiresDeclaration: r.requiresDeclaration || isMedical,
        onlineBookable: isMedical ? false : r.onlineBookable, taxIncluded: r.taxIncluded === 'yes' ? true : r.taxIncluded === 'no' ? false : null,
        source: r.id ? undefined : 'owner', sortOrder: i,
      },
    };
  });
  if (p.data.deleted.some(id => !known.has(id))) return { ok: false, error: 'הרשימה השתנתה בינתיים. רעננו ונסו שוב.' };
  if (Object.keys(fields).length) return { ok: false, error: 'יש טיפולים שדורשים תיקון', fields };
  await db.$transaction(async tx => {
    if (p.data.deleted.length) await tx.treatment.deleteMany({ where: { id: { in: p.data.deleted }, branchId } });
    for (const r of rows) {
      if (r.id) await tx.treatment.update({ where: { id: r.id }, data: r.data });
      else await tx.treatment.create({ data: { ...r.data, source: 'owner', branchId } });
    }
  });
  await afterSave(ctx.user.id, ctx.b, 'treatments', [`rows:${rows.length}`, `deleted:${p.data.deleted.length}`], 'treatments_edit');
  return { ok: true };
}

// ---------- alt text by AI (admin only) ----------

export async function generateAltAction(branchId: string, input: { url: string; kind: 'cover' | 'logo' | 'gallery'; tag?: string }): Promise<{ ok: true; alt: string } | { ok: false; error: string }> {
  const ctx = await staffFor(branchId);
  if (!ctx) return { ok: false, error: 'אין הרשאה או שהסניף לא נמצא' };
  const p = z.object({ url: s(80), kind: z.enum(['cover', 'logo', 'gallery']), tag: s(20).optional() }).safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  const { describeImage } = await import('@/lib/server/altText');
  const r = await describeImage(p.data.url, ctx.b.businessId, { businessName: ctx.b.name, cityName: ctx.b.cityName, categories: ctx.b.categories.map(c => categoryBySlug(c.categorySlug)?.name ?? c.categorySlug), kind: p.data.kind, tag: p.data.tag ?? null });
  if (!r.ok) {
    const text = r.error === 'not_configured' ? 'חסר ANTHROPIC_API_KEY בסביבת האתר' : r.error === 'too_large' ? 'התמונה גדולה מ־4.5MB; העלו גרסה קטנה יותר' : r.error === 'unsupported' ? 'סוג קובץ לא נתמך לתיאור' : r.error === 'not_found' ? 'התמונה לא נמצאה או אינה של העסק' : `התיאור נכשל${r.detail ? `: ${r.detail}` : ''}`;
    return { ok: false, error: text };
  }
  await db.auditLog.create({ data: { actorId: ctx.user.id, action: 'ai_alt_generated', subjectType: 'branch', subjectId: ctx.b.id, businessId: ctx.b.businessId, meta: { url: p.data.url, kind: p.data.kind, input: r.usage.input, output: r.usage.output } } });
  return { ok: true, alt: r.alt };
}
