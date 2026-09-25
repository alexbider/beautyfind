import type { Metadata } from 'next';
import Link from 'next/link';
import { OpsHeader } from '@/components/ops/OpsHeader';
import { OPS_ROLE_NAMES, requireImporter } from '@/components/ops/guard';
import { fromMicros, pricing } from '@/lib/import/pricing';
import { db } from '@/lib/server/db';
import { googleAvailable } from '@/lib/server/googleDisplay';
import { getSettings } from '@/lib/server/importOps';
import { RunsView, type RunRow } from './RunsView';
import styles from './import.module.css';

export const metadata: Metadata = {
  title: 'ייבוא עסקים',
  robots: { index: false, follow: false },
};

export default async function ImportPage() {
  const user = await requireImporter('/ops/import');
  const [runs, settings] = await Promise.all([db.importRun.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }), getSettings()]);
  const ids = runs.map(r => r.id);
  const [counts, spend, reconcile, siteStatus, googleSpend, enhanceEligible] = await Promise.all([
    db.importPlace.groupBy({ by: ['runId', 'status'], where: { runId: { in: ids } }, _count: true }),
    db.spendEntry.groupBy({ by: ['runId', 'provider', 'status'], where: { runId: { in: ids } }, _sum: { estimatedMicros: true, actualMicros: true }, _count: true }),
    db.importTask.findMany({ where: { runId: { in: ids }, status: 'needs_reconciliation' }, select: { id: true, runId: true, key: true, error: true, params: true } }),
    // Why records have no email: the website outcome per record without one.
    db.$queryRaw<Array<{ run_id: string; site: string | null; n: bigint }>>`
      SELECT run_id, crawl->>'site' AS site, count(*) AS n FROM import_places
      WHERE run_id = ANY(${ids}::uuid[]) AND email IS NULL GROUP BY run_id, crawl->>'site'`,
    db.spendEntry.aggregate({ where: { provider: 'google', createdAt: { gte: new Date(new Date().toISOString().slice(0, 7) + '-01') } }, _sum: { actualMicros: true, estimatedMicros: true }, _count: true }),
    db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM import_places p JOIN branches b ON b.id = p.branch_id
      WHERE p.status IN ('approved', 'merged') AND b.is_claimed = false AND b.status = 'live'`.then(r => Number(r[0]?.n ?? 0)),
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
    };
  });
  const who = `${user.fullName ?? user.email ?? 'צוות BeautyFind'} · ${OPS_ROLE_NAMES[user.opsRole!]}`;
  const p = pricing();

  return (
    <div dir="rtl" lang="he" className={styles.root}>
      <OpsHeader current="import" who={who} />
      <main className={styles.page}>
        <div className={styles.titleRow}>
          <h1 className={styles.h1}>ייבוא עסקים</h1>
          <Link href="/ops/import/review" className={`${styles.btn} ${styles.primary}`}>לתור הבדיקה</Link>
        </div>
        <p className={styles.lead}>
          שלב 1 מאתר עסקים ב־DataForSEO. שלב 2 משלים פרטים חסרים מהאתר הרשמי של העסק. Google משמש רק לתצוגה נפרדת ומבוקרת, ורק כשמפעילים אותו. שום דבר לא עולה לאתר לפני אישור.
        </p>
        <RunsView
          runs={rows}
          settings={settings}
          canDispatch={!!process.env.GITHUB_DISPATCH_TOKEN}
          dfsConfigured={!!process.env.DATAFORSEO_LOGIN}
          googleAvailable={googleAvailable()}
          googleMonth={{ usd: fromMicros(googleSpend._sum.actualMicros ?? googleSpend._sum.estimatedMicros ?? 0n), calls: googleSpend._count }}
          enhanceEligible={enhanceEligible}
          pricingNote={{ version: p.version, dfs: p.dataforseo.businessListingsSearch, dfsChecked: p.dataforseo.checked, dfsNote: p.dataforseo.note, googleChecked: p.google.checked }}
        />
      </main>
    </div>
  );
}
