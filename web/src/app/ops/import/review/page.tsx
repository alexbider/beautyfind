import type { Metadata } from 'next';
import Link from 'next/link';
import type { ImportPlaceStatus, Prisma, RegionSlug } from '@prisma/client';
import { OpsHeader } from '@/components/ops/OpsHeader';
import { OPS_ROLE_NAMES, requireImporter } from '@/components/ops/guard';
import { CATEGORIES, REGIONS } from '@/lib/catalog';
import { completeness } from '@/lib/import/completeness';
import { scoreMatch } from '@/lib/import/match';
import type { ImportedTreatment } from '@/lib/import/rules';
import { db } from '@/lib/server/db';
import { profileHref } from '@/lib/server/public';
import { googleAvailable } from '@/lib/server/googleDisplay';
import { ReviewList, type ReviewRow } from './ReviewList';
import styles from '../import.module.css';

// Approving copies each listing's chosen images, which can take a few seconds per record.
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'בדיקת עסקים מיובאים',
  robots: { index: false, follow: false },
};

const PAGE = 30;
const TABS: Array<{ key: string; name: string; statuses: ImportPlaceStatus[] }> = [
  { key: 'ready', name: 'מוכנים', statuses: ['ready'] },
  { key: 'review', name: 'לבדיקה', statuses: ['needs_review'] },
  { key: 'incomplete', name: 'חסרים', statuses: ['incomplete'] },
  { key: 'duplicate', name: 'כפולים', statuses: ['duplicate'] },
  { key: 'done', name: 'אושרו', statuses: ['approved', 'merged'] },
  { key: 'rejected', name: 'נדחו וסגורים', statuses: ['rejected', 'closed'] },
  { key: 'pending', name: 'בעיבוד', statuses: ['found', 'enriched', 'extracted'] },
];

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function ReviewPage({ searchParams }: { searchParams: SP }) {
  const user = await requireImporter('/ops/import/review');
  const sp = await searchParams;
  const tab = TABS.find(t => t.key === one(sp.tab)) ?? TABS[0];
  const run = one(sp.run);
  const region = one(sp.region);
  const cat = one(sp.cat);
  const q = one(sp.q).trim();
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const base: Prisma.ImportPlaceWhereInput = {
    ...(run ? { runId: run } : {}),
    ...(REGIONS.some(r => r.slug === region) ? { regionSlug: region as RegionSlug } : {}),
    ...(CATEGORIES.some(c => c.slug === cat) ? { categories: { has: cat } } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { address: { contains: q, mode: 'insensitive' } }, { phone: { contains: q.replace(/\D/g, '') || q } }, { email: { contains: q, mode: 'insensitive' } }] } : {}),
  };
  const where: Prisma.ImportPlaceWhereInput = { ...base, status: { in: tab.statuses } };

  const [total, rows, tabCounts, runs] = await Promise.all([
    db.importPlace.count({ where }),
    db.importPlace.findMany({ where, orderBy: [{ googleReviewCount: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }], skip: (page - 1) * PAGE, take: PAGE }),
    db.importPlace.groupBy({ by: ['status'], where: base, _count: true }),
    db.importRun.findMany({ orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, label: true } }),
  ]);

  const branchIds = [...new Set(rows.flatMap(r => [r.matchBranchId, r.branchId]).filter((x): x is string => !!x))];
  const dupIds = [...new Set(rows.map(r => r.dupOfId).filter((x): x is string => !!x))];
  const [branches, dups, observations] = await Promise.all([
    db.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true, slug: true, regionSlug: true, categories: { select: { categorySlug: true } }, cityName: true, phone: true, email: true, websiteUrl: true, lat: true, lng: true, googlePlaceId: true } }),
    db.importPlace.findMany({ where: { id: { in: dupIds } }, select: { id: true, name: true, address: true, phone: true, email: true, website: true, lat: true, lng: true, placeId: true, status: true } }),
    db.fieldObservation.findMany({
      where: { importPlaceId: { in: rows.map(r => r.id) }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      orderBy: [{ field: 'asc' }, { confidence: 'desc' }],
      select: { importPlaceId: true, field: true, value: true, provider: true, sourceUrl: true, retrievedAt: true, confidence: true, evidence: true, publishable: true, status: true },
    }),
  ]);

  const list: ReviewRow[] = rows.map(r => {
    const mb = branches.find(b => b.id === r.matchBranchId);
    const created = branches.find(b => b.id === r.branchId);
    const d = dups.find(x => x.id === r.dupOfId);
    const me = { name: r.name, lat: r.lat, lng: r.lng, phone: r.phone, email: r.email, website: r.website, googlePlaceId: r.placeId };
    const crawl = (r.crawl ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      status: r.status,
      reasons: r.reasons,
      name: r.name,
      address: r.address,
      cityName: r.cityName,
      citySlug: r.citySlug,
      regionSlug: r.regionSlug,
      phone: r.phone,
      phoneRaw: r.phoneRaw,
      whatsapp: r.whatsapp,
      email: r.email,
      emailSource: r.emailSource,
      emailMx: r.emailMx,
      emails: r.emails,
      website: r.website,
      instagram: r.instagram,
      googleRating: r.googleRating,
      ratingProvider: r.ratingProvider,
      googleReviewCount: r.googleReviewCount,
      googleMapsUri: r.googleMapsUri,
      categories: r.categories,
      businessType: r.businessType,
      description: r.description,
      treatments: (Array.isArray(r.treatments) ? r.treatments : []) as unknown as ImportedTreatment[],
      pagesRead: Array.isArray(crawl.pages) ? crawl.pages.length : 0,
      crawlSkipped: typeof crawl.site === 'string' ? crawl.site : typeof crawl.skipped === 'string' ? crawl.skipped : null,
      provider: r.provider,
      placeId: r.placeId.startsWith('dfs:') || r.placeId.includes(':') ? null : r.placeId,
      emailStatus: r.emailStatus,
      bookingUrl: r.bookingUrl,
      websiteKind: r.websiteKind,
      template: completeness(r),
      rejectedWebsite: typeof crawl.rejectedWebsite === 'string' ? crawl.rejectedWebsite : null,
      viaLinkhub: typeof crawl.viaLinkhub === 'string' ? crawl.viaLinkhub : null,
      logoUrl: r.logoUrl,
      photoUrls: r.photoUrls,
      imageCandidates: {
        logos: ((crawl.imageCandidates as { logos?: string[] } | undefined)?.logos ?? []).slice(0, 4),
        photos: ((crawl.imageCandidates as { photos?: string[] } | undefined)?.photos ?? []).slice(0, 24),
      },
      conflicts: [crawl.phoneConflict === true ? 'phone' : null, crawl.hoursConflict === true ? 'hours' : null].filter((x): x is string => !!x),
      agencyEmails: Array.isArray(crawl.agencyEmails) ? (crawl.agencyEmails as string[]) : [],
      observations: observations
        .filter(o => o.importPlaceId === r.id)
        .map(o => ({ field: o.field, value: o.value, provider: o.provider, url: o.sourceUrl, at: o.retrievedAt.toISOString(), confidence: o.confidence, evidence: o.evidence, publishable: o.publishable, status: o.status })),
      extractError: typeof crawl.extractError === 'string' ? crawl.extractError : null,
      rendered: typeof crawl.rendered === 'number' ? crawl.rendered : 0,
      facebook: r.facebook,
      note: r.note,
      match: mb ? { id: mb.id, name: mb.name, href: profileHref(mb), city: mb.cityName, score: r.matchScore ?? 0, reasons: r.matchReasons } : null,
      dup: d ? { id: d.id, name: d.name, address: d.address, status: d.status, reasons: scoreMatch(me, { ...d, googlePlaceId: d.placeId }).reasons } : null,
      created: created ? { name: created.name, href: profileHref(created) } : null,
    };
  });

  const count = (t: (typeof TABS)[number]) => t.statuses.reduce((s, st) => s + (tabCounts.find(c => c.status === st)?._count ?? 0), 0);
  const href = (patch: Record<string, string | number>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string> = { tab: tab.key, run, region, cat, q, page: String(page) };
    for (const [k, v] of Object.entries({ ...cur, ...patch })) if (v && !(k === 'page' && String(v) === '1')) p.set(k, String(v));
    return `/ops/import/review?${p}`;
  };
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const who = `${user.fullName ?? user.email ?? 'צוות BeautyFind'} · ${OPS_ROLE_NAMES[user.opsRole!]}`;

  return (
    <div dir="rtl" lang="he" className={styles.root}>
      <OpsHeader current="import" who={who} />
      <main className={styles.page}>
        <div className={styles.titleRow}>
          <h1 className={styles.h1}>בדיקת עסקים מיובאים</h1>
          <Link href="/ops/import" className={styles.btn}>לריצות</Link>
        </div>

        <nav className={styles.seg} aria-label="מצב">
          {TABS.map(t => (
            <Link key={t.key} href={href({ tab: t.key, page: 1 })} className={styles.segLink} aria-current={t.key === tab.key ? 'page' : undefined}>
              {t.name} <span className={styles.ltr}>{count(t).toLocaleString('he-IL')}</span>
            </Link>
          ))}
        </nav>

        <form className={styles.filters} method="get" action="/ops/import/review">
          <input type="hidden" name="tab" value={tab.key} />
          <label>
            <span className={styles.label}>ריצה</span>
            <select name="run" defaultValue={run} className={styles.select}>
              <option value="">כל הריצות</option>
              {runs.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <label>
            <span className={styles.label}>אזור</span>
            <select name="region" defaultValue={region} className={styles.select}>
              <option value="">כל האזורים</option>
              {REGIONS.map(r => <option key={r.slug} value={r.slug}>{r.name}</option>)}
            </select>
          </label>
          <label>
            <span className={styles.label}>תחום</span>
            <select name="cat" defaultValue={cat} className={styles.select}>
              <option value="">כל התחומים</option>
              {CATEGORIES.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
          <label>
            <span className={styles.label}>חיפוש</span>
            <input name="q" defaultValue={q} className={styles.input} placeholder="שם, כתובת, טלפון או דוא״ל" />
          </label>
          <button type="submit" className={`${styles.btn} ${styles.primary}`} style={{ flex: 'none' }}>סינון</button>
        </form>

        <ReviewList rows={list} tab={tab.key} bulk={tab.key === 'ready'} runId={run || null} readyInRun={run ? count(TABS[0]) : 0} google={googleAvailable()} />

        {pages > 1 ? (
          <div className={styles.pager}>
            {page > 1 ? <Link className={styles.btn} href={href({ page: page - 1 })}>הקודם</Link> : <span />}
            <span>עמוד {page} מתוך {pages} · {total.toLocaleString('he-IL')} רשומות</span>
            {page < pages ? <Link className={styles.btn} href={href({ page: page + 1 })}>הבא</Link> : <span />}
          </div>
        ) : null}
      </main>
    </div>
  );
}
