// Readiness of an import record before it becomes a listing, scored with the same template manifest
// as published listings (coverage.ts). The worker uses it to decide which sources an import run still
// needs for each record, and the review screen shows the same score staff will see after approval.

import { coverageOf, type Coverage, type CoverageInput } from './coverage';
import type { EditorialRecord } from './editorial';
import type { ImportedTreatment } from './rules';
import type { Socials } from './socials';

export interface PlaceLike {
  placeId: string;
  logoUrl: string | null;
  photoUrls: string[];
  hours: unknown;
  description: string | null;
  editorial: unknown;
  treatments: unknown;
  team: unknown;
  videos: unknown;
  faqs: unknown;
  establishedYear: number | null;
  languages: string[];
  accessible: boolean | null;
  freeParking: boolean | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  socials: unknown;
  googleRating: number | null;
  reasons: string[];
  crawl: unknown;
}

const hoursKnown = (hours: unknown) => Array.isArray(hours) && hours.length === 7 && (hours as Array<{ closed?: boolean; unknown?: boolean }>).some(d => d && !d.closed && !d.unknown);

/** Qualification reasons that need a person (the rest are handled by the publication rules). */
export const PERSON_REASONS = (reasons: string[]) => reasons.filter(r => !['medical_without_doctor_info', 'no_email'].includes(r));

export function placeCoverageInput(p: PlaceLike, opts: { mapConfigured: boolean }): CoverageInput {
  const crawl = (p.crawl ?? {}) as Record<string, unknown>;
  const ed = p.editorial && typeof (p.editorial as EditorialRecord).description === 'string' ? (p.editorial as EditorialRecord) : null;
  const treatments = (Array.isArray(p.treatments) ? p.treatments : []) as ImportedTreatment[];
  const socials = Object.values((p.socials ?? {}) as Socials);
  const videos = Array.isArray(p.videos) ? (p.videos as Array<{ status?: string }>).filter(v => v.status === 'ok') : [];
  const faqs = ed?.faqs?.length ? ed.faqs.length : Array.isArray(p.faqs) ? p.faqs.length : 0;
  return {
    coverUrl: p.photoUrls[0] ?? null,
    galleryCount: Math.max(0, p.photoUrls.length - 1),
    logoUrl: p.logoUrl,
    hoursKnown: hoursKnown(p.hours),
    description: ed?.description ?? p.description,
    editorialWords: ed?.words ?? null,
    editorialNeedsMore: ed?.needsMoreInfo ?? null,
    services: treatments.length,
    servicesPriced: treatments.filter(t => t.priceNis != null && t.priceNis > 0).length,
    teamCount: Array.isArray(p.team) ? p.team.length : 0,
    verifiedStaff: 0,
    videosPlayable: videos.length,
    faqs,
    establishedYear: p.establishedYear,
    languages: p.languages.length,
    accessible: p.accessible,
    parking: p.freeParking,
    phone: !!p.phone,
    email: !!p.email,
    website: !!p.website,
    socialsVerified: socials.filter(s => s?.verified).length,
    socialsUnverified: socials.filter(s => s && !s.verified).length,
    rating: p.googleRating != null,
    mapConfigured: opts.mapConfigured,
    placeId: !p.placeId.startsWith('dfs:'),
    conflicts: [crawl.phoneConflict === true ? 'phone' : null, crawl.hoursConflict === true ? 'hours' : null].filter((x): x is string => !!x),
    reviewReasons: PERSON_REASONS(p.reasons),
    claimed: false,
  };
}

export const placeCoverage = (p: PlaceLike, opts: { mapConfigured: boolean }): Coverage => coverageOf(placeCoverageInput(p, opts));
