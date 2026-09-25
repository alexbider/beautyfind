'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { CATEGORIES, CITIES, MENU_REGION_ORDER, REGIONS } from '@/lib/catalog';
import { dfsCategoriesFor } from '@/lib/import/dataforseo';
import { DEFAULT_ASSUMPTIONS, dfsRunMaxUsd, estimateRun, estimateTable, type EstimateAssumptions } from '@/lib/import/estimate';
import type { RunScope } from '@/lib/import/rules';
import type { ImportSettings } from '@/lib/import/settings';
import { reconcileAction, runControlAction, saveSettingsAction, startRunAction } from './actions';
import styles from './import.module.css';

export interface RunRow {
  id: string;
  label: string;
  provider: string;
  status: 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'canceled';
  scope: RunScope;
  recordLimit: number | null;
  budgetUsd: number | null;
  spentUsd: number;
  reservedUsd: number;
  maxRequests: number;
  requestsUsed: number;
  stats: { counters?: Record<string, number>; budgetHit?: boolean; recordLimitReached?: boolean; lastExtractError?: string } & Record<string, unknown>;
  error: string | null;
  createdAt: string;
  byStatus: Record<string, number>;
  spend: Record<string, { estimatedUsd: number; actualUsd: number; calls: number; uncertain: number }>;
  noEmailBySite: Record<string, number>;
  reconcile: Array<{ id: string; key: string; error: string | null; page: number }>;
}

const STATUS_NAME: Record<RunRow['status'], string> = { queued: 'ממתינה', running: 'רצה', paused: 'מושהית', done: 'הסתיימה', failed: 'נכשלה', canceled: 'בוטלה' };
const STATUS_CHIP: Record<RunRow['status'], string> = { queued: '', running: styles.chipOk, paused: styles.chipWarn, done: styles.chipOk, failed: styles.chipBad, canceled: '' };
const SITE_NAME: Record<string, string> = {
  no_website: 'אין אתר', no_email: 'אין דוא״ל באתר', blocked: 'האתר חסם', robots: 'robots.txt אוסר', failed: 'האתר לא נטען', unsafe: 'כתובת לא בטוחה',
  skipped_complete: 'לא נדרש', ok: 'נמצא אך לא נבחר', pending: 'טרם נבדק', not_modified: 'לא השתנה',
};
const n = (x: number) => x.toLocaleString('he-IL');
const usd = (x: number) => `$${x < 1 ? x.toFixed(3) : x.toFixed(2)}`;

function Scope({ all, setAll, cities, setCities, cats, setCats }: { all: boolean; setAll: (v: boolean) => void; cities: string[]; setCities: (v: string[]) => void; cats: string[]; setCats: (v: string[]) => void }) {
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  return (
    <>
      <div>
        <span className={styles.label}>תחומים</span>
        <div className={styles.checks}>
          {CATEGORIES.map(c => (
            <label key={c.slug} className={styles.check}>
              <input type="checkbox" checked={cats.includes(c.slug)} onChange={() => toggle(cats, setCats, c.slug)} />
              {c.name}
            </label>
          ))}
        </div>
        <p className={styles.note}>קטגוריות DataForSEO: <span className={styles.ltr}>{dfsCategoriesFor(cats).join(', ') || 'אין'}</span></p>
      </div>
      <div>
        <span className={styles.label}>אזור</span>
        <label className={styles.check}><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />כל הארץ</label>
        {!all
          ? MENU_REGION_ORDER.map(slug => {
              const region = REGIONS.find(r => r.slug === slug)!;
              const list = CITIES.filter(c => c.region === slug);
              const allOn = list.every(c => cities.includes(c.slug));
              return (
                <div key={slug} className={styles.region}>
                  <div className={styles.regionHead}>
                    <label className={styles.check}>
                      <input type="checkbox" checked={allOn} onChange={() => setCities(allOn ? cities.filter(c => !list.some(x => x.slug === c)) : [...new Set([...cities, ...list.map(c => c.slug)])])} />
                      {region.name}
                    </label>
                  </div>
                  <div className={styles.checks}>
                    {list.map(c => (
                      <label key={c.slug} className={styles.check}>
                        <input type="checkbox" checked={cities.includes(c.slug)} onChange={() => toggle(cities, setCities, c.slug)} />
                        {c.name}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })
          : null}
      </div>
    </>
  );
}

function NewRun({ settings, canDispatch, dfsConfigured }: { settings: ImportSettings; canDispatch: boolean; dfsConfigured: boolean }) {
  const router = useRouter();
  const [provider, setProvider] = useState<'dataforseo' | 'google'>('dataforseo');
  const [label, setLabel] = useState('');
  const [all, setAll] = useState(false);
  const [cities, setCities] = useState<string[]>([]);
  const [cats, setCats] = useState<string[]>(CATEGORIES.map(c => c.slug));
  const [limit, setLimit] = useState(String(settings.pilotRecordLimit));
  const [budget, setBudget] = useState(String(settings.pilotBudgetUsd));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const scope: RunScope = { all, cities, categories: cats, nearby: provider === 'google', text: provider === 'google' };
  const recordLimit = Math.max(1, Number(limit) || 0);
  const dfsMax = useMemo(() => dfsRunMaxUsd(recordLimit, settings.dfsPageSize), [recordLimit, settings.dfsPageSize]);
  const legacy = useMemo(() => (provider === 'google' ? estimateRun(scope) : null), [provider, all, cities, cats]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = cats.length > 0 && (all || cities.length > 0) && Number(budget) > 0 && !settings.killSwitch;

  const go = (preview: boolean) =>
    start(async () => {
      setMsg(null);
      const r = await startRunAction({
        label: (preview ? 'תצוגה מקדימה: ' : '') + (label || (all ? 'כל הארץ' : cities.map(c => CITIES.find(x => x.slug === c)?.name).join(', '))),
        provider,
        scope,
        recordLimit: preview ? 10 : recordLimit,
        budgetUsd: preview ? Math.min(Number(budget), 0.1) : Number(budget),
      });
      if (!r.ok) return setMsg({ ok: false, text: r.error === 'kill_switch' ? 'מתג החירום פעיל. כבו אותו בהגדרות.' : r.error === 'provider_disabled' ? 'DataForSEO כבוי בהגדרות.' : 'לא הצלחנו ליצור את הריצה. בדקו את הבחירות.' });
      setMsg({ ok: true, text: r.dispatched ? 'הריצה נוצרה והעובד הופעל.' : 'הריצה נוצרה ומחכה בתור. הפעילו את ה־workflow ״Import worker״ ב־GitHub Actions.' });
      router.refresh();
    });

  return (
    <section className={`${styles.card} ${styles.stack}`} aria-labelledby="new-run">
      <h2 id="new-run" className={styles.h2}>ייבוא חדש</h2>
      <div>
        <span className={styles.label}>מקור</span>
        <div className={styles.checks}>
          <label className={styles.check}><input type="radio" name="prov" checked={provider === 'dataforseo'} onChange={() => setProvider('dataforseo')} />DataForSEO (ברירת מחדל)</label>
          <label className={styles.check}><input type="radio" name="prov" checked={provider === 'google'} onChange={() => setProvider('google')} />Google, חיפוש במפה (ישן, יקר)</label>
        </div>
        {provider === 'dataforseo' && !dfsConfigured ? <p className={styles.info}>DATAFORSEO_LOGIN לא מוגדר בשרת. הריצה תיכשל עד שמגדירים את פרטי הגישה ב־GitHub.</p> : null}
        <p className={styles.note}>מדינה: ישראל (IL). התוצאות הן רשומות תואמות במאגר של הספק, לא כל העסקים בישראל.</p>
      </div>
      <label>
        <span className={styles.label}>שם</span>
        <input className={styles.input} value={label} onChange={e => setLabel(e.target.value)} maxLength={80} placeholder="לדוגמה: חיפה, פיילוט" />
      </label>
      <Scope all={all} setAll={setAll} cities={cities} setCities={setCities} cats={cats} setCats={setCats} />
      <div className={styles.grid2} style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <label>
          <span className={styles.label}>מספר עסקים ייחודיים</span>
          <input className={styles.input} inputMode="numeric" dir="ltr" value={limit} onChange={e => setLimit(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label>
          <span className={styles.label}>תקרת הוצאה לריצה (USD)</span>
          <input className={styles.input} inputMode="decimal" dir="ltr" value={budget} onChange={e => setBudget(e.target.value.replace(/[^\d.]/g, ''))} />
        </label>
      </div>
      <div className={styles.estimate} aria-live="polite">
        {provider === 'dataforseo' ? (
          <>
            <div>בקשות DataForSEO (מקסימום)<b className={styles.ltr}>{n(dfsMax.pages)}</b></div>
            <div>עלות מקסימלית ברוטו<b className={styles.ltr}>{usd(dfsMax.usd)}</b></div>
          </>
        ) : (
          <>
            <div>קריאות Google (הערכה)<b className={styles.ltr}>{n(legacy!.min)}–{n(legacy!.likely)}</b></div>
            <div>עלות משוערת<b className={styles.ltr}>${n(legacy!.usdMin)}–${n(legacy!.usdLikely)}</b></div>
          </>
        )}
      </div>
      <p className={styles.note}>הריצה נעצרת לפני בקשה שתעבור את התקרה, וממשיכה לשלב האתרים עם מה שנמצא. קריאת אתרים עצמה ללא עלות לספק.</p>
      {!canDispatch ? <p className={styles.info}>אין הפעלה אוטומטית (GITHUB_DISPATCH_TOKEN). הריצה תחכה עד שמפעילים את ה־workflow.</p> : null}
      {msg ? <p className={msg.ok ? styles.info : styles.error} role="status">{msg.text}</p> : null}
      <div className={styles.btnRow}>
        <button type="button" className={styles.btn} disabled={!valid || pending} onClick={() => go(true)}>תצוגה מקדימה (10 עסקים)</button>
        <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={!valid || pending} onClick={() => go(false)}>{pending ? 'יוצרים…' : 'ייבוא ל־staging'}</button>
      </div>
    </section>
  );
}

function Settings({ settings, googleAvailable, googleMonth }: { settings: ImportSettings; googleAvailable: boolean; googleMonth: { usd: number; calls: number } }) {
  const router = useRouter();
  const [v, setV] = useState(settings);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState('');
  const set = <K extends keyof ImportSettings>(k: K, val: ImportSettings[K]) => setV(o => ({ ...o, [k]: val }));
  const num = (k: keyof ImportSettings, label: string, step = '1') => (
    <label>
      <span className={styles.label}>{label}</span>
      <input className={styles.input} dir="ltr" type="number" step={step} value={String(v[k])} onChange={e => set(k, Number(e.target.value) as never)} />
    </label>
  );
  const flag = (k: keyof ImportSettings, label: string, disabled = false) => (
    <label className={styles.check}><input type="checkbox" disabled={disabled} checked={Boolean(v[k])} onChange={e => set(k, e.target.checked as never)} />{label}</label>
  );
  const save = (patch?: Partial<ImportSettings>) =>
    start(async () => {
      const r = await saveSettingsAction({ ...v, ...patch });
      if (r.ok && r.settings) setV(r.settings);
      setSaved(r.ok ? 'נשמר' : 'השמירה נכשלה');
      router.refresh();
    });
  return (
    <details className={styles.card} open={v.killSwitch}>
      <summary className={styles.h2} style={{ cursor: 'pointer' }}>הגדרות ומתג חירום</summary>
      <div className={styles.stack} style={{ marginTop: 12 }}>
        <div className={styles.btnRow}>
          <button type="button" className={`${styles.btn} ${v.killSwitch ? styles.teal : styles.danger}`} disabled={pending} onClick={() => save({ killSwitch: !v.killSwitch })}>
            {v.killSwitch ? 'כיבוי מתג החירום' : 'מתג חירום: עצירת כל הקריאות בתשלום'}
          </button>
          {v.killSwitch ? <span className={`${styles.chip} ${styles.chipBad}`}>פעיל: אין קריאות בתשלום</span> : null}
        </div>
        <div className={styles.checks}>
          {flag('dataforseoEnabled', 'DataForSEO פעיל')}
          {flag('browserFallback', 'דפדפן כגיבוי לאתרים שדורשים JavaScript')}
          {flag('llmEnabled', 'חילוץ טיפולים עם Claude (עם ציטוט מהאתר)')}
          {flag('googleEnabled', 'Google: תצוגה נפרדת בלבד', !googleAvailable)}
          {flag('requireEmail', 'דוא״ל חובה לפרסום')}
          {flag('requirePhoneOrWebsite', 'טלפון או אתר חובה לפרסום')}
          {flag('publishProviderRatings', 'פרסום דירוג הספק (רק אחרי אישור תנאי הספק)')}
          {flag('useWebsiteImages', 'לוגו ותמונות מאתר העסק (נבחרים בבדיקה, מועתקים באישור)')}
        </div>
        {!googleAvailable ? <p className={styles.note}>Google כבוי בשרת (GOOGLE_ENRICHMENT_ENABLED אינו true או שאין מפתח).</p> : null}
        <div className={styles.editGrid}>
          {num('pilotRecordLimit', 'ברירת מחדל: עסקים לריצה')}
          {num('pilotBudgetUsd', 'ברירת מחדל: תקרה לריצה (USD)', '0.01')}
          {num('dfsPageSize', 'גודל עמוד DataForSEO (עד 1,000)')}
          {num('crawlMaxPages', 'עמודים לאתר (עד 10)')}
          {num('maxListingPhotos', 'תמונות מאתר העסק לכל עסק (עד 20)')}
          {num('recheckOkDays', 'ימים עד בדיקה חוזרת של אתר')}
          {num('recheckFailDays', 'ימים עד ניסיון חוזר אחרי כישלון')}
          {num('browserMaxPerRun', 'עמודי דפדפן לריצה')}
          {num('llmBudgetUsd', 'תקציב Claude לריצה (USD)', '0.01')}
          {num('googleRunCallCap', 'Google: קריאות לריצה')}
          {num('googleDailyUsd', 'Google: תקרה יומית (USD)', '0.01')}
          {num('googleMonthlyUsd', 'Google: תקרה חודשית (USD)', '0.01')}
          {num('googlePhotoCap', 'Google: תמונות ביום')}
        </div>
        <p className={styles.note}>Google החודש: <span className={styles.ltr}>{googleMonth.calls} קריאות, {usd(googleMonth.usd)}</span> (ברוטו, לפני הקצאה חינמית).</p>
        <div className={styles.btnRow}>
          <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={pending} onClick={() => save()}>שמירת הגדרות</button>
          {saved ? <span className={styles.result} role="status">{saved}</span> : null}
        </div>
      </div>
    </details>
  );
}

function Estimator({ pricingNote }: { pricingNote: { version: string; dfs: { perRequestUsd: number; perItemUsd: number }; dfsChecked: string; dfsNote: string; googleChecked: string } }) {
  const [a, setA] = useState<EstimateAssumptions>(DEFAULT_ASSUMPTIONS);
  const rows = estimateTable(a);
  const field = (k: keyof EstimateAssumptions, label: string, step = '0.05') => (
    <label>
      <span className={styles.label}>{label}</span>
      <input className={styles.input} dir="ltr" type="number" step={step} value={a[k]} onChange={e => setA({ ...a, [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <details className={styles.card}>
      <summary className={styles.h2} style={{ cursor: 'pointer' }}>מחשבון עלות (הרצה יבשה)</summary>
      <div className={styles.stack} style={{ marginTop: 12 }}>
        <p className={styles.note}>
          מחירון {pricingNote.version}: DataForSEO <span className={styles.ltr}>${pricingNote.dfs.perRequestUsd} לבקשה + ${pricingNote.dfs.perItemUsd} לרשומה</span> (נבדק {pricingNote.dfsChecked}). {pricingNote.dfsNote} מחירי Google: {pricingNote.googleChecked === 'unverified' ? 'לא אומתו, לבדוק לפני הפעלה' : pricingNote.googleChecked}.
        </p>
        <div className={styles.editGrid}>
          {field('pageFullness', 'מילוי עמוד')}
          {field('duplicateShare', 'שיעור כפילויות')}
          {field('websiteShare', 'שיעור עם אתר')}
          {field('pagesPerSite', 'בקשות לאתר', '1')}
          {field('usableShare', 'שיעור שמיש לפרסום')}
          {field('googleCallsPerRecord', 'קריאות Google לעסק')}
          {field('photoShare', 'שיעור תמונות Google')}
          {field('llmShare', 'שיעור שנשלח ל־Claude')}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'start' }}>
              <th>עסקים</th><th>בקשות DataForSEO</th><th>DataForSEO</th><th>בקשות לאתרים</th><th>Google</th><th>תמונות</th><th>Claude</th><th>סה״כ</th><th>לעסק שמיש</th>
            </tr>
          </thead>
          <tbody className={styles.ltr}>
            {rows.map(r => (
              <tr key={r.businesses}>
                <td>{n(r.businesses)}</td><td>{n(r.dfsRequests)}</td><td>{usd(r.dfsUsd)}</td><td>{n(r.websiteRequests)}</td><td>{usd(r.googleUsd)}</td><td>{usd(r.photoUsd)}</td><td>{usd(r.llmUsd)}</td><td><b>{usd(r.totalUsd)}</b></td><td>{usd(r.perUsableUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.note}>ללא: מינימום טעינה של DataForSEO, מסים, אחסון ושרת, ניסיונות חוזרים. בקשות לאתרים ללא עלות לספק, רק זמן מחשב ותעבורה.</p>
      </div>
    </details>
  );
}

function Run({ r }: { r: RunRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const c = r.stats.counters ?? {};
  const b = r.byStatus;
  const staged = Object.values(b).reduce((s, x) => s + x, 0);
  const pct = r.budgetUsd ? Math.min(100, Math.round(((r.spentUsd + r.reservedUsd) / r.budgetUsd) * 100)) : Math.min(100, Math.round((r.requestsUsed / Math.max(1, r.maxRequests)) * 100));
  const act = (a: 'pause' | 'resume' | 'cancel' | 'kick' | 'retry') =>
    start(async () => {
      if (a === 'cancel' && !confirm('לבטל את הריצה? רשומות שנמצאו נשארות בתור הבדיקה.')) return;
      const res = await runControlAction(r.id, a);
      if (a === 'retry' && !res.count) setNote('אין רשומות חסרות להרצה חוזרת.');
      else if (res.dispatched === false) setNote('העובד לא הופעל אוטומטית. הפעילו את ה־workflow ב־GitHub.');
      else setNote(a === 'retry' ? `${res.count} רשומות נשלחו להשלמה חוזרת.` : '');
      router.refresh();
    });
  const reconcile = (taskId: string, billed: boolean, retry: boolean) =>
    start(async () => {
      await reconcileAction(taskId, billed, retry);
      router.refresh();
    });

  return (
    <article className={styles.card}>
      <div className={styles.runHead}>
        <span className={styles.runTitle}>{r.label}</span>
        <span className={styles.chip}>{r.provider === 'dataforseo' ? 'DataForSEO' : 'Google'}</span>
        <span className={`${styles.chip} ${STATUS_CHIP[r.status]}`}>{STATUS_NAME[r.status]}</span>
        <span className={styles.note}>{new Date(r.createdAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</span>
      </div>
      <div className={styles.note}>
        הוצאה: <span className={styles.ltr}>{usd(r.spentUsd)}{r.reservedUsd ? ` (+${usd(r.reservedUsd)} שמור)` : ''}{r.budgetUsd != null ? ` / ${usd(r.budgetUsd)}` : ''}</span>
        {r.recordLimit ? <> · עסקים: <span className={styles.ltr}>{n(staged)} / {n(r.recordLimit)}</span></> : null}
        {r.stats.budgetHit ? ' · הגיעה לתקרת ההוצאה' : ''}
        {r.stats.recordLimitReached ? ' · הגיעה למספר העסקים' : ''}
      </div>
      <div className={styles.bar} aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <div className={styles.counts}>
        <span>הוחזרו <b>{n(c.placesSeen ?? 0)}</b></span>
        <span>ייחודיים <b>{n(staged)}</b></span>
        <span>כפולים <b>{n(b.duplicate ?? 0)}</b></span>
        <span>אתרים נבדקו <b>{n(c.enriched ?? 0)}</b></span>
        <span>מוכנים <b>{n(b.ready ?? 0)}</b></span>
        <span>לבדיקה <b>{n(b.needs_review ?? 0)}</b></span>
        <span>חסרים <b>{n(b.incomplete ?? 0)}</b></span>
        <span>פורסמו <b>{n((b.approved ?? 0) + (b.merged ?? 0))}</b></span>
      </div>
      {Object.keys(r.noEmailBySite).length ? (
        <p className={styles.note}>
          בלי דוא״ל, לפי תוצאת האתר: {Object.entries(r.noEmailBySite).map(([k, v]) => `${SITE_NAME[k] ?? k} ${n(v)}`).join(' · ')}
        </p>
      ) : null}
      {Object.keys(r.spend).length ? (
        <p className={styles.note}>
          לפי ספק: {Object.entries(r.spend).map(([k, v]) => `${k} ${v.calls} קריאות, הערכה ${usd(v.estimatedUsd)}, בפועל ${usd(v.actualUsd)}${v.uncertain ? `, ${v.uncertain} לא ודאיות` : ''}`).join(' · ')}
        </p>
      ) : null}
      {r.error ? <p className={styles.error}>{r.error}</p> : null}
      {r.reconcile.length ? (
        <div className={styles.panel}>
          <p>בקשות בתשלום בלי תשובה ודאית. בדקו ביומן השימוש של הספק, ואז:</p>
          {r.reconcile.map(t => (
            <div key={t.id} className={styles.btnRow} style={{ alignItems: 'center', marginTop: 6 }}>
              <span className={styles.note}>{t.key} · עמוד {t.page} · {t.error}</span>
              <button type="button" className={styles.btn} disabled={pending} onClick={() => reconcile(t.id, true, false)}>חויב, לא לשלוח שוב</button>
              <button type="button" className={styles.btn} disabled={pending} onClick={() => reconcile(t.id, false, true)}>לא חויב, לשלוח שוב</button>
            </div>
          ))}
        </div>
      ) : null}
      {note ? <p className={styles.info}>{note}</p> : null}
      <div className={styles.btnRow}>
        <Link className={`${styles.btn} ${styles.teal}`} href={`/ops/import/review?run=${r.id}`}>לבדיקת הרשומות</Link>
        {r.status === 'queued' || r.status === 'running' ? (
          <>
            <button type="button" className={styles.btn} disabled={pending} onClick={() => act('pause')}>השהיה</button>
            <button type="button" className={styles.btn} disabled={pending} onClick={() => act('kick')}>הפעלת העובד</button>
          </>
        ) : null}
        {r.status === 'paused' || r.status === 'failed' ? <button type="button" className={styles.btn} disabled={pending} onClick={() => act('resume')}>המשך</button> : null}
        {r.status === 'done' || r.status === 'failed' ? <button type="button" className={styles.btn} disabled={pending} onClick={() => act('retry')}>השלמה חוזרת לרשומות החסרות</button> : null}
        {r.status !== 'done' && r.status !== 'canceled' ? <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={pending} onClick={() => act('cancel')}>ביטול</button> : null}
        <a className={styles.btn} href={`/ops/import/export?run=${r.id}&kind=canonical`}>ייצוא שדות מותרים</a>
        <a className={styles.btn} href={`/ops/import/export?run=${r.id}&kind=audit`}>דוח ביקורת</a>
      </div>
    </article>
  );
}

export function RunsView(props: {
  runs: RunRow[];
  settings: ImportSettings;
  canDispatch: boolean;
  dfsConfigured: boolean;
  googleAvailable: boolean;
  googleMonth: { usd: number; calls: number };
  pricingNote: { version: string; dfs: { perRequestUsd: number; perItemUsd: number }; dfsChecked: string; dfsNote: string; googleChecked: string };
}) {
  const router = useRouter();
  const live = props.runs.some(r => r.status === 'running' || r.status === 'queued');
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [live, router]);

  return (
    <div className={styles.grid2}>
      <div className={styles.stack}>
        <NewRun settings={props.settings} canDispatch={props.canDispatch} dfsConfigured={props.dfsConfigured} />
        <Settings settings={props.settings} googleAvailable={props.googleAvailable} googleMonth={props.googleMonth} />
        <Estimator pricingNote={props.pricingNote} />
      </div>
      <section className={styles.stack} aria-label="ריצות">
        {props.runs.length ? props.runs.map(r => <Run key={r.id} r={r} />) : <p className={`${styles.card} ${styles.empty}`}>עוד לא הופעלה ריצה.</p>}
      </section>
    </div>
  );
}
