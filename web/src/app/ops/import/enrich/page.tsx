import type { Metadata } from 'next';
import Link from 'next/link';
import { OpsHeader } from '@/components/ops/OpsHeader';
import { OPS_ROLE_NAMES, requireImporter } from '@/components/ops/guard';
import { CATEGORIES, REGIONS } from '@/lib/catalog';
import { SECTION_NAME, STATUS_NAME, type ProfileStatus } from '@/lib/import/coverage';
import { STEP_NAME, STEP_ORDER, stepUsd, type StepId } from '@/lib/import/enrichPlan';
import { fromMicros, pricing } from '@/lib/import/pricing';
import { runErrorKind } from '@/lib/import/runErrors';
import { db } from '@/lib/server/db';
import { enrichQueue, TARGETABLE } from '@/lib/server/enrichQueue';
import { getSettings } from '@/lib/server/importOps';
import { EnrichList, type BatchRow } from './EnrichList';
import styles from '../import.module.css';

export const metadata: Metadata = {
  title: 'העשרה לפי חוסרים',
  robots: { index: false, follow: false },
};

// Scoring every listing reads its treatments and computes the coverage; a few thousand rows take seconds.
export const maxDuration = 60;

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const PAGE = 100;
const STATUSES: ProfileStatus[] = ['needs_review', 'needs_owner_information', 'ready_with_disclosed_gaps', 'ready'];

/** Enhance runs are the "batches" of the enrichment tab. */
async function batches(): Promise<BatchRow[]> {
  const runs = await db.importRun.findMany({ where: { provider: 'enhance' }, orderBy: { createdAt: 'desc' }, take: 40 });
  const ids = runs.map(r => r.id);
  const tasks = await db.importTask.groupBy({ by: ['runId', 'kind', 'status'], where: { runId: { in: ids } }, _count: true });
  return runs.map(r => {
    const stats = (r.stats ?? {}) as { counters?: Record<string, number>; listings?: number; plan?: Record<string, number>; auto?: boolean; apifyMissingToken?: boolean; apifyBudgetHit?: string; failures?: string[] };
    const scope = (r.scope ?? {}) as { steps?: string[]; auto?: boolean; refresh?: boolean; regenerate?: boolean; rereadSite?: boolean; focus?: string[] };
    const t = tasks.filter(x => x.runId === r.id);
    const c = stats.counters ?? {};
    const steps = scope.steps ?? ([scope.refresh && 'dfs', scope.rereadSite && 'site', 'editorial', scope.regenerate && 'regenerate', 'images'].filter(Boolean) as string[]);
    return {
      id: r.id,
      label: r.label,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      listings: stats.listings ?? (scope as { branchIds?: string[] }).branchIds?.length ?? 0,
      steps,
      auto: scope.auto ?? stats.auto ?? false,
      plan: stats.plan ?? {},
      focus: scope.focus ?? [],
      tasks: { total: t.reduce((n, x) => n + x._count, 0), done: t.filter(x => x.status === 'done').reduce((n, x) => n + x._count, 0), failed: t.filter(x => x.status === 'failed').reduce((n, x) => n + x._count, 0), reconcile: t.filter(x => x.status === 'needs_reconciliation').reduce((n, x) => n + x._count, 0) },
      improved: c.improved ?? 0,
      nothing: c.nothing_to_add ?? 0,
      failed: c.failed ?? 0,
      editorialWritten: c.editorial_written ?? 0,
      apifyMatched: Object.entries(c).filter(([k]) => /^apify_.*_matched$/.test(k)).reduce((n, [, v]) => n + v, 0),
      apifyRuns: c.apifyRuns ?? 0,
      apifyMissingToken: stats.apifyMissingToken === true,
      apifyBudgetHit: stats.apifyBudgetHit ?? null,
      spentUsd: fromMicros(r.spentMicros),
      reservedUsd: fromMicros(r.reservedMicros),
      budgetUsd: r.budgetMicros != null ? fromMicros(r.budgetMicros) : null,
      error: r.error,
      errorKind: runErrorKind(r.error),
      failures: (stats.failures ?? []).slice(0, 3),
    };
  });
}

export default async function EnrichPage({ searchParams }: { searchParams: SP }) {
  const user = await requireImporter('/ops/import/enrich');
  const sp = await searchParams;
  const f = { region: one(sp.region), category: one(sp.cat), status: one(sp.status), missing: one(sp.missing), step: one(sp.step), q: one(sp.q).trim() };
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [{ rows, total, truncated }, settings, batchRows] = await Promise.all([enrichQueue(f), getSettings(), batches()]);
  // Counts per missing section, status and step over the region/category/search filter (before the status, missing and step filters).
  const base = await enrichQueue({ region: f.region, category: f.category, q: f.q });
  const perSection = TARGETABLE.map(t => ({ id: t.id, name: SECTION_NAME[t.id] ?? t.id, n: base.rows.filter(r => r.missing.includes(t.id)).length })).filter(x => x.n > 0);
  const perStatus = STATUSES.map(s => ({ id: s, name: STATUS_NAME[s], n: base.rows.filter(r => r.status === s).length }));
  const perStep = STEP_ORDER.filter(s => s !== 'regenerate').map(s => ({ id: s, name: STEP_NAME[s], n: base.rows.filter(r => r.plan.includes(s)).length })).filter(x => x.n > 0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const slice = rows.slice((page - 1) * PAGE, page * PAGE);
  const href = (patch: Record<string, string | number>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string> = { region: f.region, cat: f.category, status: f.status, missing: f.missing, step: f.step, q: f.q, page: String(page) };
    for (const [k, v] of Object.entries({ ...cur, ...patch })) if (v && !(k === 'page' && String(v) === '1')) p.set(k, String(v));
    return `/ops/import/enrich?${p}`;
  };
  const who = `${user.fullName ?? user.email ?? 'צוות BeautyFind'} · ${OPS_ROLE_NAMES[user.opsRole!]}`;
  const p = pricing();
  const costs = Object.fromEntries(STEP_ORDER.map(s => [s, stepUsd(s, p, { renderPages: settings.apifyRenderPages, editorialEnabled: settings.editorialEnabled })])) as Record<StepId, number>;

  return (
    <div dir="rtl" lang="he" className={styles.root}>
      <OpsHeader current="import" who={who} />
      <main className={styles.page}>
        <div className={styles.titleRow}>
          <h1 className={styles.h1}>העשרה לפי חוסרים</h1>
          <div className={styles.btnRow}>
            <Link href="/ops/import/review" className={styles.btn}>לתור הבדיקה</Link>
            <Link href="/ops/import" className={styles.btn}>לריצות</Link>
          </div>
        </div>
        <p className={styles.lead}>
          כל עסק שפורסם מהייבוא ולא נתבע, עם ציון מוכנות מול התבנית, מה חסר בו ואילו מקורות יכולים להשלים את החסר: DataForSEO, Google Maps, הפייסבוק והאינסטגרם של העסק (דרך Apify), אתר העסק, וכתיבת התיאור. בחרו עסקים, השאירו ״כל ההעשרות הנדרשות״ או סמנו צעדים, והריצו אצווה. אצוות מסתיימות אפשר למחוק.
          {truncated ? ` מוצגים ${total} העסקים הראשונים.` : ''}
        </p>

        <form className={styles.filters} method="get" action="/ops/import/enrich">
          <label>
            <span className={styles.label}>אזור</span>
            <select name="region" defaultValue={f.region} className={styles.select}>
              <option value="">כל האזורים</option>
              {REGIONS.map(r => <option key={r.slug} value={r.slug}>{r.name}</option>)}
            </select>
          </label>
          <label>
            <span className={styles.label}>תחום</span>
            <select name="cat" defaultValue={f.category} className={styles.select}>
              <option value="">כל התחומים</option>
              {CATEGORIES.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
          <label>
            <span className={styles.label}>מצב</span>
            <select name="status" defaultValue={f.status} className={styles.select}>
              <option value="">כל המצבים</option>
              {perStatus.map(s => <option key={s.id} value={s.id}>{s.name} ({s.n})</option>)}
            </select>
          </label>
          <label>
            <span className={styles.label}>חסר</span>
            <select name="missing" defaultValue={f.missing} className={styles.select}>
              <option value="">כל החוסרים</option>
              {perSection.map(s => <option key={s.id} value={s.id}>{s.name} ({s.n})</option>)}
            </select>
          </label>
          <label>
            <span className={styles.label}>מקור שיכול להשלים</span>
            <select name="step" defaultValue={f.step} className={styles.select}>
              <option value="">כל המקורות</option>
              {perStep.map(s => <option key={s.id} value={s.id}>{s.name} ({s.n})</option>)}
            </select>
          </label>
          <label>
            <span className={styles.label}>חיפוש</span>
            <input name="q" defaultValue={f.q} className={styles.input} placeholder="שם או עיר" />
          </label>
          <button type="submit" className={`${styles.btn} ${styles.primary}`} style={{ flex: 'none' }}>סינון</button>
        </form>

        <div className={styles.seg} aria-label="חוסרים נפוצים">
          {perSection.map(s => (
            <Link key={s.id} href={href({ missing: s.id, page: 1 })} className={styles.segLink} aria-current={f.missing === s.id ? 'page' : undefined}>
              {s.name} <span className={styles.ltr}>{s.n}</span>
            </Link>
          ))}
        </div>

        <EnrichList
          rows={slice}
          allFiltered={rows.map(r => ({ id: r.branchId, plan: r.plan }))}
          focus={f.missing ? [SECTION_NAME[f.missing] ?? f.missing] : []}
          costs={costs}
          flags={{ apifyEnabled: settings.apifyEnabled, apifyMaps: settings.apifyMaps, apifyFacebook: settings.apifyFacebook, apifyInstagram: settings.apifyInstagram, apifyRender: settings.apifyRender, dataforseoEnabled: settings.dataforseoEnabled, editorialEnabled: settings.editorialEnabled, killSwitch: settings.killSwitch, apifyBudgetUsd: settings.apifyBudgetUsd, editorialBudgetUsd: settings.editorialBudgetUsd }}
          canDispatch={!!process.env.GITHUB_DISPATCH_TOKEN}
          mapConfigured={!!process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY}
          batches={batchRows}
        />

        {pages > 1 ? (
          <div className={styles.pager}>
            {page > 1 ? <Link className={styles.btn} href={href({ page: page - 1 })}>הקודם</Link> : <span />}
            <span>עמוד {page} מתוך {pages} · {rows.length.toLocaleString('he-IL')} עסקים</span>
            {page < pages ? <Link className={styles.btn} href={href({ page: page + 1 })}>הבא</Link> : <span />}
          </div>
        ) : null}
      </main>
    </div>
  );
}
