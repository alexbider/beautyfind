import 'server-only';
import type { PriceType } from '@prisma/client';
import { fromE164 } from '@/lib/format';
import { db } from '@/lib/server/db';
import { listGaps, type GapRow } from '@/lib/server/enhanceRuns';
import { profileHref } from '@/lib/server/public';

// What the admin branch editor loads: every field of the listing in form shape, the business's staff
// (for the medical responsible), the treatments with every column, and the listing's gaps.

export interface HoursRow { open: string; close: string; closed: boolean; unknown: boolean }
export interface DetailsForm {
  name: string; slug: string; regionSlug: string; cityName: string; address: string; lat: string; lng: string;
  phone: string; whatsapp: string; email: string; websiteUrl: string; wazeUrl: string; googlePlaceUrl: string; googlePlaceId: string;
  accessible: boolean; freeParking: boolean; onlineBooking: boolean;
  status: 'draft' | 'live' | 'unpublished'; isClaimed: boolean;
  cats: string[]; primaryCat: string; medicalResponsibleId: string;
  hours: HoursRow[];
}
export interface ContentForm {
  description: string; faqs: Array<{ q: string; a: string }>; metaTitle: string; metaDescription: string;
  editorialHeading: string; ownerApproved: boolean;
}
export interface MediaForm {
  coverUrl: string; coverAlt: string; logoUrl: string; gallery: Array<{ url: string; alt: string; tag: string }>;
  videos: Array<{ id: string; title: string; status: string; source: string }>;
}
export interface FactsForm {
  instagram: string; facebook: string; tiktok: string; youtube: string; establishedYear: string; languages: string; teamSize: string;
  team: Array<{ name: string; role: string; bio: string; sourceUrl: string }>;
  accessibleKnown: 'unknown' | 'yes' | 'no'; parkingKnown: 'unknown' | 'yes' | 'no';
}
export interface TreatmentRow {
  key: string; id: string | null; name: string; description: string; categorySlug: string; priceType: PriceType;
  price: string; priceMax: string; priceNote: string; duration: string; isPublished: boolean; isMedical: boolean; requiresDeclaration: boolean; onlineBookable: boolean; taxIncluded: 'unknown' | 'yes' | 'no'; source: string;
}
export interface BranchEdit {
  id: string;
  businessId: string;
  businessName: string;
  publicHref: string | null;
  details: DetailsForm;
  content: ContentForm;
  media: MediaForm;
  facts: FactsForm;
  treatments: TreatmentRow[];
  staff: Array<{ id: string; name: string; profession: string; verified: boolean }>;
  editorialInfo: { words: number; model: string; generatedAt: string } | null;
  gap: GapRow | null;
  updatedAt: Date;
}

export const DEFAULT_HOURS: HoursRow[] = Array.from({ length: 7 }, () => ({ open: '', close: '', closed: false, unknown: true }));

export function readHours(raw: unknown): HoursRow[] {
  if (!Array.isArray(raw) || raw.length !== 7) return DEFAULT_HOURS.map(h => ({ ...h }));
  return raw.map(h => {
    const o = (h && typeof h === 'object' ? h : {}) as Record<string, unknown>;
    if (o.unknown === true) return { open: '', close: '', closed: false, unknown: true };
    return { open: typeof o.open === 'string' ? o.open : '', close: typeof o.close === 'string' ? o.close : '', closed: o.closed === true, unknown: false };
  });
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const tri = (v: unknown): 'unknown' | 'yes' | 'no' => (v === true ? 'yes' : v === false ? 'no' : 'unknown');

export async function loadBranchEdit(branchId: string): Promise<BranchEdit | null> {
  const b = await db.branch.findUnique({ where: { id: branchId }, include: { categories: true, treatments: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }, business: { select: { id: true, legalName: true, staff: { where: { status: { not: 'removed' } }, select: { id: true, displayName: true, profession: true, license: { select: { status: true } } } } } } } });
  if (!b) return null;
  const ed = (b.editorial ?? null) as { heading?: string; ownerApproved?: boolean; words?: number; model?: string; generatedAt?: string } | null;
  const attrs = (b.attributes ?? {}) as { accessible?: { value?: boolean | null }; parking?: { value?: boolean | null } };
  const gaps = await listGaps({ branchIds: [b.id], live: 'all', claimed: 'all' });
  const primary = b.categories.find(c => c.isPrimary) ?? b.categories[0];
  return {
    id: b.id,
    businessId: b.businessId,
    businessName: b.business.legalName ?? b.name,
    publicHref: b.status === 'live' ? profileHref(b) : null,
    details: {
      name: b.name, slug: b.slug, regionSlug: b.regionSlug, cityName: b.cityName, address: b.address, lat: b.lat == null ? '' : String(b.lat), lng: b.lng == null ? '' : String(b.lng),
      phone: b.phone ? fromE164(b.phone) : '', whatsapp: b.whatsapp ? fromE164(b.whatsapp) : '', email: b.email ?? '', websiteUrl: b.websiteUrl ?? '', wazeUrl: b.wazeUrl ?? '', googlePlaceUrl: b.googlePlaceUrl ?? '', googlePlaceId: b.googlePlaceId ?? '',
      accessible: b.accessible, freeParking: b.freeParking, onlineBooking: b.onlineBooking, status: b.status, isClaimed: b.isClaimed,
      cats: b.categories.map(c => c.categorySlug), primaryCat: primary?.categorySlug ?? '', medicalResponsibleId: b.medicalResponsibleId ?? '',
      hours: readHours(b.hours),
    },
    content: {
      description: b.description ?? '',
      faqs: arr(b.faqs).map(f => ({ q: str((f as { q?: unknown })?.q), a: str((f as { a?: unknown })?.a) })).filter(f => f.q || f.a),
      metaTitle: b.metaTitle ?? '', metaDescription: b.metaDescription ?? '',
      editorialHeading: ed?.heading ?? '', ownerApproved: ed?.ownerApproved === true,
    },
    media: {
      coverUrl: b.coverUrl ?? '', coverAlt: b.coverAlt ?? '', logoUrl: b.logoUrl ?? '',
      gallery: arr(b.gallery).map(g => ({ url: str((g as { url?: unknown })?.url), alt: str((g as { alt?: unknown })?.alt), tag: str((g as { tag?: unknown })?.tag) })).filter(g => g.url),
      videos: arr(b.videos).map(v => ({ id: str((v as { id?: unknown })?.id), title: str((v as { title?: unknown })?.title), status: str((v as { status?: unknown })?.status) || 'unknown', source: str((v as { source?: unknown })?.source) })).filter(v => v.id),
    },
    facts: {
      instagram: b.instagram ?? '', facebook: b.facebook ?? '', tiktok: b.tiktok ?? '', youtube: b.youtube ?? '',
      establishedYear: b.establishedYear ? String(b.establishedYear) : '', languages: b.languages.join(', '), teamSize: b.teamSize ? String(b.teamSize) : '',
      team: arr(b.team).map(t => ({ name: str((t as { name?: unknown })?.name), role: str((t as { role?: unknown })?.role), bio: str((t as { bio?: unknown })?.bio), sourceUrl: str((t as { sourceUrl?: unknown })?.sourceUrl) })).filter(t => t.name),
      accessibleKnown: tri(attrs.accessible?.value ?? (b.accessible ? true : null)), parkingKnown: tri(attrs.parking?.value ?? (b.freeParking ? true : null)),
    },
    treatments: b.treatments.map(t => ({
      key: t.id, id: t.id, name: t.name, description: t.description ?? '', categorySlug: t.categorySlug ?? '', priceType: t.priceType,
      price: t.priceAgorot == null ? '' : String(Math.round(t.priceAgorot / 100)), priceMax: t.priceMaxAgorot == null ? '' : String(Math.round(t.priceMaxAgorot / 100)), priceNote: t.priceNote ?? '',
      duration: t.durationMin ? String(t.durationMin) : '', isPublished: t.isPublished, isMedical: t.isMedical, requiresDeclaration: t.requiresDeclaration, onlineBookable: t.onlineBookable, taxIncluded: tri(t.taxIncluded), source: t.source ?? '',
    })),
    staff: b.business.staff.map(s => ({ id: s.id, name: s.displayName, profession: s.profession, verified: s.license?.status === 'verified' })),
    editorialInfo: ed?.words && ed.model && ed.generatedAt ? { words: ed.words, model: ed.model, generatedAt: ed.generatedAt } : null,
    gap: gaps.rows[0] ?? null,
    updatedAt: b.updatedAt,
  };
}
