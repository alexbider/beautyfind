'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { CATEGORIES, CITIES, MENU_REGION_ORDER, REGIONS } from '@/lib/catalog';
import { countRequestUsd, coverageIndex, pairsToCount, summarize, type CoverageCell, type CoverageSummary } from '@/lib/import/coverageCounts';
import { writerUsd } from '@/lib/import/enrichPlan';
import { DEFAULT_ASSUMPTIONS, estimateFor, estimateRun, estimateTable, type EstimateAssumptions } from '@/lib/import/estimate';
import { pricing } from '@/lib/import/pricing';
import type { RunScope } from '@/lib/import/rules';
import { runErrorKind } from '@/lib/import/runErrors';
import type { ImportSettings } from '@/lib/import/settings';
import { copyPendingImagesAction, deleteRunsAction, reconcileAction, runControlAction, startRunAction } from './actions';
import { Sources, type ServerFlags } from './Sources';
import { stageIndex, stagesFor } from './stages';
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
  stats: { counters?: Record<string, number>; budgetHit?: boolean; recordLimitReached?: boolean; stage?: string; readiness?: number | null; byProfileStatus?: Record<string, number>; apifyMissingToken?: boolean; listings?: number; plan?: Record<string, number> } & Record<string, unknown>;
  error: string | null;
  createdAt: string;
  byStatus: Record<string, number>;
  spend: Record<string, { estimatedUsd: number; actualUsd: number; calls: number; uncertain: number }>;
  noEmailBySite: Record<string, number>;
  reconcile: Array<{ id: string; key: string; error: string | null; page: number }>;
  places: number; // staged records that point at this run (a run with records cannot be deleted)
}

export interface PricingNote {
  version: string;
  dfs: { perRequestUsd: number; perItemUsd: number };
  dfsChecked: string;
  dfsNote: string;
  googleChecked: string;
  editorialUsd: number;
  apifyChecked: string;
}

const STATUS_NAME: Record<RunRow['status'], string> = { queued: 'ממתינה לעובד', running: 'רצה', paused: 'מושהית', done: 'הסתיימה', failed: 'נעצרה', canceled: 'בוטלה' };
const STATUS_CHIP: Record<RunRow['status'], string> = { queued: '', running: styles.chipOk, paused: styles.chipWarn, done: styles.chipOk, failed: styles.chipBad, canceled: '' };
const SITE_NAME: Record<string, string> = {
  no_website: 'אין אתר', no_email: 'אין דוא״ל באתר', blocked: 'האתר חסם', robots: 'robots.txt אוסר', failed: 'האתר לא נטען', unsafe: 'כתובת לא בטוחה',
  skipped_complete: 'לא נדרש', ok: 'נמצא אך לא נבחר', pending: 'טרם נבדק', not_modified: 'לא השתנה',
};
const n = (x: number) => x.toLocaleString('he-IL');
const usd = (x: number) => `$${x < 1 ? x.toFixed(3) : x.toFixed(2)}`;

/** "45 / 120" next to a city or category: the provider's total, what the import found, and whether the pair is covered. */
function Count({ s }: { s: CoverageSummary }) {
  if (!s.counted && !s.found) return null;
  if (!s.counted) return <span className={styles.chip} title="נמצאו בייבוא; הסך הכולל טרם נספר">{n(s.found)}</span>;
  const partial = s.counted < s.pairs;
  const title = `${n(s.found)} נמצאו מתוך ${n(s.total)} שהספק מונה${partial ? ` (${n(s.pairs - s.counted)} תחומים טרם נספרו)` : ''}${s.published ? `, ${n(s.published)} פורסמו` : ''}`;
  return (
    <span className={`${styles.chip} ${s.done ? styles.chipOk : s.found ? styles.chipWarn : ''}`} title={title}>
      {s.done ? '✓ ' : ''}{n(s.found)} / {n(s.total)}{partial ? '+' : ''}
    </span>
  );
}

function Scope({ all, setAll, cities, setCities, cats, setCats, coverage }: { all: boolean; setAll: (v: boolean) => void; cities: string[]; setCities: (v: string[]) => void; cats: string[]; setCats: (v: string[]) => void; coverage: CoverageCell[] }) {
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const allCats = cats.length === CATEGORIES.length;
  const index = useMemo(() => coverageIndex(coverage), [coverage]);
  const everyCity = useMemo(() => CITIES.map(c => c.slug), []);
  const catSum = (slug: string) => summarize(index, everyCity, [slug]);
  const citySum = (slug: string) => summarize(index, [slug], cats);
  return (
    <>
      <div>
        <div className={styles.btnRow} style={{ alignItems: 'center', marginBottom: 6 }}>
          <span className={styles.label} style={{ margin: 0, flex: 1 }}>תחומים <span className={styles.note}>(נמצאו / סך הכול בכל הערים)</span></span>
          <button type="button" className={styles.btn} style={{ minHeight: 30, padding: '3px 10px' }} onClick={() => setCats(allCats ? [] : CATEGORIES.map(c => c.slug))}>{allCats ? 'ניקוי' : 'כל התחומים'}</button>
        </div>
        <div className={styles.checks}>
          {CATEGORIES.map(c => (
            <label key={c.slug} className={styles.check}>
              <input type="checkbox" checked={cats.includes(c.slug)} onChange={() => toggle(cats, setCats, c.slug)} />
              {c.name}
              <Count s={catSum(c.slug)} />
            </label>
          ))}
        </div>
      </div>
      <div>
        <span className={styles.label}>אזור <span className={styles.note}>(ליד כל עיר: נמצאו / סך הכול בתחומים שנבחרו; ✓ כשהעיר כוסתה)</span></span>
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
                      <Count s={summarize(index, list.map(c => c.slug), cats)} />
                    </label>
                  </div>
                  <div className={styles.checks}>
                    {list.map(c => (
                      <label key={c.slug} className={styles.check}>
                        <input type="checkbox" checked={cities.includes(c.slug)} onChange={() => toggle(cities, setCities, c.slug)} />
                        {c.name}
                        <Count s={citySum(c.slug)} />
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

/** What one import run does, in order, with the sources it will actually use. */
function Plan({ settings, flags }: { settings: ImportSettings; flags: ServerFlags }) {
  const ws = settings.workerStatus ?? null;
  const st = (k: 'dataforseo' | 'anthropic' | 'openai' | 'apify' | 'youtube' | 'blob') => (ws ? (ws[k] ? 'ok' : 'missing') : 'unknown');
  const chip = (s: 'ok' | 'missing' | 'unknown' | 'off', optional = false) =>
    s === 'ok' ? <span className={`${styles.chip} ${styles.chipOk}`}>מחובר</span>
    : s === 'off' ? <span className={styles.chip}>כבוי בהגדרות</span>
    : s === 'unknown' ? <span className={styles.chip}>לא ידוע עד הריצה הראשונה</span>
    : <span className={`${styles.chip} ${optional ? '' : styles.chipWarn}`}>{optional ? 'ללא מפתח' : 'חסר מפתח'}</span>;
  const steps: Array<[string, string, React.ReactNode]> = [
    ['1', 'איתור העסקים ב־DataForSEO: שם, כתובת, טלפון, שעות, דירוג, תמונות, מאפיינים.', chip(settings.dataforseoEnabled ? st('dataforseo') : 'off')],
    ['2', 'קריאת האתר הרשמי של כל עסק: דוא״ל, שירותים ומחירים, שעות, צוות, סרטונים, תמונות.', <span key="s" className={`${styles.chip} ${styles.chipOk}`}>ללא עלות</span>],
    ['3', 'למה שעדיין חסר: Google Maps, הפייסבוק והאינסטגרם של העסק, ודפדפן לאתרים שלא נטענו (Apify).', chip(settings.apifyEnabled ? st('apify') : 'off')],
    ['4', 'למה שעדיין חסר אחרי זה: ChatGPT מחפש ברשת (אתר, טלפון, דוא״ל, שעות, שירותים ומחירים, צוות, שנת הקמה, נגישות) ומחזיר כל עובדה עם העמוד שממנו נקראה.', chip(settings.openaiEnabled && settings.researchEnabled ? st('openai') : 'off')],
    ['5', 'תמונות מפוסטים בפרופיל Google לעסקים עם פחות מחמש תמונות.', chip(settings.googlePostPhotos && settings.dataforseoEnabled ? st('dataforseo') : 'off')],
    ['6', `כתיבת התיאור, השאלות הנפוצות והכותרות מכל הראיות (${settings.llmProvider === 'openai' ? 'ChatGPT' : 'Claude'}, קריאה אחת לעסק).`, chip(settings.editorialEnabled ? st(settings.llmProvider === 'openai' ? 'openai' : 'anthropic') : 'off')],
    ['7', 'סרטוני YouTube רשמיים.', chip(settings.youtubeEnabled ? (st('youtube') === 'missing' ? 'ok' : st('youtube')) : 'off')],
    ['8', 'בדיקות: כפילויות, עסקים קיימים, מינימום לפרסום. הרשומות מחכות לאישור בתור הבדיקה, ובאישור התמונות מועתקות לאחסון שלנו.', chip(flags.mapKey ? 'ok' : 'missing')],
  ];
  return (
    <ol style={{ margin: 0, paddingInlineStart: 18, fontSize: 13.5, display: 'grid', gap: 6 }}>
      {steps.map(([k, text, c]) => (
        <li key={k}>
          <span>{text}</span> {c}
        </li>
      ))}
    </ol>
  );
}

function NewRun({ settings, flags, pricingNote, coverage }: { settings: ImportSettings; flags: ServerFlags; pricingNote: PricingNote; coverage: CoverageCell[] }) {
  const router = useRouter();
  const [provider, setProvider] = useState<'dataforseo' | 'google'>('dataforseo');
  const [label, setLabel] = useState('');
  const [all, setAll] = useState(false);
  const [cities, setCities] = useState<string[]>([]);
  const [cats, setCats] = useState<string[]>(CATEGORIES.map(c => c.slug));
  const [limit, setLimit] = useState(String(settings.pilotRecordLimit));
  const [budgetOverride, setBudgetOverride] = useState('');
  const [autoPublish, setAutoPublish] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const scope: RunScope = { all, cities, categories: cats, nearby: provider === 'google', text: provider === 'google', autoPublish };
  const recordLimit = Math.max(1, Number(limit) || 0);
  // Gross ceiling for the whole run: discovery at a full page, Apify for the share that needs it, one editorial call per record.
  const est = useMemo(
    () => estimateFor(recordLimit, { ...DEFAULT_ASSUMPTIONS, pageSize: settings.dfsPageSize, duplicateShare: 0, usableShare: 1, editorialShare: settings.editorialEnabled ? 1 : 0, editorialRepairShare: 0.25, apifyShare: settings.apifyEnabled ? 0.8 : 0, researchShare: settings.openaiEnabled && settings.researchEnabled ? 0.7 : 0, writerUsd: writerUsd(pricing(), settings.llmProvider) }),
    [recordLimit, settings.dfsPageSize, settings.editorialEnabled, settings.apifyEnabled, settings.openaiEnabled, settings.researchEnabled, settings.llmProvider],
  );
  const legacy = useMemo(() => (provider === 'google' ? estimateRun(scope) : null), [provider, all, cities, cats]); // eslint-disable-line react-hooks/exhaustive-deps
  const budget = budgetOverride ? Number(budgetOverride) : Math.ceil(est.totalUsd * 1.2 * 100) / 100;
  const valid = cats.length > 0 && (all || cities.length > 0) && budget > 0 && !settings.killSwitch;

  // What the count says about the chosen cities and categories, and what a count of them would cost.
  const chosenCities = all ? CITIES.map(c => c.slug) : cities;
  const cover = useMemo(() => summarize(coverageIndex(coverage), chosenCities, cats), [coverage, chosenCities, cats]); // eslint-disable-line react-hooks/exhaustive-deps
  const toCount = useMemo(() => pairsToCount(coverage, chosenCities, cats, new Date(Date.now() - 30 * 86_400_000)).length, [coverage, chosenCities, cats]); // eslint-disable-line react-hooks/exhaustive-deps
  const countUsd = toCount * countRequestUsd(pricing());
  const remaining = Math.max(0, cover.total - cover.found);
  const [counting, startCount] = useTransition();
  const [countMsg, setCountMsg] = useState<string | null>(null);
  const count = (recount: boolean) =>
    startCount(async () => {
      setCountMsg(null);
      const pairs = recount ? chosenCities.length * cats.length : toCount;
      const r = await startRunAction({
        label: `ספירה: ${all ? 'כל הארץ' : chosenCities.map(c => CITIES.find(x => x.slug === c)?.name).join(', ')}`,
        provider: 'count',
        scope: { all, cities, categories: cats, recount },
        recordLimit: 1,
        budgetUsd: Math.ceil(pairs * countRequestUsd(pricing()) * 1.2 * 100) / 100 + 0.05,
      });
      setCountMsg(r.ok ? (r.dispatched ? 'הספירה התחילה. המספרים יופיעו ליד הערים והתחומים כשהיא מסתיימת.' : 'הספירה נוצרה ומחכה לעובד. הפעילו את ״Import worker״ ב־GitHub Actions.') : r.error === 'kill_switch' ? 'מתג החירום פעיל.' : r.error === 'provider_disabled' ? 'DataForSEO כבוי בהגדרות.' : 'לא הצלחנו ליצור את הספירה.');
      router.refresh();
    });

  const go = (preview: boolean) =>
    start(async () => {
      setMsg(null);
      const r = await startRunAction({
        label: (preview ? 'ניסיון: ' : '') + (label || (all ? 'כל הארץ' : cities.map(c => CITIES.find(x => x.slug === c)?.name).join(', '))),
        provider,
        scope,
        recordLimit: preview ? 10 : recordLimit,
        budgetUsd: preview ? Math.max(0.5, Math.min(budget, 2)) : budget,
      });
      if (!r.ok) return setMsg({ ok: false, text: r.error === 'kill_switch' ? 'מתג החירום פעיל. כבו אותו בכרטיס המקורות.' : r.error === 'provider_disabled' ? 'DataForSEO כבוי בהגדרות.' : 'לא הצלחנו ליצור את הריצה. בדקו את הבחירות.' });
      setMsg({ ok: true, text: r.dispatched ? 'הריצה התחילה. ההתקדמות מופיעה בכרטיס הריצה, וכשהיא מסתיימת הרשומות מחכות בתור הבדיקה.' : 'הריצה נוצרה ומחכה בתור. הפעילו את ה־workflow ״Import worker״ ב־GitHub Actions (או הוסיפו GITHUB_DISPATCH_TOKEN ב־Vercel כדי שזה יקרה לבד).' });
      router.refresh();
    });

  return (
    <section className={`${styles.card} ${styles.stack}`} aria-labelledby="new-run">
      <h2 id="new-run" className={styles.h2} style={{ margin: 0 }}>ייבוא חדש</h2>
      <p className={styles.note} style={{ margin: 0 }}>ריצה אחת עושה הכול: מאתרת עסקים, קוראת את האתרים, משלימה מ־Google Maps ומהרשתות, כותבת תיאור ושאלות, ובודקת. בסוף הרשומות מחכות לאישור בתור הבדיקה, מלאות ככל שהמקורות מאפשרים.</p>
      <details>
        <summary className={styles.label} style={{ cursor: 'pointer' }}>מה הריצה עושה, שלב אחרי שלב</summary>
        <div style={{ marginTop: 8 }}><Plan settings={settings} flags={flags} /></div>
      </details>
      <label>
        <span className={styles.label}>שם הריצה (רשות)</span>
        <input className={styles.input} value={label} onChange={e => setLabel(e.target.value)} maxLength={80} placeholder="לדוגמה: חיפה, ציפורניים" />
      </label>
      <Scope all={all} setAll={setAll} cities={cities} setCities={setCities} cats={cats} setCats={setCats} coverage={coverage} />
      <div className={styles.panel} style={{ background: '#F1F5F7' }}>
        {cover.counted ? (
          <p>
            לפי הספירה: <b>{n(cover.total)}</b> עסקים בערים ובתחומים שנבחרו{cover.counted < cover.pairs ? ` (${n(cover.pairs - cover.counted)} צירופי עיר ותחום טרם נספרו)` : ''}, מהם <b>{n(cover.found)}</b> כבר נמצאו ו־<b>{n(cover.published)}</b> פורסמו.
            {cover.done ? ' הבחירה הזו כבר כוסתה; ריצה נוספת תרענן את הרשומות הקיימות ולא תוסיף הרבה.' : remaining > 0 ? ` נשארו כ־${n(remaining)}.` : ''}
          </p>
        ) : (
          <p>עוד לא נספר כמה עסקים יש בערים ובתחומים האלה. הספירה שואלת את DataForSEO פעם אחת לכל צירוף של עיר ותחום ומציגה את המספר ליד כל עיר, כדי שלא נריץ את אותה עיר ואותו תחום פעמיים.</p>
        )}
        <div className={styles.btnRow} style={{ alignItems: 'center' }}>
          {toCount > 0 ? (
            <button type="button" className={styles.btn} disabled={counting || !valid} onClick={() => count(false)}>{counting ? 'יוצרים…' : `ספירת עסקים (${n(toCount)} בקשות, ${usd(countUsd)})`}</button>
          ) : (
            <button type="button" className={styles.btn} disabled={counting || !valid} onClick={() => count(true)}>{counting ? 'יוצרים…' : `ספירה מחדש (${n(chosenCities.length * cats.length)} בקשות, ${usd(chosenCities.length * cats.length * countRequestUsd(pricing()))})`}</button>
          )}
          {remaining > 0 && String(remaining) !== limit ? <button type="button" className={styles.btn} onClick={() => setLimit(String(remaining))}>להגדיר {n(remaining)} עסקים לפי מה שנשאר</button> : null}
        </div>
        {countMsg ? <p style={{ margin: '6px 0 0' }}>{countMsg}</p> : null}
      </div>
      <label>
        <span className={styles.label}>כמה עסקים ייחודיים</span>
        <input className={styles.input} inputMode="numeric" dir="ltr" value={limit} onChange={e => setLimit(e.target.value.replace(/\D/g, ''))} />
      </label>
      <div className={styles.estimate} aria-live="polite">
        {provider === 'google' ? (
          <>
            <div>קריאות Google (הערכה)<b className={styles.ltr}>{n(legacy!.min)}–{n(legacy!.likely)}</b></div>
            <div>עלות משוערת<b className={styles.ltr}>${n(legacy!.usdMin)}–${n(legacy!.usdLikely)}</b></div>
          </>
        ) : (
          <>
            <div>DataForSEO<b className={styles.ltr}>{usd(est.dfsUsd)}</b></div>
            <div>Apify<b className={styles.ltr}>{usd(est.apifyUsd)}</b></div>
            <div>ChatGPT: מחקר וכתיבה<b className={styles.ltr}>{usd(est.researchUsd + est.editorialUsd)}</b></div>
            <div>תקרה לריצה<b className={styles.ltr}>{usd(budget)}</b></div>
          </>
        )}
      </div>
      <p className={styles.note} style={{ margin: 0 }}>
        עלות מקסימלית ברוטו לפי המחירון ({pricingNote.version}); בפועל משלמים לפי הדיווח של כל ספק, והכתיבה חוזרת על עצמה רק כשהראיות השתנו. הריצה נעצרת לפני קריאה שתעבור את התקרה וממשיכה עם מה שנמצא.
        {pricingNote.apifyChecked === 'unverified' ? ' מחירי Apify לא אומתו מול דפי ה־actors.' : ''}
      </p>
      <details>
        <summary className={styles.label} style={{ cursor: 'pointer' }}>אפשרויות נוספות</summary>
        <div className={styles.stack} style={{ marginTop: 8 }}>
          <label className={styles.check}><input type="checkbox" checked={autoPublish} onChange={e => setAutoPublish(e.target.checked)} />פרסום אוטומטי של רשומות שעברו את כל הבדיקות (בלי מבט של אדם). מה שדורש בדיקה נשאר בתור.</label>
          <label>
            <span className={styles.label}>תקרת הוצאה ידנית (USD, במקום החישוב)</span>
            <input className={styles.input} inputMode="decimal" dir="ltr" value={budgetOverride} onChange={e => setBudgetOverride(e.target.value.replace(/[^\d.]/g, ''))} placeholder={String(budget)} />
          </label>
          <div>
            <span className={styles.label}>מקור האיתור</span>
            <div className={styles.checks}>
              <label className={styles.check}><input type="radio" name="prov" checked={provider === 'dataforseo'} onChange={() => setProvider('dataforseo')} />DataForSEO (ברירת מחדל)</label>
              <label className={styles.check}><input type="radio" name="prov" checked={provider === 'google'} onChange={() => setProvider('google')} />Google Places, חיפוש במפה (ישן, יקר)</label>
            </div>
          </div>
        </div>
      </details>
      {settings.workerStatus && !settings.workerStatus.dataforseo && provider === 'dataforseo' ? <p className={styles.error} style={{ margin: 0 }}>לעובד אין פרטי DataForSEO. הוסיפו DATAFORSEO_LOGIN ו־DATAFORSEO_PASSWORD ב־GitHub Actions לפני שמתחילים.</p> : null}
      {!flags.canDispatch ? <p className={styles.info} style={{ margin: 0 }}>אין הפעלה אוטומטית של העובד (GITHUB_DISPATCH_TOKEN ב־Vercel). אחרי יצירת הריצה הפעילו את ״Import worker״ ב־GitHub Actions.</p> : null}
      {msg ? <p className={msg.ok ? styles.info : styles.error} role="status" style={{ margin: 0 }}>{msg.text}</p> : null}
      <div className={styles.btnRow}>
        <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={!valid || pending} onClick={() => go(false)}>{pending ? 'יוצרים…' : `התחלת ייבוא (${n(recordLimit)} עסקים)`}</button>
        <button type="button" className={styles.btn} disabled={!valid || pending} onClick={() => go(true)}>ניסיון על 10 עסקים</button>
      </div>
    </section>
  );
}

function Estimator({ pricingNote }: { pricingNote: PricingNote }) {
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
      <summary className={styles.h2} style={{ cursor: 'pointer', margin: 0 }}>מחשבון עלות לריצות גדולות</summary>
      <div className={styles.stack} style={{ marginTop: 12 }}>
        <p className={styles.note}>
          מחירון {pricingNote.version}: DataForSEO <span className={styles.ltr}>${pricingNote.dfs.perRequestUsd} לבקשה + ${pricingNote.dfs.perItemUsd} לרשומה</span> (נבדק {pricingNote.dfsChecked}). {pricingNote.dfsNote}
        </p>
        <div className={styles.editGrid}>
          {field('pageFullness', 'מילוי עמוד')}
          {field('duplicateShare', 'שיעור כפילויות')}
          {field('websiteShare', 'שיעור עם אתר')}
          {field('pagesPerSite', 'בקשות לאתר', '1')}
          {field('usableShare', 'שיעור שמיש לפרסום')}
          {field('editorialShare', 'שיעור עם כתיבת תיאור')}
          {field('editorialRepairShare', 'שיעור עם תיקון')}
          {field('apifyShare', 'שיעור שצריך Apify')}
          {field('researchShare', 'שיעור שנשלח למחקר ChatGPT')}
          {field('writerUsd', 'עלות כתיבה לעסק (USD)', '0.001')}
          {field('photosPerProfile', 'תמונות לעסק', '1')}
          {field('videoShare', 'שיעור עם סרטונים')}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'start' }}>
              <th>עסקים</th><th>DataForSEO</th><th>Apify</th><th>מחקר ChatGPT</th><th>כתיבה</th><th>אחסון (MB)</th><th>סה״כ</th><th>לעסק</th>
            </tr>
          </thead>
          <tbody className={styles.ltr}>
            {rows.map(r => (
              <tr key={r.businesses}>
                <td>{n(r.businesses)}</td><td>{usd(r.dfsUsd)}</td><td>{usd(r.apifyUsd)}</td><td>{usd(r.researchUsd)}</td><td>{usd(r.editorialUsd)}</td><td>{n(r.storageMb)}</td><td><b>{usd(r.totalUsd)}</b></td><td>{usd(r.perUsableUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.note}>הכתיבה לפי ״עלות כתיבה לעסק״ (ברירת המחדל: ChatGPT, כחצי סנט לעסק; Claude Sonnet כ־<span className={styles.ltr}>${pricingNote.editorialUsd}</span>), תיקון אחד לכל היותר, ומסולקת לפי הטוקנים בפועל. ללא: מינימום טעינה של DataForSEO, מסים, ניסיונות חוזרים. YouTube ו־Maps Embed ללא חיוב.</p>
      </div>
    </details>
  );
}

const FILLED: Record<string, string> = {
  phone: 'טלפון', whatsapp: 'וואטסאפ', email: 'דוא״ל', website: 'אתר', instagram: 'אינסטגרם', hours: 'שעות', description: 'תיאור', faqs: 'שאלות נפוצות',
  accessible: 'נגישות', parking: 'חניה', waze: 'Waze', google_profile: 'פרופיל Google', rating: 'דירוג Google', logo: 'לוגו', cover: 'תמונת שער',
  gallery: 'גלריה', categories: 'תחומים', services: 'טיפולים', prices: 'מחירים', team: 'צוות', videos: 'סרטונים', languages: 'שפות', established: 'שנת הקמה',
  facebook: 'פייסבוק', tiktok: 'טיקטוק', youtube: 'יוטיוב',
};
const PROFILE_STATUS: Record<string, string> = { ready: 'מלאים', ready_with_disclosed_gaps: 'מלאים עם פערים גלויים', needs_owner_information: 'חסר מידע מבעל העסק', needs_review: 'דורשים בדיקה' };
const APIFY_KIND: Record<string, string> = { maps: 'Maps', facebook: 'פייסבוק', instagram: 'אינסטגרם', render: 'דפדפן' };

function Stages({ r }: { r: RunRow }) {
  const list = stagesFor(r.provider);
  const cur = stageIndex(r.provider, r.stats.stage, r.status);
  const stopped = r.status === 'failed' || r.status === 'paused' || r.status === 'canceled';
  return (
    <ol className={styles.stages} aria-label="שלבי הריצה">
      {list.map((s, i) => (
        <li key={s.id} className={i < cur || (i === cur && r.status === 'done') ? styles.stageDone : i === cur ? (stopped ? styles.stageStopped : styles.stageNow) : ''} aria-current={i === cur && r.status !== 'done' ? 'step' : undefined}>
          {s.name}
        </li>
      ))}
    </ol>
  );
}

function Run({ r }: { r: RunRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const c = r.stats.counters ?? {};
  const b = r.byStatus;
  const staged = Object.values(b).reduce((s, x) => s + x, 0);
  const errorKind = runErrorKind(r.error);
  const canDelete = r.status !== 'running' && r.places === 0;
  const del = () =>
    start(async () => {
      if (!confirm('למחוק את הריצה? המשימות והסטטיסטיקה שלה נמחקות; נתונים שכבר נכנסו לעסקים נשארים.')) return;
      const res = await deleteRunsAction([r.id]);
      setNote(res.ok && res.deleted ? 'הריצה נמחקה.' : res.skipped[0]?.error === 'running' ? 'הריצה רצה כרגע. השהו או בטלו אותה קודם.' : res.skipped[0]?.error === 'has_records' ? 'לריצה יש רשומות בתור הבדיקה, אי אפשר למחוק אותה.' : 'המחיקה נכשלה.');
      router.refresh();
    });
  const act = (a: 'pause' | 'resume' | 'cancel' | 'kick' | 'retry' | 'recover') =>
    start(async () => {
      if (a === 'cancel' && !confirm('לבטל את הריצה? רשומות שנמצאו נשארות בתור הבדיקה.')) return;
      let extra: { budgetUsd?: number } = {};
      if (a === 'recover' && errorKind === 'budget') {
        const v = prompt('תקרה חדשה לריצה (USD)', String(Math.max(1, Math.ceil((r.budgetUsd ?? 1) * 2))));
        if (v === null) return;
        extra = { budgetUsd: Number(v) || undefined };
      }
      const res = await runControlAction(r.id, a, extra);
      if (a === 'recover') setNote(res.ok ? `הריצה חזרה לתור: ${res.recovered?.tasks ?? 0} משימות ו־${res.recovered?.editorial ?? 0} טיוטות יחזרו לעיבוד${res.dispatched === false ? '. העובד לא הופעל אוטומטית, הפעילו אותו ב־GitHub.' : '.'}` : 'השחזור נכשל.');
      else if (a === 'retry' && !res.count) setNote('אין רשומות חסרות להרצה חוזרת.');
      else if (res.dispatched === false) setNote('העובד לא הופעל אוטומטית. הפעילו את ה־workflow ב־GitHub.');
      else setNote(a === 'retry' ? `${res.count} רשומות נשלחו להשלמה חוזרת.` : '');
      router.refresh();
    });
  const reconcile = (taskId: string, billed: boolean, retry: boolean) =>
    start(async () => {
      await reconcileAction(taskId, billed, retry);
      router.refresh();
    });
  const enhance = r.provider === 'enhance';
  const filled = Object.entries(c).filter(([k]) => k.startsWith('filled_') && k !== 'filled_images_waiting_for_storage');
  const profile = r.stats.byProfileStatus ?? {};
  const apifyLine = c.apifyRuns ? ` · Apify: ${n(c.apifyRuns)} הרצות (${Object.keys(APIFY_KIND).filter(k => c[`apify_${k}_matched`]).map(k => `${APIFY_KIND[k]} ${n(c[`apify_${k}_matched`])}`).join(', ') || 'ללא עדכונים'})` : '';

  return (
    <article className={styles.card} id={`run-${r.id}`}>
      <div className={styles.runHead}>
        <span className={styles.runTitle}>{r.label}</span>
        <span className={styles.chip}>{r.provider === 'dataforseo' ? 'ייבוא' : enhance ? 'השלמה' : r.provider === 'count' ? 'ספירה' : 'Google (ישן)'}</span>
        <span className={`${styles.chip} ${STATUS_CHIP[r.status]}`}>{STATUS_NAME[r.status]}</span>
        <span className={styles.note}>{new Date(r.createdAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</span>
      </div>
      <Stages r={r} />
      {r.provider === 'count' ? (
        <p className={styles.note} style={{ margin: '8px 0 0' }}>
          נספרו {n(c.counted ?? 0)} מתוך {n(Number(r.stats.seededTasks ?? 0))} צירופי עיר ותחום · {n(c.businesses ?? 0)} עסקים אצל הספק
          {Number(r.stats.skippedFresh ?? 0) ? ` · ${n(Number(r.stats.skippedFresh))} נספרו בחודש האחרון ודולגו` : ''}
          {c.tasksFailed ? ` · נכשלו ${n(c.tasksFailed)}` : ''}
        </p>
      ) : enhance ? (
        <p className={styles.note} style={{ margin: '8px 0 0' }}>
          עסקים {n(Number(r.stats.listings ?? 0))} · שופרו {n(c.improved ?? 0)} · אין מה להוסיף {n(c.nothing_to_add ?? 0)}
          {c.refreshed ? ` · רועננו מ־DataForSEO ${n(c.refreshed)}` : ''}
          {filled.length ? ` · מולאו: ${filled.map(([k, v]) => `${FILLED[k.slice(7)] ?? k.slice(7)} ${n(v)}`).join(', ')}` : ''}
          {c.filled_images_waiting_for_storage ? ` · ${n(c.filled_images_waiting_for_storage)} עסקים מחכים להעתקת תמונות (כפתור בטאב ההשלמות)` : ''}
          {c.failed ? ` · נכשלו ${n(c.failed)}` : ''}
          {c.editorialCalls ? ` · כתיבה: ${n(c.editorialCalls)} קריאות (${n(c.editorial_written ?? 0)} נכתבו, ${n(c.editorial_cached ?? 0)} מהמטמון)` : ''}
          {apifyLine}
          {r.stats.apifyMissingToken ? ' · APIFY_TOKEN לא מוגדר, צעדי Apify דולגו' : ''}
        </p>
      ) : (
        <>
          <div className={styles.counts} style={{ marginTop: 8 }}>
            <span>נמצאו <b>{n(staged)}</b>{r.recordLimit ? ` / ${n(r.recordLimit)}` : ''}</span>
            <span>מוכנים לאישור <b>{n(b.ready ?? 0)}</b></span>
            <span>דורשים מבט <b>{n(b.needs_review ?? 0)}</b></span>
            <span>חסר טלפון או דוא״ל <b>{n(b.incomplete ?? 0)}</b></span>
            <span>כפולים <b>{n(b.duplicate ?? 0)}</b></span>
            <span>פורסמו <b>{n((b.approved ?? 0) + (b.merged ?? 0))}</b></span>
            {r.stats.readiness != null ? <span>מוכנות ממוצעת <b>{n(r.stats.readiness)}%</b></span> : null}
          </div>
          {Object.keys(profile).length ? <p className={styles.note} style={{ margin: '0 0 6px' }}>לפי התבנית: {Object.entries(profile).filter(([, v]) => v).map(([k, v]) => `${PROFILE_STATUS[k] ?? k} ${n(v)}`).join(' · ')}</p> : null}
          <p className={styles.note} style={{ margin: 0 }}>
            אתרים נקראו {n(c.enriched ?? 0)}{apifyLine}
            {c.editorialCalls ? ` · כתיבה: ${n(c.editorialCalls)} קריאות` : ''}{c.postPhotos ? ` · תמונות מפוסטים ${n(c.postPhotos)}` : ''}{c.autoPublished ? ` · פורסמו אוטומטית ${n(c.autoPublished)}` : ''}
            {r.stats.apifyMissingToken ? ' · APIFY_TOKEN לא מוגדר, צעדי Apify דולגו' : ''}
          </p>
        </>
      )}
      <p className={styles.note} style={{ margin: '6px 0 0' }}>
        הוצאה: <span className={styles.ltr}>{usd(r.spentUsd)}{r.reservedUsd ? ` (+${usd(r.reservedUsd)} שמור)` : ''}{r.budgetUsd != null ? ` / ${usd(r.budgetUsd)}` : ''}</span>
        {r.stats.budgetHit ? ' · הגיעה לתקרת ההוצאה' : ''}{r.stats.recordLimitReached ? ' · הגיעה למספר העסקים' : ''}
        {Object.keys(r.spend).length ? ` · ${Object.entries(r.spend).map(([k, v]) => `${k} ${usd(v.actualUsd)}${v.uncertain ? ` (${v.uncertain} לא ודאיות)` : ''}`).join(', ')}` : ''}
      </p>
      {r.error ? (
        <div className={styles.error}>
          <p style={{ margin: 0 }}>{r.error}</p>
          <p style={{ margin: '6px 0 0' }}>
            {errorKind === 'funds' ? 'נגמר הקרדיט אצל הספק. טענו את החשבון (DataForSEO, Apify או Anthropic) ולחצו ״המשך אחרי טעינת קרדיט״.'
              : errorKind === 'auth' ? 'בעיית מפתח אצל הספק. תקנו את הסוד ב־GitHub Actions ולחצו ״המשך״.'
              : errorKind === 'budget' ? 'הריצה הגיעה לתקרת ההוצאה שלה. ״המשך״ מאפשר להגדיל את התקרה.'
              : 'הריצה נעצרה. ״המשך״ מחזיר אותה לתור מאותה נקודה.'}
          </p>
        </div>
      ) : null}
      {r.reconcile.length ? (
        <div className={styles.panel}>
          <p>בקשות בתשלום בלי תשובה ודאית. בדקו ביומן השימוש של הספק, ואז:</p>
          {r.reconcile.map(t => (
            <div key={t.id} className={styles.btnRow} style={{ alignItems: 'center', marginTop: 6 }}>
              <span className={styles.note}>{t.key} · {t.error}</span>
              <button type="button" className={styles.btn} disabled={pending} onClick={() => reconcile(t.id, true, false)}>חויב, לא לשלוח שוב</button>
              <button type="button" className={styles.btn} disabled={pending} onClick={() => reconcile(t.id, false, true)}>לא חויב, לשלוח שוב</button>
            </div>
          ))}
        </div>
      ) : null}
      {note ? <p className={styles.info}>{note}</p> : null}
      <div className={styles.btnRow} style={{ marginTop: 10 }}>
        {enhance ? <Link className={`${styles.btn} ${styles.teal}`} href="/ops/import/enrich">לאצוות ההשלמה</Link> : r.provider === 'count' ? null : <Link className={`${styles.btn} ${styles.teal}`} href={`/ops/import/review?run=${r.id}`}>לבדיקת הרשומות</Link>}
        {r.status === 'queued' || r.status === 'running' ? (
          <>
            <button type="button" className={styles.btn} disabled={pending} onClick={() => act('pause')}>השהיה</button>
            {r.status === 'queued' ? <button type="button" className={styles.btn} disabled={pending} onClick={() => act('kick')}>הפעלת העובד</button> : null}
          </>
        ) : null}
        {r.status === 'paused' || r.status === 'failed' || (r.status === 'done' && r.error) ? (
          <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={pending} onClick={() => act('recover')}>
            {errorKind === 'funds' ? 'המשך אחרי טעינת קרדיט' : errorKind === 'budget' ? 'הגדלת התקרה והמשך' : 'המשך מאותה נקודה'}
          </button>
        ) : null}
        {r.status !== 'done' && r.status !== 'canceled' && r.status !== 'failed' ? <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={pending} onClick={() => act('cancel')}>ביטול</button> : null}
      </div>
      <details style={{ marginTop: 8 }}>
        <summary className={styles.note} style={{ cursor: 'pointer' }}>עוד פעולות ופרטים</summary>
        <div className={styles.stack} style={{ marginTop: 8 }}>
          {Object.keys(r.noEmailBySite).length ? <p className={styles.note} style={{ margin: 0 }}>בלי דוא״ל, לפי תוצאת האתר: {Object.entries(r.noEmailBySite).map(([k, v]) => `${SITE_NAME[k] ?? k} ${n(v)}`).join(' · ')}</p> : null}
          {Object.keys(r.spend).length ? <p className={styles.note} style={{ margin: 0 }}>לפי ספק: {Object.entries(r.spend).map(([k, v]) => `${k} ${v.calls} קריאות, הערכה ${usd(v.estimatedUsd)}, בפועל ${usd(v.actualUsd)}`).join(' · ')}</p> : null}
          {Array.isArray(r.stats.failures) && (r.stats.failures as string[]).length ? <p className={styles.note} style={{ margin: 0 }}>סיבות כישלון: {(r.stats.failures as string[]).slice(0, 3).join(' | ')}</p> : null}
          <div className={styles.btnRow}>
            {!enhance && r.provider !== 'count' && (r.status === 'done' || r.status === 'failed') ? <button type="button" className={styles.btn} disabled={pending} onClick={() => act('retry')}>השלמה חוזרת לרשומות החסרות</button> : null}
            {!enhance && r.provider !== 'count' ? <a className={styles.btn} href={`/ops/import/export?run=${r.id}&kind=canonical`}>ייצוא שדות מותרים</a> : null}
            <a className={styles.btn} href={`/ops/import/export?run=${r.id}&kind=audit`}>דוח ביקורת</a>
            {canDelete ? <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={pending} onClick={del}>מחיקת הריצה</button> : null}
          </div>
        </div>
      </details>
    </article>
  );
}

function Published({ eligible, pendingImages }: { eligible: number; pendingImages: number }) {
  const router = useRouter();
  const [copying, setCopying] = useState<{ done: number; logos: number; covers: number; left: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const copyImages = async () => {
    setBusy(true);
    let total = { done: 0, logos: 0, covers: 0, left: pendingImages };
    setCopying(total);
    for (let i = 0; i < 200; i++) {
      const r = await copyPendingImagesAction();
      if (!r.ok) break;
      total = { done: total.done + r.done, logos: total.logos + r.logos, covers: total.covers + r.covers, left: r.left };
      setCopying(total);
      if (!r.done || !r.left) break;
    }
    setBusy(false);
    router.refresh();
  };
  return (
    <section className={`${styles.card} ${styles.stack}`} aria-labelledby="published-h">
      <h2 id="published-h" className={styles.h2} style={{ margin: 0 }}>עסקים שכבר פורסמו</h2>
      <p className={styles.note} style={{ margin: 0 }}><span className={styles.ltr}>{n(eligible)}</span> עסקים מהייבוא פורסמו ועדיין לא נתבעו. טאב ההשלמות מראה לכל אחד מה חסר ואיזה מקור יכול להשלים, ומריץ את זה באצוות.</p>
      {pendingImages > 0 || copying ? (
        <div className={styles.panel}>
          <p>{copying ? `הועתקו תמונות ל־${n(copying.done)} עסקים (${n(copying.logos)} לוגו, ${n(copying.covers)} תמונות שער). נשארו ${n(copying.left)}.` : `${n(pendingImages)} עסקים מחכים ללוגו ותמונות שכבר נמצאו.`}</p>
          <button type="button" className={`${styles.btn} ${styles.teal}`} disabled={busy || (!!copying && !copying.left)} onClick={copyImages}>{busy ? 'מעתיקים…' : 'העתקת התמונות לעסקים'}</button>
        </div>
      ) : null}
      <div className={styles.btnRow}>
        <Link href="/ops/import/enrich" className={`${styles.btn} ${styles.primary}`}>להשלמות ואצוות</Link>
      </div>
    </section>
  );
}

export function RunsView(props: { runs: RunRow[]; settings: ImportSettings; flags: ServerFlags; pricingNote: PricingNote; enhanceEligible: number; pendingImages: number; coverage: CoverageCell[] }) {
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
        <NewRun settings={props.settings} flags={props.flags} pricingNote={props.pricingNote} coverage={props.coverage} />
        <Published eligible={props.enhanceEligible} pendingImages={props.pendingImages} />
        <Sources settings={props.settings} flags={props.flags} />
        <Estimator pricingNote={props.pricingNote} />
      </div>
      <section className={styles.stack} aria-label="ריצות">
        {props.runs.length ? props.runs.map(r => <Run key={r.id} r={r} />) : <p className={`${styles.card} ${styles.empty}`}>עוד לא הופעלה ריצה. התחילו בניסיון על 10 עסקים.</p>}
      </section>
    </div>
  );
}
