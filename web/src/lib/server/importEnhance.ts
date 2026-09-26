import 'server-only';
import { Prisma, type ImportPlace } from '@prisma/client';
import { CATEGORY_IMAGE } from '@/components/home/content';
import { CATEGORIES } from '@/lib/catalog';
import { composeDescription } from '@/lib/import/completeness';
import type { ImportedTreatment } from '@/lib/import/rules';
import { serviceKey } from '@/lib/import/services';
import type { ImportSettings } from '@/lib/import/settings';
import { db } from '@/lib/server/db';
import { copyListingImages, type MediaProvenance } from '@/lib/server/importMedia';
import { mediaCandidatesOf, refreshProfileStatus } from '@/lib/server/importOps';
import { editorialText, profileFields, treatmentRows } from '@/lib/server/importPublish';

// Enhancing a published listing from its import record. Rules:
// - only live listings no owner has claimed (a claimed listing belongs to its owner);
// - only empty fields are filled, nothing is overwritten; the Google rating is refreshed (synced data);
// - services are added when missing (unpriced ones stay hidden until priced), categories are added;
// - the logo, cover and gallery are copied to our storage only where the listing has none (or only
//   our category placeholder).

/** Image candidates found on the site and the Google profile (review picker order). */
const candidatesOf = (p: ImportPlace) => {
  const crawl = (p.crawl ?? {}) as { imageCandidates?: { logos?: string[]; photos?: string[] }; editedFields?: string[] };
  const c = crawl.imageCandidates ?? {};
  const edited = new Set(crawl.editedFields ?? []);
  // A choice staff made in review is final: no fallback images on top of it.
  return { logos: edited.has('logoUrl') ? [] : c.logos ?? [], photos: edited.has('photoUrls') ? [] : c.photos ?? [] };
};

/** The profile gallery shows one large photo and four small ones: four gallery photos beside the cover. */
const GALLERY_MIN = 4;
const isPlaceholder = (url: string | null) => !url || Object.values(CATEGORY_IMAGE).includes(url);

export async function enhanceBranch(branchId: string, p: ImportPlace, s: ImportSettings, actorId: string): Promise<{ filled: string[]; skipped?: string }> {
  const b = await db.branch.findUnique({ where: { id: branchId }, include: { categories: true, treatments: { select: { name: true, priceAgorot: true, isPublished: true, id: true } } } });
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
  // Editorial draft: a complete one replaces our earlier text; a short one only fills an empty field.
  const text = editorialText(p, b);
  if (text.description && text.description !== b.description) set('description', text.description, 'description');
  else if (!b.description) {
    const d = p.description ?? composeDescription(p);
    if (d) set('description', d, 'description');
  }
  if (text.faqs) set('faqs', text.faqs, 'faqs');
  else if ((!Array.isArray(b.faqs) || !b.faqs.length) && Array.isArray(p.faqs) && p.faqs.length) set('faqs', p.faqs as Prisma.InputJsonValue, 'faqs');
  // Profile facts: only where the listing has none.
  const f = profileFields(p, { maxVideos: s.youtubeMaxVideos });
  if ((!Array.isArray(b.team) || !b.team.length) && Array.isArray(p.team) && p.team.length) set('team', f.team, 'team');
  if ((!Array.isArray(b.videos) || !b.videos.length) && Array.isArray(f.videos) && (f.videos as unknown[]).length) set('videos', f.videos, 'videos');
  if (!b.languages.length && f.languages.length) set('languages', f.languages, 'languages');
  if (!b.establishedYear && f.establishedYear) set('establishedYear', f.establishedYear, 'established');
  if (!b.facebook && f.facebook) set('facebook', f.facebook, 'facebook');
  if (!b.tiktok && f.tiktok) set('tiktok', f.tiktok, 'tiktok');
  if (!b.youtube && f.youtube) set('youtube', f.youtube, 'youtube');
  data.attributes = f.attributes;
  if (f.editorial && !(b.editorial as { ownerApproved?: boolean } | null)?.ownerApproved) data.editorial = f.editorial;
  if (!b.metaTitle && f.metaTitle) data.metaTitle = f.metaTitle;
  if (!b.metaDescription && f.metaDescription) data.metaDescription = f.metaDescription;
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
  const galleryCount = Array.isArray(b.gallery) ? b.gallery.length : 0;
  const want = { logo: !b.logoUrl, cover: isPlaceholder(b.coverUrl), gallery: galleryCount < GALLERY_MIN };
  const imagesWanted = (s.useWebsiteImages || s.useProviderImages) && (want.logo || want.cover || want.gallery) && !!(p.logoUrl || p.photoUrls.length);
  // The worker copies images only when it has access to the image store (BLOB_READ_WRITE_TOKEN).
  if (imagesWanted && process.env.STORAGE_ADAPTER === 'none') filled.push('images_waiting_for_storage');
  else if (imagesWanted) {
    const copied = await copyListingImages({ name: p.name, cityName: p.cityName, logoUrl: want.logo ? p.logoUrl : null, photoUrls: want.cover || want.gallery ? p.photoUrls : [], fallbackPhotos: want.cover || want.gallery ? candidatesOf(p).photos : [], fallbackLogos: candidatesOf(p).logos, candidates: mediaCandidatesOf(p) }, actorId, b.businessId, s.maxListingPhotos);
    const [cover, ...rest] = copied.photos;
    if (want.logo && copied.logoUrl) set('logoUrl', copied.logoUrl, 'logo');
    if (want.cover && cover) {
      set('coverUrl', cover.url, 'cover');
      data.coverAlt = cover.alt;
    }
    const gallery = want.cover ? rest : copied.photos;
    if (want.gallery && gallery.length > galleryCount) set('gallery', gallery as unknown as Prisma.InputJsonValue, 'gallery');
    if (copied.provenance.length) data.mediaProvenance = [...((Array.isArray(b.mediaProvenance) ? b.mediaProvenance : []) as unknown as MediaProvenance[]), ...copied.provenance] as unknown as Prisma.InputJsonValue;
  }

  // Categories and services.
  const have = new Set(b.categories.map(c => c.categorySlug));
  const addCats = p.categories.filter(c => CATEGORIES.some(x => x.slug === c) && !have.has(c));
  const known = new Map(b.treatments.map(t => [serviceKey(t.name), t]));
  const list = (Array.isArray(p.treatments) ? p.treatments : []) as unknown as ImportedTreatment[];
  const cats = [...have, ...addCats];
  const rows = treatmentRows(p, cats);
  const newRows = rows.filter(r => !known.has(serviceKey(r.name))).slice(0, Math.max(0, 80 - b.treatments.length));
  // A price the site now publishes fills a service we listed without one; a known price is never changed.
  // Unpriced = null, or the legacy 0-and-hidden form older imports used.
  const unpriced = (t: { priceAgorot: number | null; isPublished: boolean }) => t.priceAgorot == null || (t.priceAgorot === 0 && !t.isPublished);
  const priceFill = rows.filter(r => r.priceAgorot != null && known.get(serviceKey(r.name)) && unpriced(known.get(serviceKey(r.name))!));
  void list;

  await db.$transaction(async tx => {
    if (Object.keys(data).length) await tx.branch.update({ where: { id: b.id }, data });
    if (addCats.length) await tx.branchCategory.createMany({ data: addCats.map(c => ({ branchId: b.id, categorySlug: c })), skipDuplicates: true });
    for (const [i, r] of newRows.entries()) await tx.treatment.create({ data: { ...r, sortOrder: b.treatments.length + i, branch: { connect: { id: b.id } } } });
    for (const r of priceFill) {
      const row = known.get(serviceKey(r.name))!;
      await tx.treatment.update({ where: { id: row.id }, data: { priceAgorot: r.priceAgorot, priceMaxAgorot: r.priceMaxAgorot, priceNote: r.priceNote, priceType: r.priceType, source: r.source, sourceUrl: r.sourceUrl, sourceAt: r.sourceAt, isPublished: true } });
    }
  });
  await refreshProfileStatus(b.id, p);
  if (addCats.length) filled.push('categories');
  if (newRows.length) filled.push('services');
  if (priceFill.length) filled.push('prices');
  return { filled };
}

// ---------- copying waiting images from the website (no worker storage token needed) ----------

const placeholders = () => Object.values(CATEGORY_IMAGE);

/** Published, unclaimed listings that miss a logo, cover or gallery while their import record has images not yet tried. */
async function pendingImagePairs(limit: number) {
  return db.$queryRaw<Array<{ place_id: string; branch_id: string }>>`
    SELECT p.id AS place_id, b.id AS branch_id FROM import_places p JOIN branches b ON b.id = p.branch_id
    WHERE p.status IN ('approved', 'merged') AND b.is_claimed = false AND b.status = 'live'
      AND (p.logo_url IS NOT NULL OR cardinality(p.photo_urls) > 0)
      AND COALESCE(p.crawl->>'imageCopyVersion', '') <> '2'
      AND ((b.logo_url IS NULL AND p.logo_url IS NOT NULL) OR ((b.cover_url IS NULL OR b.cover_url = ANY(${placeholders()}) OR jsonb_array_length(b.gallery) < 4) AND cardinality(p.photo_urls) > 0))
    LIMIT ${limit}`;
}

export async function countPendingImages(): Promise<number> {
  const [r] = await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM import_places p JOIN branches b ON b.id = p.branch_id
    WHERE p.status IN ('approved', 'merged') AND b.is_claimed = false AND b.status = 'live'
      AND (p.logo_url IS NOT NULL OR cardinality(p.photo_urls) > 0)
      AND COALESCE(p.crawl->>'imageCopyVersion', '') <> '2'
      AND ((b.logo_url IS NULL AND p.logo_url IS NOT NULL) OR ((b.cover_url IS NULL OR b.cover_url = ANY(${placeholders()}) OR jsonb_array_length(b.gallery) < 4) AND cardinality(p.photo_urls) > 0))`;
  return Number(r?.n ?? 0);
}

/** Copies images for a batch of waiting listings. Each listing is tried once per version of this step (a broken image link is not retried forever). */
export async function copyPendingImages(s: ImportSettings, actorId: string, batch = 6): Promise<{ done: number; logos: number; covers: number; left: number }> {
  const pairs = await pendingImagePairs(batch);
  let logos = 0;
  let covers = 0;
  await Promise.all(
    pairs.map(async ({ place_id, branch_id }) => {
      const [p, b] = await Promise.all([db.importPlace.findUniqueOrThrow({ where: { id: place_id } }), db.branch.findUniqueOrThrow({ where: { id: branch_id } })]);
      const galleryCount = Array.isArray(b.gallery) ? b.gallery.length : 0;
      const want = { logo: !b.logoUrl, cover: isPlaceholder(b.coverUrl), gallery: galleryCount < GALLERY_MIN };
      const copied = await copyListingImages({ name: p.name, logoUrl: want.logo ? p.logoUrl : null, photoUrls: want.cover || want.gallery ? p.photoUrls : [], fallbackPhotos: want.cover || want.gallery ? candidatesOf(p).photos : [], fallbackLogos: candidatesOf(p).logos }, actorId, b.businessId, s.maxListingPhotos);
      const [cover, ...rest] = copied.photos;
      const data: Prisma.BranchUpdateInput = {};
      if (want.logo && copied.logoUrl) data.logoUrl = copied.logoUrl;
      if (want.cover && cover) {
        data.coverUrl = cover.url;
        data.coverAlt = p.name;
      }
      const gallery = want.cover ? rest : copied.photos;
      if (want.gallery && gallery.length > galleryCount) data.gallery = gallery as unknown as Prisma.InputJsonValue;
      if (Object.keys(data).length) await db.branch.update({ where: { id: b.id }, data });
      if (data.logoUrl) logos++;
      if (data.coverUrl) covers++;
      await db.importPlace.update({ where: { id: p.id }, data: { crawl: { ...((p.crawl as object) ?? {}), imageCopyVersion: '2', imageCopyTriedAt: new Date().toISOString(), imageCopy: { logo: !!data.logoUrl, cover: !!data.coverUrl, photos: copied.photos.length } } as Prisma.InputJsonValue } });
    }),
  );
  return { done: pairs.length, logos, covers, left: await countPendingImages() };
}
