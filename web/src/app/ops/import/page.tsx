import type { Metadata } from 'next';
import Link from 'next/link';
import { OpsHeader } from '@/components/ops/OpsHeader';
import { OPS_ROLE_NAMES, requireImporter } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import { RunsView, type RunRow } from './RunsView';
import styles from './import.module.css';

export const metadata: Metadata = {
  title: 'ייבוא עסקים',
  robots: { index: false, follow: false },
};

export default async function ImportPage() {
  const user = await requireImporter('/ops/import');
  const runs = await db.importRun.findMany({ orderBy: { createdAt: 'desc' }, take: 30 });
  const counts = await db.importPlace.groupBy({ by: ['runId', 'status'], where: { runId: { in: runs.map(r => r.id) } }, _count: true });
  const rows: RunRow[] = runs.map(r => ({
    id: r.id,
    label: r.label,
    status: r.status,
    scope: r.scope as RunRow['scope'],
    maxRequests: r.maxRequests,
    requestsUsed: r.requestsUsed,
    maxExtractions: r.maxExtractions,
    extractionsUsed: r.extractionsUsed,
    stats: (r.stats ?? {}) as RunRow['stats'],
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    byStatus: Object.fromEntries(counts.filter(c => c.runId === r.id).map(c => [c.status, c._count])),
  }));
  const who = `${user.fullName ?? user.email ?? 'צוות BeautyFind'} · ${OPS_ROLE_NAMES[user.opsRole!]}`;
  const dispatch = !!process.env.GITHUB_DISPATCH_TOKEN;

  return (
    <div dir="rtl" lang="he" className={styles.root}>
      <OpsHeader current="import" who={who} />
      <main className={styles.page}>
        <div className={styles.titleRow}>
          <h1 className={styles.h1}>ייבוא עסקים</h1>
          <Link href="/ops/import/review" className={`${styles.btn} ${styles.primary}`}>לתור הבדיקה</Link>
        </div>
        <p className={styles.lead}>
          ריצה מחפשת עסקים ב־Google, קוראת את האתר של כל עסק, מחלצת תחומים ותפריט טיפולים ובודקת כפילויות. שום דבר לא עולה לאתר לפני אישור בתור הבדיקה.
        </p>
        <RunsView runs={rows} canDispatch={dispatch} />
      </main>
    </div>
  );
}
