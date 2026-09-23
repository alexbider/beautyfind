import 'server-only';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { bookingIdFromToken } from '@/lib/server/booking';
import { db } from '@/lib/server/db';
import { saveUpload } from '@/lib/server/media';
import {
  ASPECTS,
  BODY_MAX,
  PHOTO_MAX_BYTES,
  PHOTO_SLOTS,
  PHOTO_TYPES,
  TAGS,
  TITLE_MAX,
  checkReview,
  formatAuthorName,
  type NameMode,
  type PhotoKind,
  type SubmitError,
  type SubmittedSummary,
} from '@/components/review/shared';

// Verified-visit review (01-flows.md C7, 03-states.md "Review"). The guest booking token is the
// credential; only a completed booking can be reviewed, once (Review.bookingId is unique).
// A review is created as `submitted`; moderation publishes it (target ≤6h).

export async function loadReviewBooking(token: string) {
  const id = bookingIdFromToken(token);
  if (!id) return null;
  return db.booking.findUnique({
    where: { id },
    select: {
      id: true, ref: true, status: true, startsAt: true, clientName: true, clientUserId: true, kind: true,
      treatment: { select: { name: true } },
      practitioner: { select: { displayName: true } },
      branch: { select: { id: true, name: true, cityName: true, slug: true, regionSlug: true, businessId: true, business: { select: { ownerUserId: true } } } },
      review: { select: { status: true, rating: true, title: true, nameMode: true, photos: true, photoConsent: true } },
    },
  });
}

export type ReviewBooking = NonNullable<Awaited<ReturnType<typeof loadReviewBooking>>>;

export const treatmentLabel = (b: Pick<ReviewBooking, 'treatment' | 'kind'>) => b.treatment?.name ?? (b.kind === 'consult' ? 'פגישת ייעוץ' : 'טיפול');

export function summaryOf(r: NonNullable<ReviewBooking['review']>): SubmittedSummary {
  const mode = (['full', 'initial', 'anon'].includes(r.nameMode) ? r.nameMode : 'initial') as NameMode;
  return { rating: r.rating, title: r.title, nameMode: mode, photos: Array.isArray(r.photos) ? r.photos.length : 0, photoConsent: r.photoConsent };
}

const aspectKeys = ASPECTS.map(a => a.key) as [string, ...string[]];
const star = z.number().int().min(1).max(5);

const schema = z.object({
  rating: star,
  aspects: z.partialRecord(z.enum(aspectKeys), star).default({}),
  title: z.string().max(TITLE_MAX + 40),
  body: z.string().max(BODY_MAX + 200),
  tags: z.array(z.enum(TAGS)).max(TAGS.length).default([]),
  nameMode: z.enum(['full', 'initial', 'anon']),
  photoConsent: z.boolean(),
  declarations: z.object({ real: z.boolean(), nointerest: z.boolean() }),
});

export type SubmitResult = { ok: true; summary: SubmittedSummary } | { ok: false; error: SubmitError; message?: string };

/** Validates everything server-side, stores the photos and creates the review as `submitted`. */
export async function submitReviewCore(token: string, raw: unknown, files: Partial<Record<PhotoKind, File>>): Promise<SubmitResult> {
  const b = await loadReviewBooking(token);
  if (!b) return { ok: false, error: 'not_found' };
  if (b.status !== 'completed') return { ok: false, error: 'not_completed' };
  if (b.review) return { ok: false, error: 'exists' };

  const p = schema.safeParse(raw);
  if (!p.success) return { ok: false, error: 'invalid' };
  const input = { ...p.data, title: p.data.title.trim(), body: p.data.body.trim(), tags: [...new Set(p.data.tags)] };
  const bad = checkReview(input);
  if (bad) return { ok: false, error: 'invalid', message: bad.error };
  if (input.title.length > TITLE_MAX || input.body.length > BODY_MAX) return { ok: false, error: 'invalid' };

  const photos = PHOTO_SLOTS.map(s => ({ kind: s.kind, file: files[s.kind] })).filter((x): x is { kind: PhotoKind; file: File } => !!x.file && x.file.size > 0);
  if (photos.length > 3) return { ok: false, error: 'photo_count' };
  for (const ph of photos) {
    if (!PHOTO_TYPES.includes(ph.file.type)) return { ok: false, error: 'photo_type' };
    if (ph.file.size > PHOTO_MAX_BYTES) return { ok: false, error: 'photo_size' };
  }
  const ownerId = b.clientUserId ?? b.branch.business.ownerUserId;
  if (photos.length && !ownerId) return { ok: false, error: 'server' };

  // Photos with consent are stored public (listed only once moderation publishes the review);
  // without consent they stay private: kept with the review for moderation, never published.
  const stored: { url: string; kind: PhotoKind }[] = [];
  for (const ph of photos) {
    const r = await saveUpload(ph.file, { ownerId: ownerId!, businessId: b.branch.businessId, isPrivate: !input.photoConsent, alt: `תמונת ${PHOTO_SLOTS.find(s => s.kind === ph.kind)!.label}` });
    if (!r.ok) return { ok: false, error: r.error === 'size' ? 'photo_size' : 'photo_type' };
    stored.push({ url: r.url, kind: ph.kind });
  }

  const nameMode = input.nameMode as NameMode;
  try {
    await db.review.create({
      data: {
        branchId: b.branch.id,
        bookingId: b.id,
        rating: input.rating,
        aspects: Object.keys(input.aspects).length ? (input.aspects as Prisma.InputJsonValue) : Prisma.JsonNull,
        title: input.title,
        body: input.body,
        tags: input.tags,
        photos: stored,
        photoConsent: input.photoConsent,
        nameMode,
        authorName: formatAuthorName(b.clientName, nameMode),
        treatmentName: treatmentLabel(b),
        status: 'submitted',
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: false, error: 'exists' };
    throw e;
  }
  return { ok: true, summary: { rating: input.rating, title: input.title, nameMode, photos: stored.length, photoConsent: input.photoConsent } };
}
