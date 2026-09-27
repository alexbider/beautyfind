'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { CATEGORIES } from '@/lib/catalog';
import { SECTION_NAME, STATUS_NAME, type ProfileStatus } from '@/lib/import/coverage';
import { STEP_HINT, STEP_NAME, STEP_ORDER, type StepId } from '@/lib/import/enrichPlan';
import type { EnrichRow } from '@/lib/server/enrichQueue';
import { copyPendingImagesAction, deleteRunsAction, enhanceListingsAction, runControlAction } from '../actions';
import styles from '../import.module.css';

const STATUS_CHIP: Record<ProfileStatus, string> = { ready: styles.chipOk, ready_with_disclosed_gaps: styles.chipOk, needs_owner_information: styles.chipWarn, needs_review: styles.chipBad };
const SITE: Record<string, string> = { ok: 'האתר נקרא', no_email: 'נקרא, בלי דוא״ל', blocked: 'האתר חסם', robots: 'robots.txt אוסר', failed: 'האתר לא נטען', unsafe: 'כתובת לא בטוחה', unrelated: 'אתר של עסק אחר', directory: 'אינדקס, לא אתר', social_profile: 'רשת חברתית', google_profile: 'רק פרופיל Google', no_website: 'אין אתר', not_modified: 'לא השתנה', skipped_complete: 'לא נדרש' };
const RUN_STATUS: Record<string, string> = { queued: 'ממתינה', running: 'רצה', paused: 'מושהית', done: 'הסתיימה', failed: 'נכשלה', canceled: 'בוטלה' };
const RUN_CHIP: Record<string, string> = { queued: '', running: styles.chipOk, paused: styles.chipWarn, done: styles.chipOk, failed: styles.chipBad, canceled: '' };
const STEP_SHORT: Record<StepId, string> = { dfs: 'DataForSEO', maps: 'Maps', facebook: 'פייסבוק', instagram: 'אינסטגרם', site: 'אתר', render: 'אתר בדפדפן', editorial: 'כתיבה', regenerate: 'כתיבה מחדש', images: 'תמונות' };
const catName = (s: string) => CATEGORIES.find(c => c.slug === s)?.name ?? s;
const usd = (x: number) => `$${x < 1 ? x.toFixed(3) : x.toFixed(2)}`;
const n = (x: number) => x.toLocaleString('he-IL');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('he-IL') : 'אף פעם');

export interface BatchRow {
  id: string;
  label: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  listings: number;
  steps: string[];
  auto: boolean;
  plan: Record<string, number>;
  focus: string[];
  tasks: { total: number; done: number; failed: number; reconcile: number };
  improved: number;
  nothing: number;
  failed: number;
  editorialWritten: number;
  apifyMatched: number;
  apifyRuns: number;
  apifyMissingToken: boolean;
  apifyBudgetHit: string | null;
  spentUsd: number;
  reservedUsd: number;
  budgetUsd: number | null;
  error: string | null;
  errorKind: 'funds' | 'auth' | 'budget' | 'other' | null;
  failures: string[];
}

interface Flags {
  apifyEnabled: boolean;
  apifyMaps: boolean;
  apifyFacebook: boolean;
  apifyInstagram: boolean;
  apifyRender: boolean;
  dataforseoEnabled: boolean;
  editorialEnabled: boolean;
  killSwitch: boolean;
  apifyBudgetUsd: number;
  editorialBudgetUsd: number;
}

const stepOn = (s: StepId, f: Flags) =>
  s === 'dfs' ? f.dataforseoEnabled
  : s === 'maps' ? f.apifyEnabled && f.apifyMaps
  : s === 'facebook' ? f.apifyEnabled && f.apifyFacebook
  : s === 'instagram' ? f.apifyEnabled && f.apifyInstagram
  : s === 'render' ? f.apifyEnabled && f.apifyRender
  : s === 'editorial' || s === 'regenerate' ? f.editorialEnabled
  : true;

function Batches({ batches, canDispatch }: { batches: BatchRow[]; canDispatch: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const live = batches.some(b => b.status === 'running' || b.status === 'queued');
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [live, router]);
  const deletable = (b: BatchRow) => b.status !== 'running';
  const toggle = (id: string) => setPicked(s => {
    const x = new Set(s);
    if (x.has(id)) x.delete(id);
    else x.add(id);
    return x;
  });
  const del = (ids: string[]) =>
    start(async () => {
      if (!confirm(ids.length === 1 ? 'למחוק את האצווה? הנתונים שכבר נכנסו לעסקים נשארים; נמחקים הריצה, המשימות והסטטיסטיקה שלה.' : `למחוק ${ids.length} אצוות? הנתונים שכבר נכנסו לעסקים נשארים.`)) return;
      const r = await deleteRunsAction(ids);
      setNote(r.ok ? `נמחקו ${r.deleted}${r.skipped.length ? `, ${r.skipped.length} לא נמחקו (${r.skipped.map(s => (s.error === 'running' ? 'רצה כרגע' : s.error === 'has_records' ? 'יש לה רשומות' : s.error)).join(', ')})` : ''}.` : 'המחיקה נכשלה.');
      setPicked(new Set());
      router.refresh();
    });
  const control = (b: BatchRow, a: 'pause' | 'resume' | 'cancel' | 'recover' | 'kick') =>
    start(async () => {
      if (a === 'cancel' && !confirm('לבטל את האצווה?')) return;
      let extra: { budgetUsd?: number } = {};
      if (a === 'recover' && b.errorKind === 'budget') {
        const v = prompt('תקרה חדשה לאצווה (USD)', String(Math.max(1, Math.ceil((b.budgetUsd ?? 1) * 2))));
        if (v === null) return;
        extra = { budgetUsd: Number(v) || undefined };
      }
      const r = await runControlAction(b.id, a, extra);
      setNote(!r.ok ? 'הפעולה נכשלה.' : r.dispatched === false && (a === 'resume' || a === 'recover' || a === 'kick') ? 'הריצה בתור. העובד לא הופעל אוטומטית, הפעילו אותו ב־GitHub.' : a === 'recover' ? `האצווה חזרה לתור (${r.recovered?.tasks ?? 0} משימות יחזרו לעיבוד).` : null);
      router.refresh();
    });
  const finished = batches.filter(deletable).map(b => b.id);
  return (
    <details className={styles.card} open={live}>
      <summary className={styles.h2} style={{ cursor: 'pointer' }}>אצוות העשרה ({n(batches.length)}{live ? ', יש ריצה פעילה' : ''})</summary>
      <div className={styles.stack} style={{ marginTop: 10 }}>
        <div className={styles.btnRow}>
          <button type="button" className={styles.btn} disabled={!finished.length} onClick={() => setPicked(picked.size === finished.length ? new Set() : new Set(finished))}>
            {picked.size === finished.length && finished.length ? 'ניקוי הבחירה' : `בחירת כל האצוות שהסתיימו (${n(finished.length)})`}
          </button>
          <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={pending || !picked.size} onClick={() => del([...picked])}>{`מחיקת ${n(picked.size)} אצוות`}</button>
          {!canDispatch ? <span className={styles.note}>בלי GITHUB_DISPATCH_TOKEN אצווה חדשה מחכה להפעלה ידנית של העובד.</span> : null}
        </div>
        {note ? <p className={styles.info} role="status">{note}</p> : null}
        {batches.length === 0 ? <p className={styles.note}>עוד לא הורצה אצווה מהטאב הזה.</p> : null}
        {batches.map(b => (
          <article key={b.id} className={styles.panel} style={{ background: '#F7F9FA' }}>
            <div className={styles.btnRow} style={{ alignItems: 'center' }}>
              <input type="checkbox" className={styles.pick} disabled={!deletable(b)} checked={picked.has(b.id)} onChange={() => toggle(b.id)} aria-label={`בחירת ${b.label}`} />
              <span style={{ fontWeight: 700, flex: 1, minWidth: 0 }}>{b.label}</span>
              <span className={`${styles.chip} ${RUN_CHIP[b.status] ?? ''}`}>{RUN_STATUS[b.status] ?? b.status}</span>
              {b.auto ? <span className={styles.chip}>אוטומטי לפי חוסרים</span> : null}
              <span className={styles.note}>{new Date(b.createdAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</span>
            </div>
            <div className={styles.reasons} style={{ margin: '6px 0' }}>
              {b.steps.map(s => <span key={s} className={styles.chip}>{STEP_SHORT[s as StepId] ?? s}{b.plan[s] != null ? ` ${n(b.plan[s])}` : ''}</span>)}
            </div>
            <p className={styles.note} style={{ margin: 0 }}>
              עסקים {n(b.listings)} · משימות {n(b.tasks.done)}/{n(b.tasks.total)}{b.tasks.failed ? ` (${n(b.tasks.failed)} נכשלו)` : ''}{b.tasks.reconcile ? ` (${n(b.tasks.reconcile)} להתאמה)` : ''} · שופרו {n(b.improved)} · אין מה להוסיף {n(b.nothing)}{b.failed ? ` · נכשלו ${n(b.failed)}` : ''}
              {b.editorialWritten ? ` · נכתבו ${n(b.editorialWritten)} תיאורים` : ''}{b.apifyRuns ? ` · Apify: ${n(b.apifyRuns)} הרצות, ${n(b.apifyMatched)} עסקים עודכנו` : ''}
              {' · '}הוצאה <span className={styles.ltr}>{usd(b.spentUsd)}{b.reservedUsd ? ` (+${usd(b.reservedUsd)})` : ''}{b.budgetUsd != null ? ` / ${usd(b.budgetUsd)}` : ''}</span>
            </p>
            {b.apifyMissingToken ? <p className={styles.error} style={{ margin: '6px 0 0' }}>APIFY_TOKEN לא מוגדר ב־GitHub Actions: צעדי Apify דולגו. הוסיפו את הסוד ולחצו ״המשך״.</p> : null}
            {b.apifyBudgetHit ? <p className={styles.note} style={{ margin: '6px 0 0' }}>תקרת Apify הושגה ({b.apifyBudgetHit}); חלק מהמשימות דולגו. אפשר להגדיל את התקרה בהגדרות ולהריץ שוב.</p> : null}
            {b.error ? <p className={styles.error} style={{ margin: '6px 0 0' }}>{b.error}{b.errorKind === 'funds' ? ' (נראה שנגמר הקרדיט אצל הספק; טענו ולחצו ״המשך״)' : b.errorKind === 'auth' ? ' (בעיית מפתח; תקנו את הסוד ולחצו ״המשך״)' : ''}</p> : null}
            {b.failures.length ? <p className={styles.note} style={{ margin: '4px 0 0' }}>סיבות: {b.failures.join(' | ')}</p> : null}
            <div className={styles.btnRow} style={{ marginTop: 8 }}>
              <Link className={styles.btn} href={`/ops/import#run-${b.id}`}>כרטיס הריצה</Link>
              {b.status === 'queued' || b.status === 'running' ? <button type="button" className={styles.btn} disabled={pending} onClick={() => control(b, 'pause')}>השהיה</button> : null}
              {b.status === 'queued' ? <button type="button" className={styles.btn} disabled={pending} onClick={() => control(b, 'kick')}>הפעלת העובד</button> : null}
              {b.status === 'paused' || b.status === 'failed' || (b.status === 'done' && (b.error || b.tasks.failed)) ? (
                <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={pending} onClick={() => control(b, 'recover')}>
                  {b.errorKind === 'funds' ? 'המשך אחרי טעינת קרדיט' : b.errorKind === 'budget' ? 'הגדלת התקרה והמשך' : 'המשך מאותה נקודה'}
                </button>
              ) : null}
              {b.status !== 'done' && b.status !== 'canceled' && b.status !== 'failed' ? <button type="button" className={styles.btn} disabled={pending} onClick={() => control(b, 'cancel')}>ביטול</button> : null}
              <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={pending || !deletable(b)} onClick={() => del([b.id])} title={deletable(b) ? '' : 'אצווה שרצה כרגע אי אפשר למחוק; השהו או בטלו אותה קודם'}>מחיקה</button>
            </div>
          </article>
        ))}
      </div>
    </details>
  );
}

export function EnrichList({ rows, allFiltered, focus, costs, flags, canDispatch, mapConfigured, batches }: {
  rows: EnrichRow[];
  allFiltered: Array<{ id: string; plan: StepId[] }>;
  focus: string[];
  costs: Record<StepId, number>;
  flags: Flags;
  canDispatch: boolean;
  mapConfigured: boolean;
  batches: BatchRow[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [auto, setAuto] = useState(true);
  const [steps, setSteps] = useState<Set<StepId>>(new Set(STEP_ORDER.filter(s => s !== 'regenerate')));
  const [label, setLabel] = useState('');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copy, setCopy] = useState<string | null>(null);

  const planOf = useMemo(() => new Map(allFiltered.map(x => [x.id, x.plan])), [allFiltered]);
  const toggle = (id: string) => setPicked(s => {
    const x = new Set(s);
    if (x.has(id)) x.delete(id);
    else x.add(id);
    return x;
  });
  const toggleStep = (s: StepId) => setSteps(cur => {
    const x = new Set(cur);
    if (x.has(s)) x.delete(s);
    else x.add(s);
    return x;
  });
  const count = picked.size;
  // What the batch would do: per step, how many of the chosen listings it touches and what it may cost.
  const est = useMemo(() => {
    const per = Object.fromEntries(STEP_ORDER.map(s => [s, { listings: 0, usd: 0 }])) as Record<StepId, { listings: number; usd: number }>;
    for (const id of picked) {
      const plan = planOf.get(id) ?? [];
      for (const s of STEP_ORDER) {
        if (!steps.has(s) || !stepOn(s, flags)) continue;
        const applies = auto ? plan.includes(s) || (s === 'regenerate' && plan.includes('editorial')) : true;
        if (!applies) continue;
        per[s].listings++;
        per[s].usd += costs[s];
      }
    }
    return { per, total: Object.values(per).reduce((a, x) => a + x.usd, 0) };
  }, [picked, steps, auto, planOf, costs, flags]);
  const stepsChosen = STEP_ORDER.filter(s => steps.has(s));

  const go = () =>
    start(async () => {
      setMsg(null);
      const r = await enhanceListingsAction([...picked], { steps: stepsChosen, auto, label, focus });
      if (!r.ok) return setMsg({ ok: false, text: r.error === 'kill_switch' ? 'מתג החירום פעיל. כבו אותו בהגדרות.' : 'לא הצלחנו ליצור את האצווה.' });
      if (!r.count) return setMsg({ ok: false, text: 'אף אחד מהעסקים שנבחרו אינו עסק מפורסם מהייבוא.' });
      setMsg({ ok: true, text: `אצווה של ${n(r.count)} עסקים נוצרה (תקרה ${usd(r.budgetUsd)}; ${Object.entries(r.plan).map(([k, v]) => `${STEP_SHORT[k as StepId] ?? k} ${n(v)}`).join(', ') || 'אין צעדים בתשלום'})${r.dispatched ? ', העובד הופעל.' : canDispatch ? '.' : '. העובד לא הופעל אוטומטית: הפעילו את ה־workflow ב־GitHub.'} ההתקדמות מופיעה למעלה, באצוות.` });
      setPicked(new Set());
      setLabel('');
      router.refresh();
    });
  const copyImages = () =>
    start(async () => {
      let total = { done: 0, logos: 0, covers: 0, left: 0 };
      for (let i = 0; i < 50; i++) {
        const r = await copyPendingImagesAction();
        if (!r.ok) break;
        total = { done: total.done + r.done, logos: total.logos + r.logos, covers: total.covers + r.covers, left: r.left };
        setCopy(`הועתקו ${total.done} (לוגו ${total.logos}, שער ${total.covers}), נשארו ${total.left}`);
        if (!r.done || !r.left) break;
      }
      router.refresh();
    });

  return (
    <div className={styles.stack}>
      <Batches batches={batches} canDispatch={canDispatch} />

      <section className={`${styles.card} ${styles.stack}`} aria-labelledby="plan-h">
        <h2 id="plan-h" className={styles.h2} style={{ margin: 0 }}>אצווה חדשה</h2>
        <div className={styles.btnRow}>
          <button type="button" className={styles.btn} onClick={() => setPicked(picked.size === rows.length ? new Set() : new Set(rows.map(r => r.branchId)))}>
            {picked.size === rows.length && rows.length ? 'ניקוי הבחירה' : `בחירת העמוד (${n(rows.length)})`}
          </button>
          <button type="button" className={styles.btn} disabled={!allFiltered.length} onClick={() => setPicked(new Set(allFiltered.slice(0, 1000).map(x => x.id)))}>
            {`בחירת כל התוצאות (${n(Math.min(allFiltered.length, 1000))})`}
          </button>
          <span className={styles.note}>{n(count)} נבחרו{focus.length ? ` · מיקוד: ${focus.join(', ')}` : ''}</span>
        </div>
        <div className={styles.checks}>
          <label className={styles.check}><input type="radio" name="mode" checked={auto} onChange={() => setAuto(true)} />כל ההעשרות הנדרשות: כל צעד רץ רק לעסקים שהוא יכול להשלים בהם חסר</label>
          <label className={styles.check}><input type="radio" name="mode" checked={!auto} onChange={() => setAuto(false)} />הצעדים שסימנתי, לכל העסקים שנבחרו</label>
        </div>
        <div className={styles.checks}>
          {STEP_ORDER.map(s => {
            const on = stepOn(s, flags);
            const e = est.per[s];
            return (
              <label key={s} className={styles.check} title={STEP_HINT[s] + (on ? '' : ' (כבוי בהגדרות)')} style={on ? undefined : { opacity: 0.55 }}>
                <input type="checkbox" checked={steps.has(s)} disabled={!on} onChange={() => toggleStep(s)} />
                {STEP_NAME[s]}
                {count ? <span className={styles.note} style={{ marginInlineStart: 6 }}><span className={styles.ltr}>{n(e.listings)}</span>{e.usd ? <> · <span className={styles.ltr}>{usd(e.usd)}</span></> : null}</span> : null}
              </label>
            );
          })}
        </div>
        <label>
          <span className={styles.label}>שם האצווה (רשות)</span>
          <input className={styles.input} value={label} onChange={e => setLabel(e.target.value)} maxLength={60} placeholder={`לדוגמה: ${focus[0] ?? 'חיפה'}, השלמת תמונות ושעות`} />
        </label>
        <p className={styles.note}>
          תקרה משוערת לאצווה: <span className={styles.ltr}>{usd(est.total)}</span> (ברוטו; Apify נשמר בכפול ומסולק לפי הדיווח, הכתיבה מהמטמון כשהראיות לא השתנו). תקרות בהגדרות: Apify <span className={styles.ltr}>{usd(flags.apifyBudgetUsd)}</span> לריצה, כתיבה <span className={styles.ltr}>{usd(flags.editorialBudgetUsd)}</span> לריצה.
          {' '}פרופילי פייסבוק ואינסטגרם נלקחים רק כשהפרופיל עצמו מאשר את העסק (קישור לאתר או הטלפון). אתרים שחסמו אותנו לא נשלחים לדפדפן.
          {!flags.apifyEnabled ? ' Apify כבוי בהגדרות.' : ' Apify דורש APIFY_TOKEN ב־GitHub Actions; בלעדיו הצעדים שלו מדולגים ומסומנים באצווה.'}
          {mapConfigured ? '' : ' מפתח Maps Embed לא מוגדר, לכן ״מפה והגעה״ מסומן כחסר בכל העסקים.'}
        </p>
        <div className={styles.btnRow}>
          <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={pending || !count || !stepsChosen.length || flags.killSwitch} onClick={go}>{pending ? 'שולחים…' : `הרצת אצווה ל־${n(count)} העסקים שנבחרו`}</button>
          <button type="button" className={styles.btn} disabled={pending} onClick={copyImages}>העתקת תמונות ממתינות</button>
          {copy ? <span className={styles.note} role="status">{copy}</span> : null}
          {flags.killSwitch ? <span className={`${styles.chip} ${styles.chipBad}`}>מתג החירום פעיל</span> : null}
        </div>
        {msg ? <p className={`${styles.result} ${msg.ok ? styles.resultOk : styles.resultBad}`} role="status">{msg.text}</p> : null}
      </section>

      {rows.length === 0 ? <p className={`${styles.card} ${styles.empty}`}>אין עסקים במצב הזה.</p> : null}
      {rows.map(r => (
        <article key={r.branchId} className={styles.card}>
          <div className={styles.btnRow} style={{ alignItems: 'center' }}>
            <input type="checkbox" checked={picked.has(r.branchId)} onChange={() => toggle(r.branchId)} aria-label={`בחירת ${r.name}`} className={styles.pick} />
            <Link href={r.href} target="_blank" className={styles.recName} style={{ margin: 0 }}>{r.name}</Link>
            <span className={`${styles.chip} ${STATUS_CHIP[r.status]}`}>{STATUS_NAME[r.status]}</span>
            <span className={styles.chip}>מוכנות <span className={styles.ltr}>{r.readiness}%</span></span>
            <span className={styles.note}>{r.cityName} · {r.categories.map(catName).join(', ') || 'ללא תחום'}</span>
          </div>
          <div className={styles.reasons} style={{ marginTop: 6 }}>
            {r.missing.map(m => (
              <span key={m} className={`${styles.chip} ${r.ownerOnly.includes(m) ? styles.chipWarn : styles.chipBad}`} title={r.ownerOnly.includes(m) ? 'רק בעל העסק יכול להשלים' : 'ניתן לנסות בהעשרה'}>
                {SECTION_NAME[m] ?? m}
              </span>
            ))}
            {r.missing.length === 0 ? <span className={`${styles.chip} ${styles.chipOk}`}>הכול מלא</span> : null}
          </div>
          <p className={styles.note} style={{ marginTop: 6 }}>
            יכולים להשלים: {r.plan.length ? r.plan.map(s => STEP_SHORT[s]).join(', ') : 'אין מקור נוסף (נשאר לבעל העסק)'}
            {r.signals.instagram ? ' · יש חשבון אינסטגרם' : ''}{r.signals.facebook ? ' · יש עמוד פייסבוק' : ''}{r.signals.placeId || r.signals.cid ? ' · יש מזהה Google' : ''}
          </p>
          <p className={styles.note} style={{ marginTop: 4 }}>
            תמונות {r.photos} · שירותים {r.services} ({r.unpriced} ללא מחיר) · תיאור {r.words != null ? `${r.words} מילים` : 'ללא טיוטה'} · {r.faqs} שאלות · {r.hasSite ? SITE[r.siteOutcome ?? ''] ?? r.siteOutcome ?? 'אתר' : 'אין אתר'} · האתר נקרא לאחרונה {when(r.lastEnriched)} · כתיבה {when(r.lastEditorial)}
          </p>
        </article>
      ))}
    </div>
  );
}
