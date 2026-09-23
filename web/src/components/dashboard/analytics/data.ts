import 'server-only';
import { Prisma, type LeadStage, type ProfileEventType } from '@prisma/client';
import { db } from '@/lib/server/db';
import { completionPct, profileTasks } from '../overview/tasks';

// Profile analytics from ProfileEvent / Lead / Review, scoped to the business's branches and a range.
// ProfileEvent rows exist only for visitors who accepted analytics cookies, so every number here is a floor.

export type RangeKey = 30 | 90 | 365;

export function parseRange(v: string | string[] | undefined): RangeKey {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return n === 90 || n === 365 ? n : 30;
}

const DAY_MS = 86_400_000;

export function rangeWindow(range: RangeKey, now = new Date()) {
  const end = now;
  const start = new Date(end.getTime() - range * DAY_MS);
  const prevStart = new Date(start.getTime() - range * DAY_MS);
  return { start, end, prevStart };
}

/** A click that reaches the business. Views are not contacts. */
export const CONTACT_TYPES: ProfileEventType[] = ['contact_click', 'whatsapp_click', 'call_click', 'waze_click', 'form_submit', 'booking_start'];

type Counts = Record<ProfileEventType, number>;
const zeroCounts = (): Counts => ({ view: 0, contact_click: 0, whatsapp_click: 0, call_click: 0, waze_click: 0, booking_start: 0, form_submit: 0 });

export const contactsOf = (c: Counts) => CONTACT_TYPES.reduce((a, t) => a + c[t], 0);

export async function countsByType(branchIds: string[], from: Date, to: Date): Promise<Counts> {
  const out = zeroCounts();
  if (!branchIds.length) return out;
  const rows = await db.profileEvent.groupBy({
    by: ['type'],
    where: { branchId: { in: branchIds }, createdAt: { gte: from, lt: to } },
    _count: { _all: true },
  });
  for (const r of rows) out[r.type] = r._count._all;
  return out;
}

// Raw SQL helpers. created_at is `timestamp` holding UTC; convert to Israel time for hour and weekday.
const secs = (d: Date) => d.getTime() / 1000;
const inWindow = (ids: string[], from: Date, to: Date) => Prisma.sql`
  branch_id = ANY(${ids}::uuid[])
  AND created_at >= (to_timestamp(${secs(from)}::float8) AT TIME ZONE 'UTC')
  AND created_at < (to_timestamp(${secs(to)}::float8) AT TIME ZONE 'UTC')`;
const LOCAL = Prisma.raw(`((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem')`);
const contactList = Prisma.join(CONTACT_TYPES.map(t => Prisma.sql`${t}`));

/** Equal-width buckets over the window. Index 0 is the oldest. */
export async function series(branchIds: string[], from: Date, to: Date, n: number) {
  const views = Array<number>(n).fill(0);
  const contacts = Array<number>(n).fill(0);
  if (!branchIds.length) return { views, contacts };
  const bucket = (secs(to) - secs(from)) / n;
  const rows = await db.$queryRaw<Array<{ b: number; is_view: boolean; c: number }>>`
    SELECT LEAST(FLOOR((EXTRACT(EPOCH FROM created_at) - ${secs(from)}::float8) / ${bucket}::float8), ${n - 1}::int)::int AS b,
           (type::text = 'view') AS is_view,
           COUNT(*)::int AS c
    FROM profile_events
    WHERE ${inWindow(branchIds, from, to)}
      AND (type::text = 'view' OR type::text IN (${contactList}))
    GROUP BY 1, 2`;
  for (const r of rows) {
    if (r.b < 0 || r.b >= n) continue;
    if (r.is_view) views[r.b] += r.c;
    else contacts[r.b] += r.c;
  }
  return { views, contacts };
}

/** Contact clicks by Israel-time hour, Sunday to Friday only (design: "ראשון–שישי"). */
export async function contactsByHour(branchIds: string[], from: Date, to: Date) {
  const out = new Map<number, number>();
  if (!branchIds.length) return out;
  const rows = await db.$queryRaw<Array<{ h: number; c: number }>>`
    SELECT EXTRACT(HOUR FROM ${LOCAL})::int AS h, COUNT(*)::int AS c
    FROM profile_events
    WHERE ${inWindow(branchIds, from, to)}
      AND type::text IN (${contactList})
      AND EXTRACT(DOW FROM ${LOCAL}) BETWEEN 0 AND 5
    GROUP BY 1`;
  for (const r of rows) out.set(r.h, r.c);
  return out;
}

/** Profile views by Israel-time weekday, index 0 = Sunday. */
export async function viewsByWeekday(branchIds: string[], from: Date, to: Date) {
  const out = Array<number>(7).fill(0);
  if (!branchIds.length) return out;
  const rows = await db.$queryRaw<Array<{ d: number; c: number }>>`
    SELECT EXTRACT(DOW FROM ${LOCAL})::int AS d, COUNT(*)::int AS c
    FROM profile_events
    WHERE ${inWindow(branchIds, from, to)} AND type::text = 'view'
    GROUP BY 1`;
  for (const r of rows) if (r.d >= 0 && r.d < 7) out[r.d] = r.c;
  return out;
}

/** Search queries that led to the profile: views and contacts per query. */
export async function topQueries(branchIds: string[], from: Date, to: Date, limit = 8) {
  if (!branchIds.length) return [];
  const where = { branchId: { in: branchIds }, createdAt: { gte: from, lt: to }, query: { not: null } };
  const [views, contacts] = await Promise.all([
    db.profileEvent.groupBy({ by: ['query'], where: { ...where, type: 'view' }, _count: { _all: true } }),
    db.profileEvent.groupBy({ by: ['query'], where: { ...where, type: { in: CONTACT_TYPES } }, _count: { _all: true } }),
  ]);
  const map = new Map<string, { term: string; views: number; contacts: number }>();
  const key = (q: string) => q.trim().replace(/\s+/g, ' ');
  for (const r of views) {
    const k = key(r.query ?? '');
    if (!k) continue;
    const e = map.get(k) ?? { term: k, views: 0, contacts: 0 };
    e.views += r._count._all;
    map.set(k, e);
  }
  for (const r of contacts) {
    const k = key(r.query ?? '');
    if (!k) continue;
    const e = map.get(k) ?? { term: k, views: 0, contacts: 0 };
    e.contacts += r._count._all;
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => b.views - a.views || b.contacts - a.contacts).slice(0, limit);
}

/** Views per visitor city (cities with no value are left out). */
export async function viewsByCity(branchIds: string[], from: Date, to: Date) {
  if (!branchIds.length) return [];
  const rows = await db.profileEvent.groupBy({
    by: ['city'],
    where: { branchId: { in: branchIds }, type: 'view', createdAt: { gte: from, lt: to }, city: { not: null } },
    _count: { _all: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = (r.city ?? '').trim();
    if (k) map.set(k, (map.get(k) ?? 0) + r._count._all);
  }
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

export async function viewsByDevice(branchIds: string[], from: Date, to: Date) {
  const out = { mobile: 0, desktop: 0, tablet: 0 };
  if (!branchIds.length) return out;
  const rows = await db.profileEvent.groupBy({
    by: ['device'],
    where: { branchId: { in: branchIds }, type: 'view', createdAt: { gte: from, lt: to }, device: { not: null } },
    _count: { _all: true },
  });
  for (const r of rows) if (r.device === 'mobile' || r.device === 'desktop' || r.device === 'tablet') out[r.device] += r._count._all;
  return out;
}

/** Leads the business logged in the range, by stage. Scoped by business (a lead's branch is optional). */
export async function leadStages(businessId: string, from: Date, to: Date) {
  const rows = await db.lead.groupBy({ by: ['stage'], where: { businessId, createdAt: { gte: from, lt: to } }, _count: { _all: true } });
  const by: Record<LeadStage, number> = { new: 0, contacted: 0, booked: 0, done: 0, lost: 0 };
  for (const r of rows) by[r.stage] = r._count._all;
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  // A lead that reached "done" went through booking too.
  return { total, booked: by.booked + by.done, done: by.done };
}

/** Funnel: views, contact clicks (automatic), then what the team logged in the leads board. */
export async function funnel(businessId: string, branchIds: string[], from: Date, to: Date, counts?: Counts) {
  const [c, leads] = await Promise.all([counts ? Promise.resolve(counts) : countsByType(branchIds, from, to), leadStages(businessId, from, to)]);
  return [
    { name: 'צפיות בפרופיל', value: c.view },
    { name: 'הקלקה ליצירת קשר', value: contactsOf(c) },
    { name: 'פניות שנרשמו בלוח', value: leads.total },
    { name: 'נקבע תור', value: leads.booked },
    { name: 'הגיעו לטיפול', value: leads.done },
  ];
}

/** Leads per treatment (free text on the lead) and how many were booked. */
export async function leadsByTreatment(businessId: string, from: Date, to: Date, limit = 6) {
  const rows = await db.lead.groupBy({
    by: ['treatment', 'stage'],
    where: { businessId, createdAt: { gte: from, lt: to }, treatment: { not: null } },
    _count: { _all: true },
  });
  const map = new Map<string, { name: string; leads: number; booked: number }>();
  for (const r of rows) {
    const k = (r.treatment ?? '').trim();
    if (!k) continue;
    const e = map.get(k) ?? { name: k, leads: 0, booked: 0 };
    e.leads += r._count._all;
    if (r.stage === 'booked' || r.stage === 'done') e.booked += r._count._all;
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => b.leads - a.leads).slice(0, limit);
}

/** Published BeautyFind reviews by star (all time). Google is reported separately and never merged. */
export async function ratingDistribution(branchIds: string[]) {
  const out = [5, 4, 3, 2, 1].map(n => ({ n, count: 0 }));
  if (!branchIds.length) return out;
  const rows = await db.review.groupBy({ by: ['rating'], where: { branchId: { in: branchIds }, status: 'published' }, _count: { _all: true } });
  for (const r of rows) {
    const e = out.find(x => x.n === r.rating);
    if (e) e.count += r._count._all;
  }
  return out;
}

/* ---------- Regional benchmark ---------- */

export const BENCH_MIN_PEERS = 5;

type BranchForTasks = Prisma.BranchGetPayload<{
  include: { treatments: { select: { priceAgorot: true; isPublished: true } }; categories: { include: { category: { select: { isMedical: true } } } } };
}>;

async function completionFor(branches: BranchForTasks[]) {
  if (!branches.length) return new Map<string, number>();
  const open = await db.review.groupBy({
    by: ['branchId'],
    where: { branchId: { in: branches.map(b => b.id) }, status: 'published', businessReply: null },
    _count: { _all: true },
  });
  const openBy = new Map(open.map(o => [o.branchId, o._count._all]));
  return new Map(
    branches.map(b => [
      b.id,
      completionPct(
        profileTasks({
          treatments: b.treatments,
          hours: b.hours,
          gallery: b.gallery,
          wazeUrl: b.wazeUrl,
          medicalResponsibleId: b.medicalResponsibleId,
          hasMedicalCategory: b.categories.some(c => c.category.isMedical),
          openReviews: openBy.get(b.id) ?? 0,
        }),
      ),
    ]),
  );
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type BenchRow = { key: string; name: string; you: number; med: number; higherIsBetter: boolean; unit?: string };

/**
 * The branch against the median of other live branches in the same region and first category.
 * Returns null when there are fewer than BENCH_MIN_PEERS comparable branches.
 */
export async function benchmark(branchId: string, range: RangeKey, from: Date, to: Date) {
  const me = await db.branch.findUnique({
    where: { id: branchId },
    include: {
      treatments: { select: { priceAgorot: true, isPublished: true } },
      categories: { include: { category: { select: { isMedical: true } } } },
      region: { select: { name: true } },
    },
  });
  // Same "first category" the dashboard header shows.
  const firstCat = await db.branchCategory.findFirst({ where: { branchId }, include: { category: true } });
  if (!me || !firstCat) return null;

  const stats = await db.$queryRaw<Array<{ n: number; views: number | null; reviews: number | null; reply_h: number | null; ids: string[] | null }>>`
    WITH peers AS (
      SELECT DISTINCT b.id
      FROM branches b
      JOIN branch_categories bc ON bc.branch_id = b.id
      WHERE b.status::text = 'live'
        AND b.region_slug::text = ${me.regionSlug}
        AND bc.category_slug = ${firstCat.categorySlug}
        AND b.id <> ${branchId}::uuid
    ), per AS (
      SELECT p.id,
        (SELECT COUNT(*) FROM profile_events e
          WHERE e.branch_id = p.id AND e.type::text = 'view'
            AND e.created_at >= (to_timestamp(${secs(from)}::float8) AT TIME ZONE 'UTC')
            AND e.created_at < (to_timestamp(${secs(to)}::float8) AT TIME ZONE 'UTC'))::float8 AS views,
        (SELECT COUNT(*) FROM reviews r WHERE r.branch_id = p.id AND r.status::text = 'published')::float8 AS reviews,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r.replied_at - r.created_at)) / 3600)
          FROM reviews r WHERE r.branch_id = p.id AND r.replied_at IS NOT NULL) AS reply_h
      FROM peers p
    )
    SELECT COUNT(*)::int AS n,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY views)::float8 AS views,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY reviews)::float8 AS reviews,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY reply_h)::float8 AS reply_h,
      array_agg(id::text) AS ids
    FROM per`;
  const s = stats[0];
  if (!s || s.n < BENCH_MIN_PEERS) return null;

  const peerIds = s.ids ?? [];
  const peers = await db.branch.findMany({
    where: { id: { in: peerIds } },
    include: { treatments: { select: { priceAgorot: true, isPublished: true } }, categories: { include: { category: { select: { isMedical: true } } } } },
  });
  const [peerCompletion, myCompletion, myViews, myReviews, myReply] = await Promise.all([
    completionFor(peers),
    completionFor([me]),
    db.profileEvent.count({ where: { branchId, type: 'view', createdAt: { gte: from, lt: to } } }),
    db.review.count({ where: { branchId, status: 'published' } }),
    db.$queryRaw<Array<{ h: number | null }>>`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (replied_at - created_at)) / 3600)::float8 AS h
      FROM reviews WHERE branch_id = ${branchId}::uuid AND replied_at IS NOT NULL`,
  ]);

  const perMonth = 30 / range;
  const rows: BenchRow[] = [
    { key: 'views', name: 'צפיות בחודש', you: Math.round(myViews * perMonth), med: Math.round((s.views ?? 0) * perMonth), higherIsBetter: true },
    { key: 'reviews', name: 'ביקורות מאומתות', you: myReviews, med: Math.round(s.reviews ?? 0), higherIsBetter: true },
  ];
  const myH = myReply[0]?.h;
  if (myH != null && s.reply_h != null) {
    rows.push({ key: 'reply', name: 'זמן תגובה לביקורת בשעות', you: Math.round(myH), med: Math.round(s.reply_h), higherIsBetter: false });
  }
  const medCompletion = median([...peerCompletion.values()]);
  if (medCompletion != null) {
    rows.push({ key: 'completion', name: 'שלמות פרופיל %', you: myCompletion.get(branchId) ?? 0, med: Math.round(medCompletion), higherIsBetter: true });
  }
  return { peers: s.n, categoryName: firstCat.category.name, regionName: me.region.name, rows };
}
