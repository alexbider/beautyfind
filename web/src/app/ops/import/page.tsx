import type { Metadata } from 'next';
import { AdminShell } from '@/components/ops/AdminShell';
import { requireImporter } from '@/components/ops/guard';
import { fromMicros, pricing } from '@/lib/import/pricing';
import { db } from '@/lib/server/db';
import { googleAvailable } from '@/lib/server/googleDisplay';
import { loadCoverage } from '@/lib/server/importCoverage';
import { getSettings, resetPreview } from '@/lib/server/importOps';
import { ResetImport } from './ResetImport';
import { countPendingImages } from '@/lib/server/importEnhance';
import { ImportNav } from './ImportNav';
import { RunsView, type RunRow } from './RunsView';
import styles from './import.module.css';

// Copying images for a batch of listings can take several seconds.
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'ייבוא עסקים',
  robots: { index: false, follow: false },
};

export default async function ImportPage() {
  const user = await requireImporter('/ops/import');
  const [runs, settings] = await Promise.all([db.importRun.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }), getSettings()]);
  const ids = runs.map(r => r.id);
  const [counts, spend, reconcile, siteStatus, enhanceEligible, pendingImages, reviewOpen, reset, coverage] = await Promise.all([
    db.importPlace.groupBy({ by: ['runId', 'status'], where: { runId: { in: ids } }, _count: true }),
    db.spendEntry.groupBy({ by: ['runId', 'provider', 'status'], where: { runId: { in: ids } }, _sum: { estimatedMicros: true, actualMicros: true }, _count: true }),
    db.importTask.findMany({ where: { runId: { in: ids }, status: 'needs_reconciliation' }, select: { id: true, runId: true, key: true, error: true, params: true } }),
    // Why records have no email: the website outcome per record without one.
    db.$queryRaw<Array<{ run_id: string; site: string | null; n: bigint }>>`
      SELECT run_id, crawl->>'site' AS site, count(*) AS n FROM import_places
      WHERE run_id = ANY(${ids}::uuid[]) AND email IS NULL GROUP BY run_id, crawl->>'site'`,
    db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM import_places p JOIN branches b ON b.id = p.branch_id
      WHERE p.status IN ('approved', 'merged') AND b.is_claimed = false AND b.status = 'live'`.then(r => Number(r[0]?.n ?? 0)),
    countPendingImages(),
    db.importPlace.count({ where: { status: { in: ['ready', 'needs_review'] } } }),
    resetPreview(),
    loadCoverage(),
  ]);

  const rows: RunRow[] = runs.map(r => {
    const byStatus = Object.fromEntries(counts.filter(c => c.runId === r.id).map(c => [c.status, c._count]));
    const sp = spend.filter(x => x.runId === r.id);
    const byProvider: RunRow['spend'] = {};
    for (const x of sp) {
      const cur = (byProvider[x.provider] ??= { estimatedUsd: 0, actualUsd: 0, calls: 0, uncertain: 0 });
      cur.estimatedUsd += fromMicros(x._sum.estimatedMicros ?? 0n);
      cur.actualUsd += fromMicros(x._sum.actualMicros ?? 0n);
      cur.calls += x._count;
      if (x.status === 'needs_reconciliation') cur.uncertain += x._count;
    }
    return {
      id: r.id,
      label: r.label,
      provider: r.provider,
      status: r.status,
      scope: r.scope as RunRow['scope'],
      recordLimit: r.recordLimit,
      budgetUsd: r.budgetMicros != null ? fromMicros(r.budgetMicros) : null,
      spentUsd: fromMicros(r.spentMicros),
      reservedUsd: fromMicros(r.reservedMicros),
      maxRequests: r.maxRequests,
      requestsUsed: r.requestsUsed,
      stats: (r.stats ?? {}) as RunRow['stats'],
      error: r.error,
      createdAt: r.createdAt.toISOString(),
      byStatus,
      spend: byProvider,
      noEmailBySite: Object.fromEntries(siteStatus.filter(x => x.run_id === r.id).map(x => [x.site ?? 'pending', Number(x.n)])),
      reconcile: reconcile.filter(t => t.runId === r.id).map(t => ({ id: t.id, key: t.key, error: t.error, page: (t.params as { page?: number }).page ?? 0 })),
      places: Object.values(byStatus).reduce((s, x) => s + x, 0),
    };
  });
  const p = pricing();

  return (
    <AdminShell user={user} bare>
    <div dir="rtl" lang="he" className={styles.root}>
      <main className={styles.page}>
        <div className={styles.titleRow}>
          <h1 className={styles.h1}>ייבוא עסקים</h1>
        </div>
        <ImportNav current="runs" counts={{ review: reviewOpen, enrich: enhanceEligible }} />
        <p className={styles.lead}>
          שלושה מסכים: כאן מתחילים ייבוא ועוקבים אחרי הריצות, בתור הבדיקה מאשרים רשומות, ובהשלמות ממלאים חוסרים בעסקים שכבר פורסמו. ריצת ייבוא אחת אוספת הכול מכל המקורות; שום דבר לא עולה לאתר לפני אישור, אלא אם ביקשתם פרסום אוטומטי.
          {reset.listings + reset.places + reset.runs > 0 ? <> רוצים להתחיל מאפס? <a href="#reset">איפוס הייבוא</a> בתחתית העמוד מוחק את כל מה שנוצר עד עכשיו.</> : null}
        </p>
        <RunsView
          runs={rows}
          settings={settings}
          flags={{ canDispatch: !!process.env.GITHUB_DISPATCH_TOKEN, mapKey: !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY, googleAvailable: googleAvailable() }}
          enhanceEligible={enhanceEligible}
          pendingImages={pendingImages}
          coverage={coverage}
          pricingNote={{ version: p.version, dfs: p.dataforseo.businessListingsSearch, dfsChecked: p.dataforseo.checked, dfsNote: p.dataforseo.note, googleChecked: p.google.checked, editorialUsd: p.editorial.perProfileUsd, apifyChecked: p.apify.checked }}
        />
        <div style={{ marginTop: 14 }}><ResetImport preview={reset} /></div>
      </main>
    </div>
    </AdminShell>
  );
}
