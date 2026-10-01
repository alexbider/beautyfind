import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { requireImporter } from '@/components/ops/guard';
import { CATEGORIES, REGIONS } from '@/lib/catalog';
import { MANIFEST, SECTION_NAME, STATUS_NAME } from '@/lib/import/coverage';
import { RESEARCH_NAME, SITE_OUTCOME_NAME, SOCIAL_CHECK_NAME } from '@/lib/import/sourceNames';
import { db } from '@/lib/server/db';
import { resetPreview } from '@/lib/server/importOps';
import { importReport, reportCities, STATE_NAME, type ReportRow, type ReportState } from '@/lib/server/importReport';
import { ResetImport } from '../ResetImport';
import { ImportNav } from '../ImportNav';
import { ReportGroups } from './ReportGroups';
import { RewriteButton } from './RewriteButton';
import styles from '../import.module.css';

export const metadata: Metadata = {
  title: 'דוח פרופילים',
  robots: { index: false, follow: false },
};

// Every record the import touched is scored; a few thousand rows take seconds.
export const maxDuration = 60;

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const PAGE = 60;
const n = (x: number) => x.toLocaleString('he-IL');
const usd = (x: number) => `$${x.toFixed(2)}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jerusalem' }) : 'אף פעם');
const catName = (slug: string) => CATEGORIES.find(c => c.slug === slug)?.name ?? slug;
const STATES: ReportState[] = ['published', 'ready', 'needs_review', 'incomplete', 'pending', 'duplicate', 'rejected', 'closed'];
const WEIGHTED = MANIFEST.filter(m => m.weight > 0).map(m => m.id);
const PROVIDER_NAME: Record<string, string> = { dataforseo: 'DataForSEO', google: 'Google', enhance: 'השלמה', manual: 'ידני' };

export default async function ReportPage({ searchParams }: { searchParams: SP }) {
  const user = await requireImporter('/ops/import/report');
  const sp = await searchParams;
  const f = { region: one(sp.region), city: one(sp.city), category: one(sp.cat), state: one(sp.state), missing: one(sp.missing), runId: one(sp.run), q: one(sp.q).trim() };
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [report, cities, runs, reset] = await Promise.all([
    importReport(f),
    reportCities(),
    db.importRun.findMany({ orderBy: { createdAt: 'desc' }, take: 40, select: { id: true, label: true, status: true, provider: true } }),
    resetPreview(),
  ]);
  const { rows, groups, total, truncated } = report;
  const cityOptions = f.city && !cities.includes(f.city) ? [f.city, ...cities] : cities;
  const live = runs.some(r => r.status === 'running' || r.status === 'queued');
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const slice = rows.slice((page - 1) * PAGE, page * PAGE);
  const cur: Record<string, string> = { region: f.region, city: f.city, cat: f.category, state: f.state, missing: f.missing, run: f.runId, q: f.q, page: String(page) };
  const href = (patch: Record<string, string | number>, base = '/ops/import/report') => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...cur, ...patch })) if (v && !(k === 'page' && String(v) === '1')) p.set(k, String(v));
    return `${base}?${p}`;
  };
  const hrefFor = Object.fromEntries(groups.map(g => [g.key, href({ city: g.cityName, cat: g.category, page: 1 })]));

  // Summary over the filtered rows.
  const published = rows.filter(r => r.state === 'published').length;
  const inReview = rows.filter(r => r.state === 'ready' || r.state === 'needs_review').length;
  const complete = rows.filter(r => r.profileStatus === 'ready').length;
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.readiness, 0) / rows.length) : 0;
  const researched = rows.filter(r => r.sources.research === 'filled').length;
  const written = rows.filter(r => r.editorial && !r.editorial.needsMore).length;
  const cost = rows.reduce((s, r) => s + r.costUsd, 0);
  const gaps = WEIGHTED.map(id => ({ id, name: SECTION_NAME[id] ?? id, n: rows.filter(r => r.missing.includes(id)).length })).filter(g => g.n > 0).sort((a, b) => b.n - a.n);
  const perState = STATES.map(s => ({ id: s, name: STATE_NAME[s], n: rows.filter(r => r.state === s).length })).filter(s => s.n > 0);

  return (
    <AdminShell user={user} bare>
    <div dir="rtl" lang="he" className={styles.root}>
      <main className={styles.page}>
        <div className={styles.titleRow}>
          <h1 className={styles.h1}>דוח פרופילים</h1>
          <div className={styles.btnRow}>
            <a className={styles.btn} href={href({ page: 1 }, '/ops/import/report/export')}>הורדת CSV</a>
          </div>
        </div>
        <ImportNav current="report" counts={{ report: total }} />
        <p className={styles.lead}>
          כל עסק שהייבוא סרק או השלים, עם קישור אליו, מה יש בו ומה חסר בכל מקטע של הפרופיל, אילו מקורות ענו (DataForSEO, האתר, Google Maps, פייסבוק, אינסטגרם, מחקר ChatGPT) וכמה זה עלה.
          מהטבלה לפי עיר ותחום אפשר להתחיל אצוות השלמה לקבוצה שלמה בלחיצה אחת.
          {live ? ' יש ריצה פעילה, הדוח מתרענן לבד.' : ''}
          {truncated ? ` מוצגים ${n(total)} העסקים הראשונים, צמצמו את הסינון.` : ''}
        </p>

        <form className={styles.filters} method="get" action="/ops/import/report">
          <label>
            <span className={styles.label}>אזור</span>
            <select name="region" defaultValue={f.region} className={styles.select}>
              <option value="">כל האזורים</option>
              {REGIONS.map(r => <option key={r.slug} value={r.slug}>{r.name}</option>)}
            </select>
          </label>
          <label>
            <span className={styles.label}>עיר</span>
            <select name="city" defaultValue={f.city} className={styles.select}>
              <option value="">כל הערים</option>
              {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
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
            <select name="state" defaultValue={f.state} className={styles.select}>
              <option value="">כל המצבים</option>
              {STATES.map(s => <option key={s} value={s}>{STATE_NAME[s]}</option>)}
            </select>
          </label>
          <label>
            <span className={styles.label}>חסר</span>
            <select name="missing" defaultValue={f.missing} className={styles.select}>
              <option value="">כל החוסרים</option>
              {WEIGHTED.map(id => <option key={id} value={id}>{SECTION_NAME[id] ?? id}</option>)}
            </select>
          </label>
          <label>
            <span className={styles.label}>ריצה</span>
            <select name="run" defaultValue={f.runId} className={styles.select}>
              <option value="">כל הריצות</option>
              {runs.map(r => <option key={r.id} value={r.id}>{r.label}{r.status === 'running' ? ' (רצה)' : ''}</option>)}
            </select>
          </label>
          <label>
            <span className={styles.label}>חיפוש</span>
            <input name="q" defaultValue={f.q} className={styles.input} placeholder="שם או כתובת" />
          </label>
          <button type="submit" className={`${styles.btn} ${styles.primary}`} style={{ flex: 'none' }}>סינון</button>
        </form>

        <div className={styles.tiles} aria-label="סיכום">
          <div className={styles.tile}><b>{n(rows.length)}</b>עסקים בסינון</div>
          <div className={styles.tile}><b>{n(published)}</b>פורסמו</div>
          <div className={styles.tile}><b>{n(inReview)}</b>ממתינים לאישור</div>
          <div className={styles.tile}><b>{n(complete)}</b>פרופיל מלא</div>
          <div className={styles.tile}><b>{avg}%</b>מוכנות ממוצעת</div>
          <div className={styles.tile}><b>{n(researched)}</b>ChatGPT השלים</div>
          <div className={styles.tile}><b>{n(written)}</b>עם תיאור כתוב</div>
          <div className={styles.tile}><b>{usd(cost)}</b>עלות מצטברת</div>
        </div>

        <div className={styles.seg} aria-label="לפי מצב">
          {perState.map(s => (
            <Link key={s.id} href={href({ state: f.state === s.id ? '' : s.id, page: 1 })} className={styles.segLink} aria-current={f.state === s.id ? 'page' : undefined}>
              {s.name} <span className={styles.ltr}>{n(s.n)}</span>
            </Link>
          ))}
        </div>
        {gaps.length ? (
          <div className={styles.seg} aria-label="חוסרים נפוצים">
            {gaps.map(g => (
              <Link key={g.id} href={href({ missing: f.missing === g.id ? '' : g.id, page: 1 })} className={styles.segLink} aria-current={f.missing === g.id ? 'page' : undefined}>
                חסר {g.name} <span className={styles.ltr}>{n(g.n)}</span>
              </Link>
            ))}
          </div>
        ) : null}

        <section className={styles.card} style={{ marginBottom: 14 }}>
          <h2 className={styles.h2}>לפי עיר ותחום</h2>
          <p className={styles.note} style={{ marginBottom: 10 }}>לחיצה על מספר העסקים מסננת את הרשימה למטה. ״השלמת חוסרים״ פותחת אצווה אוטומטית לעסקים שפורסמו בקבוצה ולא נתבעו; ההתקדמות מופיעה בלשונית ההשלמות.</p>
          <ReportGroups groups={groups} region={f.region} live={live} canDispatch={!!process.env.GITHUB_DISPATCH_TOKEN} hrefFor={hrefFor} />
        </section>

        <section className={styles.stack} aria-label="פרופילים">
          {slice.length ? slice.map(r => <Row key={r.placeId} r={r} />) : <p className={styles.empty}>אין עסקים בסינון הזה.</p>}
        </section>

        {pages > 1 ? (
          <div className={styles.pager}>
            {page > 1 ? <Link className={styles.btn} href={href({ page: page - 1 })}>הקודם</Link> : <span />}
            <span>עמוד {page} מתוך {pages} · {n(rows.length)} עסקים</span>
            {page < pages ? <Link className={styles.btn} href={href({ page: page + 1 })}>הבא</Link> : <span />}
          </div>
        ) : null}
        <div style={{ marginTop: 14 }}><ResetImport preview={reset} /></div>
      </main>
    </div>
    </AdminShell>
  );
}

const stateChip = (s: ReportState) => (s === 'published' ? styles.chipOk : s === 'ready' || s === 'needs_review' || s === 'pending' ? styles.chipWarn : s === 'incomplete' || s === 'rejected' ? styles.chipBad : '');

function Row({ r }: { r: ReportRow }) {
  const src = r.sources;
  const parts: string[] = [`מקור: ${PROVIDER_NAME[src.provider] ?? src.provider}`];
  parts.push(`אתר: ${src.site ? SITE_OUTCOME_NAME[src.site] ?? src.site : 'לא נבדק'}`);
  if (src.maps) parts.push(`Maps: ${SOCIAL_CHECK_NAME[src.maps] ?? src.maps}`);
  if (src.facebook) parts.push(`פייסבוק: ${SOCIAL_CHECK_NAME[src.facebook] ?? src.facebook}`);
  if (src.instagram) parts.push(`אינסטגרם: ${SOCIAL_CHECK_NAME[src.instagram] ?? src.instagram}`);
  if (src.render) parts.push(`דפדפן: ${src.render === 'ok' ? 'נקרא' : src.render}`);
  if (src.research) parts.push(`ChatGPT: ${RESEARCH_NAME[src.research] ?? src.research}${src.researchFilled.length ? ` (${src.researchFilled.join(', ')})` : ''}`);
  else parts.push('ChatGPT: לא רץ');
  return (
    <article className={styles.card}>
      <div className={styles.rec}>
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <h3 className={styles.recName}>
              {r.state === 'published' ? <a href={r.href} target="_blank" rel="noreferrer">{r.name}</a> : <Link href={r.href}>{r.name}</Link>}
            </h3>
            <span className={`${styles.chip} ${stateChip(r.state)}`}>{STATE_NAME[r.state]}</span>
            <span className={`${styles.sec} ${r.readiness >= 80 ? styles.secOn : r.readiness >= 50 ? styles.secHalf : styles.secOff}`}>מוכנות {r.readiness}%</span>
            <span className={styles.note}>{STATUS_NAME[r.profileStatus]}</span>
            {r.claimed ? <span className={styles.chip}>נתבע על ידי בעל העסק</span> : null}
          </div>
          <p className={styles.note} style={{ margin: '4px 0 0' }}>
            {[r.cityName, r.categories.map(catName).join(', ')].filter(Boolean).join(' · ')}
            {' · '}תמונות {n(r.photos)} · שירותים {n(r.services)} · תיאור {r.editorial ? `${n(r.editorial.words)} מילים (${r.editorial.model})${r.editorial.needsMore ? ', צריך עוד מידע' : ''}` : 'אין'}
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }} aria-label="מקטעי הפרופיל">
          {r.sections.map(s => (
            <span key={s.id} className={`${styles.sec} ${s.state === 'populated' ? styles.secOn : s.state === 'fallback' ? styles.secHalf : styles.secOff}`} title={s.detail}>
              {SECTION_NAME[s.id] ?? s.id}
            </span>
          ))}
        </div>
        <p className={styles.note} style={{ margin: 0 }}>
          {parts.join(' · ')}
        </p>
        <p className={styles.note} style={{ margin: 0 }}>
          {r.missing.length ? <>חסר: {r.missing.map(m => SECTION_NAME[m] ?? m).join(', ')}. </> : 'לא חסר דבר. '}
          עלות {usd(r.costUsd)} · פעילות אחרונה {when(r.lastActivity)} ·{' '}
          <Link href={r.reviewHref}>רשומת הבדיקה</Link> · <Link href={`/ops/import?run=${r.runId}`}>הריצה</Link>
          {r.state === 'published' ? <> · <a href={r.href} target="_blank" rel="noreferrer">הפרופיל באתר</a></> : null}
        </p>
        {r.state === 'published' && !r.claimed && r.branchId ? <div><RewriteButton branchId={r.branchId} name={r.name} /></div> : null}
      </div>
    </article>
  );
}
