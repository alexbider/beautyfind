import 'server-only';
import type { Branch, ImportPlace, Prisma } from '@prisma/client';
import { CATEGORIES } from '@/lib/catalog';
import { coverageOf, type Coverage } from '@/lib/import/coverage';
import { FAQ_MIN, WORDS_MIN, publishBlockers, textRuleViolations, type EditorialRecord } from '@/lib/import/editorial';
import { normalizeHebrew } from '@/lib/import/textRules';
import type { ImportedTreatment } from '@/lib/import/rules';
import { chooseVideos, type VideoRecord } from '@/lib/import/youtube';
import type { MediaProvenance } from '@/lib/server/importMedia';
import { listingTitle } from '@/lib/seo/listingTitle';
import { CATEGORY_SHORT } from '@/lib/seo/terms';

// What an import record contributes to a listing, shared by approve, merge and enhance:
// services with their real price states, the profile facts with evidence, the editorial draft, and the
// readiness classification written back to the listing. Owner-approved text is never replaced.

export const editorialOf = (p: { editorial: unknown }) => (p.editorial && typeof p.editorial === 'object' && typeof (p.editorial as EditorialRecord).description === 'string' ? (p.editorial as EditorialRecord) : null);
/** A draft that may replace existing text: written by the model (never the template fallback), long enough, not flagged, enough FAQs, and clean under the text rules. */
export const editorialComplete = (e: EditorialRecord | null) => !!e && e.model !== 'template' && e.words >= WORDS_MIN && !e.needsMoreInfo && e.faqs.length >= FAQ_MIN && publishBlockers(e.violations ?? []).length === 0;
/** A draft that breaks the text rules is never published, not even into an empty field. */
export const editorialClean = (e: EditorialRecord | null) => !!e && textRuleViolations(e.violations ?? []).length === 0;

/** Treatment rows from an import record. Prices are stored as published (tax status unknown), never converted. */
export function treatmentRows(p: ImportPlace, cats: string[]): Prisma.TreatmentCreateWithoutBranchInput[] {
  const list = (Array.isArray(p.treatments) ? p.treatments : []) as unknown as ImportedTreatment[];
  const summaries = new Map((editorialOf(p)?.serviceSummaries ?? []).map(s => [s.name.trim().toLowerCase(), s.summary]));
  return list.slice(0, 80).map((t, i) => {
    const known = t.priceNis != null && t.priceNis > 0;
    const free = t.priceType === 'free';
    return {
      name: normalizeHebrew(t.name.slice(0, 120)),
      description: normalizeHebrew(summaries.get(t.name.trim().toLowerCase())?.slice(0, 400) ?? t.description?.slice(0, 400) ?? ''),
      category: t.category && cats.includes(t.category) ? { connect: { slug: t.category } } : undefined,
      priceType: known ? t.priceType : free ? 'free' : 'on_request',
      priceAgorot: known ? Math.round(t.priceNis! * 100) : free ? 0 : null,
      priceMaxAgorot: known && t.priceType === 'range' && t.priceMaxNis ? Math.round(t.priceMaxNis * 100) : null,
      priceNote: t.priceNote?.slice(0, 60) ?? null,
      taxIncluded: null,
      source: t.source ?? 'website',
      sourceUrl: t.sourceUrl ?? null,
      sourceAt: t.sourceAt ? new Date(t.sourceAt) : null,
      durationMin: t.durationMin ?? null,
      isMedical: t.isMedical,
      requiresDeclaration: t.isMedical,
      onlineBookable: !t.isMedical,
      // Unpriced services are shown with "המחיר לא פורסם" and a quote action (feature request §7).
      isPublished: true,
      sortOrder: i,
    };
  });
}

interface Sourced<T> {
  value: T;
  source: string; // dataforseo | website | owner
  url?: string | null;
}
export interface ProfileAttributes {
  accessible?: Sourced<boolean | null>;
  parking?: Sourced<boolean | null>;
  languages?: Sourced<string[]>;
  established?: Sourced<number>;
  teamSize?: Sourced<number>;
}

/** Profile facts of an import record as listing columns. Tri-state attributes keep their source. */
export interface ProfileFieldValues {
  team: Prisma.InputJsonValue;
  videos: Prisma.InputJsonValue;
  languages: string[];
  establishedYear: number | null;
  facebook: string | null;
  tiktok: string | null;
  youtube: string | null;
  attributes: Prisma.InputJsonValue;
  editorial?: Prisma.InputJsonValue;
  metaTitle?: string;
  metaDescription?: string;
}

export function profileFields(p: ImportPlace, opts: { maxVideos: number }): ProfileFieldValues {
  const crawl = (p.crawl ?? {}) as Record<string, unknown>;
  const site = (crawl.site as string | undefined) === 'ok' || (crawl.site as string | undefined) === 'no_email';
  const attrSource = site && (p.accessible != null || p.freeParking != null) ? 'website_or_provider' : 'dataforseo';
  const attributes: ProfileAttributes = {
    accessible: { value: p.accessible, source: attrSource },
    parking: { value: p.freeParking, source: attrSource },
    ...(p.languages.length ? { languages: { value: p.languages, source: 'website' } } : {}),
    ...(p.establishedYear ? { established: { value: p.establishedYear, source: 'website' } } : {}),
  };
  const videos = chooseVideos((Array.isArray(p.videos) ? (p.videos as unknown as VideoRecord[]) : []), opts.maxVideos);
  const ed = editorialOf(p);
  return {
    team: [] as unknown as Prisma.InputJsonValue, // the team section is the owner's: nothing scraped from a website is published
    videos: videos as unknown as Prisma.InputJsonValue,
    languages: p.languages,
    establishedYear: p.establishedYear,
    facebook: p.facebook,
    tiktok: p.tiktok,
    youtube: p.youtube,
    attributes: attributes as unknown as Prisma.InputJsonValue,
    // The page title follows one shape for every listing (name, city, main category, then prices and
    // reviews) so it wins searches for the business itself; the writer's title stays in the draft only.
    metaTitle: listingTitle({ name: p.name, city: p.cityName, category: p.categories[0] ? CATEGORY_SHORT[p.categories[0]] ?? CATEGORIES.find(c => c.slug === p.categories[0])?.name ?? null : null }),
    ...(ed ? { editorial: { ...ed, ownerApproved: false, appliedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue, metaDescription: normalizeHebrew(ed.metaDescription).slice(0, 170) } : {}),
  };
}

/**
 * Which description and FAQs a listing gets. Owner text (claimed, or marked ownerApproved) is never
 * replaced. Otherwise the complete editorial draft wins; a short draft only fills an empty field and
 * never replaces existing text ("existing live content must not be replaced by an inferior draft").
 */
export function editorialText(p: ImportPlace, current: { description: string | null; faqs: unknown; isClaimed: boolean; editorial?: unknown } | null): { description?: string; faqs?: Prisma.InputJsonValue; heading?: string } {
  const ed = editorialOf(p);
  const ownerApproved = current?.isClaimed || (current?.editorial as { ownerApproved?: boolean } | undefined)?.ownerApproved === true;
  if (!ed || ownerApproved || !editorialClean(ed)) return {};
  const curFaqs = Array.isArray(current?.faqs) ? (current!.faqs as unknown[]).length : 0;
  const complete = editorialComplete(ed);
  const out: { description?: string; faqs?: Prisma.InputJsonValue; heading?: string } = {};
  // Hebrew typography is fixed on the way in (gershayim, geresh), whatever the draft's age.
  if (complete || !current?.description) out.description = normalizeHebrew(ed.description);
  if (ed.faqs.length >= FAQ_MIN && (complete || curFaqs < FAQ_MIN)) out.faqs = ed.faqs.map(f => ({ q: normalizeHebrew(f.q), a: normalizeHebrew(f.a) })) as Prisma.InputJsonValue;
  out.heading = ed.heading;
  return out;
}

const hoursKnown = (hours: unknown) => Array.isArray(hours) && hours.length === 7 && (hours as Array<{ closed?: boolean; unknown?: boolean }>).some(d => d && !d.closed && !d.unknown);

/** Readiness of a listing after the import data was applied. */
export function branchCoverage(b: Branch & { categories?: Array<{ categorySlug: string }>; treatments: Array<{ priceAgorot: number | null }> }, extra: { verifiedStaff: number; conflicts: string[]; reviewReasons: string[]; socials?: { verified: number; unverified: number } }): Coverage {
  const ed = b.editorial as (EditorialRecord & { ownerApproved?: boolean }) | null;
  const videos = Array.isArray(b.videos) ? (b.videos as unknown as VideoRecord[]).filter(v => v.status === 'ok') : [];
  const team = Array.isArray(b.team) ? b.team.length : 0;
  const attrs = (b.attributes ?? {}) as ProfileAttributes;
  return coverageOf({
    coverUrl: b.coverUrl && !Object.values(CATEGORY_PLACEHOLDER_URLS).includes(b.coverUrl) ? b.coverUrl : null,
    galleryCount: Array.isArray(b.gallery) ? b.gallery.length : 0,
    logoUrl: b.logoUrl,
    hoursKnown: hoursKnown(b.hours),
    description: b.description,
    editorialWords: ed?.words ?? null,
    editorialNeedsMore: ed?.needsMoreInfo ?? null,
    services: b.treatments.length,
    servicesPriced: b.treatments.filter(t => t.priceAgorot != null && t.priceAgorot > 0).length,
    teamCount: team,
    verifiedStaff: extra.verifiedStaff,
    videosPlayable: videos.length,
    faqs: Array.isArray(b.faqs) ? b.faqs.length : 0,
    establishedYear: b.establishedYear,
    languages: b.languages.length,
    accessible: attrs.accessible?.value ?? (b.accessible ? true : null),
    parking: attrs.parking?.value ?? (b.freeParking ? true : null),
    phone: !!b.phone,
    email: !!b.email,
    website: !!b.websiteUrl,
    socialsVerified: extra.socials?.verified ?? [b.instagram, b.facebook, b.tiktok, b.youtube].filter(Boolean).length,
    socialsUnverified: extra.socials?.unverified ?? 0,
    rating: b.googleRating != null,
    mapConfigured: !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY,
    placeId: !!b.googlePlaceId,
    conflicts: extra.conflicts,
    reviewReasons: extra.reviewReasons,
    claimed: b.isClaimed,
  });
}

// The category placeholder images (src/components/home/content) are not real photos of the business.
import { CATEGORY_IMAGE } from '@/components/home/content';
const CATEGORY_PLACEHOLDER_URLS = CATEGORY_IMAGE;

/** Social accounts kept for review with their verification state, from the import record. */
export function socialCounts(p: ImportPlace): { verified: number; unverified: number } {
  const s = (p.socials ?? {}) as Record<string, { verified?: boolean }>;
  const list = Object.values(s);
  return { verified: list.filter(x => x?.verified).length, unverified: list.filter(x => x && !x.verified).length };
}

export type { MediaProvenance };
export { CATEGORIES };
