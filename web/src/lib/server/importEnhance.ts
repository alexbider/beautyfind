import 'server-only';
import { Prisma, type ImportPlace } from '@prisma/client';
import { CATEGORY_IMAGE } from '@/components/home/content';
import { CATEGORIES } from '@/lib/catalog';
import { composeDescription } from '@/lib/import/completeness';
import type { ImportedTreatment } from '@/lib/import/rules';
import { serviceKey } from '@/lib/import/services';
import type { ImportSettings } from '@/lib/import/settings';
import { db } from '@/lib/server/db';
import { copyListingImages } from '@/lib/server/importMedia';
import { VAT_RATE } from '@/lib/pricing';

// Enhancing a published listing from its import record. Rules:
// - only live listings no owner has claimed (a claimed listing belongs to its owner);
// - only empty fields are filled, nothing is overwritten; the Google rating is refreshed (synced data);
// - services are added when missing (unpriced ones stay hidden until priced), categories are added;
// - the logo, cover and gallery are copied to our storage only where the listing has none (or only
//   our category placeholder).

const netAgorot = (gross: number) => Math.round((gross * 100) / (1 + VAT_RATE));
const isPlaceholder = (url: string | null) => !url || Object.values(CATEGORY_IMAGE).includes(url);

export async function enhanceBranch(branchId: string, p: ImportPlace, s: ImportSettings, actorId: string): Promise<{ filled: string[]; skipped?: string }> {
  const b = await db.branch.findUnique({ where: { id: branchId }, include: { categories: true, treatments: { select: { name: true, priceAgorot: true, id: true } } } });
  if (!b) return { filled: [], skipped: 'no_branch' };
  if (b.isClaimed) return { filled: [], skipped: 'claimed' };
  if (b.status !== 'live') return { filled: [], skipped: 'not_live' };

  const filled: string[] = [];
  const data: Prisma.BranchUpdateInput = {};
  const set = <K extends keyof Prisma.BranchUpdateInput>(key: K, value: Prisma.BranchUpdateInput[K], label: string) => {
    data[key] = value;
    filled.push(label);
  };
  const emptyHours = !Array.isArray(b.hours) || !(b.hours as Array<{ closed?: boolean }>).some(d => d && !d.closed);
  if (!b.phone && p.phone) set('phone', p.phone, 'phone');
  if (!b.whatsapp && p.whatsapp) set('whatsapp', p.whatsapp, 'whatsapp');
  if (!b.email && p.email) set('email', p.email, 'email');
  if (!b.websiteUrl && p.website) set('websiteUrl', p.website, 'website');
  if (!b.instagram && p.instagram) set('instagram', p.instagram, 'instagram');
  if (emptyHours && Array.isArray(p.hours) && p.hours.length) set('hours', p.hours as Prisma.InputJsonValue, 'hours');
  if (!b.description) {
    const d = p.description ?? composeDescription(p);
    if (d) set('description', d, 'description');
  }
  if ((!Array.isArray(b.faqs) || !b.faqs.length) && Array.isArray(p.faqs) && p.faqs.length) set('faqs', p.faqs as Prisma.InputJsonValue, 'faqs');
  if (!b.accessible && p.accessible === true) set('accessible', true, 'accessible');
  if (!b.freeParking && p.freeParking === true) set('freeParking', true, 'parking');
  if (!b.wazeUrl && p.lat != null && p.lng != null) set('wazeUrl', `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`, 'waze');
  if (!b.googlePlaceUrl && p.googleMapsUri) set('googlePlaceUrl', p.googleMapsUri, 'google_profile');
  if (s.publishProviderRatings && p.ratingProvider === 'dataforseo' && p.googleRating != null && (b.googleRating !== p.googleRating || b.googleReviewCount !== p.googleReviewCount)) {
    data.googleRating = p.googleRating;
    data.googleReviewCount = p.googleReviewCount;
    data.googleSyncedAt = new Date();
    filled.push('rating');
  }

  // Images, only where missing.
  const galleryEmpty = !Array.isArray(b.gallery) || b.gallery.length === 0;
  const want = { logo: !b.logoUrl, cover: isPlaceholder(b.coverUrl), gallery: galleryEmpty };
  const imagesWanted = (s.useWebsiteImages || s.useProviderImages) && (want.logo || want.cover || want.gallery) && !!(p.logoUrl || p.photoUrls.length);
  // The worker copies images only when it has access to the image store (BLOB_READ_WRITE_TOKEN).
  if (imagesWanted && process.env.STORAGE_ADAPTER === 'none') filled.push('images_waiting_for_storage');
  else if (imagesWanted) {
    const copied = await copyListingImages({ name: p.name, logoUrl: want.logo ? p.logoUrl : null, photoUrls: want.cover || want.gallery ? p.photoUrls : [] }, actorId, b.businessId, s.maxListingPhotos);
    const [cover, ...rest] = copied.photos;
    if (want.logo && copied.logoUrl) set('logoUrl', copied.logoUrl, 'logo');
    if (want.cover && cover) {
      set('coverUrl', cover.url, 'cover');
      data.coverAlt = p.name;
    }
    const gallery = want.cover ? rest : copied.photos;
    if (want.gallery && gallery.length) set('gallery', gallery as unknown as Prisma.InputJsonValue, 'gallery');
  }

  // Categories and services.
  const have = new Set(b.categories.map(c => c.categorySlug));
  const addCats = p.categories.filter(c => CATEGORIES.some(x => x.slug === c) && !have.has(c));
  const known = new Map(b.treatments.map(t => [serviceKey(t.name), t]));
  const list = (Array.isArray(p.treatments) ? p.treatments : []) as unknown as ImportedTreatment[];
  const cats = new Set([...have, ...addCats]);
  const newTreatments = list.filter(t => !known.has(serviceKey(t.name))).slice(0, Math.max(0, 80 - b.treatments.length));
  const priceFill = list.filter(t => t.priceNis != null && known.get(serviceKey(t.name))?.priceAgorot === 0);

  await db.$transaction(async tx => {
    if (Object.keys(data).length) await tx.branch.update({ where: { id: b.id }, data });
    if (addCats.length) await tx.branchCategory.createMany({ data: addCats.map(c => ({ branchId: b.id, categorySlug: c })), skipDuplicates: true });
    for (const [i, t] of newTreatments.entries())
      await tx.treatment.create({
        data: {
          branch: { connect: { id: b.id } },
          name: t.name.slice(0, 120),
          category: t.category && cats.has(t.category) ? { connect: { slug: t.category } } : undefined,
          priceType: t.priceType,
          priceAgorot: t.priceNis ? netAgorot(t.priceNis) : 0,
          durationMin: t.durationMin ?? null,
          isMedical: t.isMedical,
          requiresDeclaration: t.isMedical,
          onlineBookable: !t.isMedical,
          isPublished: !!t.priceNis,
          sortOrder: b.treatments.length + i,
        },
      });
    for (const t of priceFill) {
      const row = known.get(serviceKey(t.name))!;
      await tx.treatment.update({ where: { id: row.id }, data: { priceAgorot: netAgorot(t.priceNis!), priceType: t.priceType, isPublished: true } });
    }
  });
  if (addCats.length) filled.push('categories');
  if (newTreatments.length) filled.push('services');
  if (priceFill.length) filled.push('prices');
  return { filled };
}
