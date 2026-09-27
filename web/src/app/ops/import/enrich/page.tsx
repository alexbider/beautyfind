import type { Metadata } from 'next';
import Link from 'next/link';
import { OpsHeader } from '@/components/ops/OpsHeader';
import { OPS_ROLE_NAMES, requireImporter } from '@/components/ops/guard';
import { CATEGORIES, REGIONS } from '@/lib/catalog';
import { SECTION_NAME, STATUS_NAME, type ProfileStatus } from '@/lib/import/coverage';
import { enrichQueue, TARGETABLE } from '@/lib/server/enrichQueue';
import { pricing } from '@/lib/import/pricing';
import { getSettings } from '@/lib/server/importOps';
import { EnrichList } from './EnrichList';
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

export default async function EnrichPage({ searchParams }: { searchParams: SP }) {
  const user = await requireImporter('/ops/import/enrich');
  const sp = await searchParams;
  const f = { region: one(sp.region), category: one(sp.cat), status: one(sp.status), missing: one(sp.missing), q: one(sp.q).trim() };
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [{ rows, total, truncated }, settings] = await Promise.all([enrichQueue(f), getSettings()]);
  // Counts per missing section and per status over the region/category/search filter (before the status and missing filters).
  const base = await enrichQueue({ region: f.region, category: f.category, q: f.q });
  const perSection = TARGETABLE.map(t => ({ id: t.id, name: SECTION_NAME[t.id] ?? t.id, n: base.rows.filter(r => r.missing.includes(t.id)).length })).filter(x => x.n > 0);
  const perStatus = STATUSES.map(s => ({ id: s, name: STATUS_NAME[s], n: base.rows.filter(r => r.status === s).length }));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const slice = rows.slice((page - 1) * PAGE, page * PAGE);
  const href = (patch: Record<string, string | number>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string> = { region: f.region, cat: f.category, status: f.status, missing: f.missing, q: f.q, page: String(page) };
    for (const [k, v] of Object.entries({ ...cur, ...patch })) if (v && !(k === 'page' && String(v) === '1')) p.set(k, String(v));
    return `/ops/import/enrich?${p}`;
  };
  const who = `${user.fullName ?? user.email ?? 'צוות BeautyFind'} · ${OPS_ROLE_NAMES[user.opsRole!]}`;

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
          כל עסק שפורסם מהייבוא ולא נתבע, עם ציון מוכנות מול התבנית ומה חסר בו. סננו לפי מה שחסר, בחרו עסקים והריצו העשרה ממוקדת: קריאה חוזרת של האתר, רענון מ־DataForSEO או כתיבה מחדש של התיאור.
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
          allFilteredIds={rows.map(r => r.branchId)}
          focus={f.missing ? [SECTION_NAME[f.missing] ?? f.missing] : []}
          editorialUsd={settings.editorialEnabled ? pricing().editorial.perProfileUsd : 0}
          dfs={{ perRequestUsd: pricing().dataforseo.businessListingsSearch.perRequestUsd, perItemUsd: pricing().dataforseo.businessListingsSearch.perItemUsd }}
          canDispatch={!!process.env.GITHUB_DISPATCH_TOKEN}
          mapConfigured={!!process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY}
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
