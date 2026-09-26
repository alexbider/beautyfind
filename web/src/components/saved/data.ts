import 'server-only';
import type { Prisma } from '@prisma/client';
import { BOOKING_LIVE } from '@/lib/features';
import { db } from '@/lib/server/db';
import { PUBLIC_WHERE, profileHref } from '@/lib/server/public';
import { currentUser } from '@/lib/server/session';
import { jerusalemNow, parseHours } from '@/components/profile/format';
import type { CompareColumn, Rating, SavedCard } from './types';

// Server-side reads for saved clinics and compare. Public branches only; sponsored campaigns are
// never read here, so a paid placement can't change what a client saves or compares.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Distinct, well-formed branch ids, capped. */
export function cleanIds(v: unknown, max = 200): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === 'string' && UUID_RE.test(x) && !out.includes(x.toLowerCase())) out.push(x.toLowerCase());
    if (out.length >= max) break;
  }
  return out;
}

/** Signed-in client, or null (guests and business accounts keep saved clinics in the browser). */
export async function clientUser() {
  const u = await currentUser();
  return u && u.kind === 'client' ? u : null;
}

const RESP_SELECT = { displayName: true, profession: true, license: { select: { kind: true, status: true } } } as const;

type Resp = { displayName: string; profession: string; license: { kind: string; status: string } | null } | null;

/** Same rule as the profile: only a verified doctor, or a verified cosmetician certificate, is shown. */
export function responsibleOf(m: Resp): { label: string; name: string; sub: string } | null {
  const lic = m?.license;
  if (!m || !lic || lic.status !== 'verified') return null;
  if (m.profession === 'doctor' && lic.kind === 'doctor') return { label: 'אחריות רפואית', name: m.displayName, sub: 'רופא/ה · רישיון מאומת' };
  if ((m.profession === 'cosmetician' || m.profession === 'technician') && lic.kind === 'cosmetician_cert')
    return { label: 'איש מקצוע אחראי', name: m.displayName, sub: 'הסמכה מקצועית אומתה' };
  return null;
}

async function reviewStats(ids: string[]): Promise<Map<string, Rating>> {
  if (!ids.length) return new Map();
  const rows = await db.review.groupBy({
    by: ['branchId'],
    where: { branchId: { in: ids }, status: 'published' },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return new Map(rows.map(r => [r.branchId, { rating: Math.round((r._avg.rating ?? 0) * 10) / 10, count: r._count._all }]));
}

const google = (b: { googleRating: number | null; googleReviewCount: number | null }): Rating | null =>
  b.googleRating != null ? { rating: b.googleRating, count: b.googleReviewCount ?? 0 } : null;

const book = (b: { slug: string; regionSlug: string; onlineBooking: boolean }) => {
  const online = BOOKING_LIVE && b.onlineBooking;
  return { online, bookHref: online ? `/book/${b.slug}` : profileHref(b), bookLabel: online ? 'קביעת תור' : 'לפרופיל' };
};

const CARD_INCLUDE = {
  categories: { include: { category: true } },
  medicalResponsible: { select: RESP_SELECT },
} satisfies Prisma.BranchInclude;

/** Public cards for the given ids, in the given order. Ids that are not public are dropped. */
export async function savedCards(ids: string[], savedAt?: Map<string, Date>): Promise<SavedCard[]> {
  if (!ids.length) return [];
  const rows = await db.branch.findMany({ where: { AND: [PUBLIC_WHERE, { id: { in: ids } }] }, include: CARD_INCLUDE });
  const stats = await reviewStats(rows.map(r => r.id));
  const byId = new Map(rows.map(r => [r.id, r]));
  return ids.flatMap(id => {
    const b = byId.get(id);
    if (!b) return [];
    const cats = [...b.categories].sort((x, y) => x.category.sortOrder - y.category.sortOrder);
    const resp = responsibleOf(b.medicalResponsible);
    const bk = book(b);
    return [
      {
        id: b.id,
        name: b.name,
        href: profileHref(b),
        bookHref: bk.bookHref,
        bookLabel: bk.bookLabel,
        online: bk.online,
        city: b.cityName,
        cats: cats.slice(0, 2).map(c => c.category.name).join(', '),
        medical: cats.some(c => c.category.isMedical),
        coverUrl: b.coverUrl,
        coverAlt: b.coverAlt ?? b.name,
        google: google(b),
        beautyfind: stats.get(b.id) ?? null,
        responsible: resp ? `${resp.label}: ${resp.name}` : null,
        savedIso: savedAt?.get(b.id)?.toISOString() ?? null,
      } satisfies SavedCard,
    ];
  });
}

/** A client's saved branch ids, newest first. */
export async function savedIdsOf(userId: string): Promise<Array<{ branchId: string; savedAt: Date }>> {
  return db.savedClinic.findMany({ where: { userId }, orderBy: { savedAt: 'desc' }, select: { branchId: true, savedAt: true } });
}

/** Saved cards of a client, newest first (non-public branches are hidden, not deleted). */
export async function savedCardsOf(userId: string): Promise<SavedCard[]> {
  const rows = await savedIdsOf(userId);
  return savedCards(rows.map(r => r.branchId), new Map(rows.map(r => [r.branchId, r.savedAt])));
}

/** Compare columns for up to three public branches, in the given order. */
export async function compareColumns(ids: string[], now = new Date()): Promise<CompareColumn[]> {
  if (!ids.length) return [];
  const rows = await db.branch.findMany({
    where: { AND: [PUBLIC_WHERE, { id: { in: ids } }] },
    include: {
      categories: { include: { category: true } },
      medicalResponsible: { select: RESP_SELECT },
      treatments: { where: { isPublished: true }, select: { categorySlug: true, priceAgorot: true } },
    },
  });
  const stats = await reviewStats(rows.map(r => r.id));
  const byId = new Map(rows.map(r => [r.id, r]));
  const today = jerusalemNow(now).day;
  return ids.flatMap(id => {
    const b = byId.get(id);
    if (!b) return [];
    const priceFrom: Record<string, number> = {};
    for (const t of b.treatments) {
      for (const k of ['all', t.categorySlug].filter((x): x is string => !!x)) {
        if (t.priceAgorot != null && (priceFrom[k] == null || t.priceAgorot < priceFrom[k])) priceFrom[k] = t.priceAgorot;
      }
    }
    const hours = parseHours(b.hours);
    const h = hours?.[today];
    const bk = book(b);
    return [
      {
        id: b.id,
        name: b.name,
        href: profileHref(b),
        bookHref: bk.bookHref,
        bookLabel: bk.bookLabel,
        online: bk.online,
        city: b.cityName,
        cats: [...b.categories].sort((x, y) => x.category.sortOrder - y.category.sortOrder).map(c => ({ slug: c.categorySlug, name: c.category.name })),
        verified: b.isClaimed,
        google: google(b),
        beautyfind: stats.get(b.id) ?? null,
        responsible: responsibleOf(b.medicalResponsible),
        hoursKnown: !!hours,
        hoursToday: h && !h.closed ? `${h.open}–${h.close}` : null,
        accessible: b.accessible,
        freeParking: b.freeParking,
        priceFrom,
      } satisfies CompareColumn,
    ];
  });
}
