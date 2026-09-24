'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { CATEGORIES, CITIES, MENU_REGION_ORDER, REGIONS } from '@/lib/catalog';
import { estimateRun } from '@/lib/import/estimate';
import type { RunScope } from '@/lib/import/rules';
import { runControlAction, startRunAction } from './actions';
import styles from './import.module.css';

export interface RunRow {
  id: string;
  label: string;
  status: 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'canceled';
  scope: RunScope;
  maxRequests: number;
  requestsUsed: number;
  maxExtractions: number | null;
  extractionsUsed: number;
  stats: { counters?: Record<string, number>; budgetHit?: boolean; types?: { dropped: string[] } };
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  byStatus: Record<string, number>;
}

const STATUS_NAME: Record<RunRow['status'], string> = {
  queued: 'ממתינה', running: 'רצה', paused: 'מושהית', done: 'הסתיימה', failed: 'נכשלה', canceled: 'בוטלה',
};
const STATUS_CHIP: Record<RunRow['status'], string> = {
  queued: '', running: styles.chipOk, paused: styles.chipWarn, done: styles.chipOk, failed: styles.chipBad, canceled: '',
};
const n = (x: number) => x.toLocaleString('he-IL');

function NewRun({ canDispatch }: { canDispatch: boolean }) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [all, setAll] = useState(false);
  const [cities, setCities] = useState<string[]>([]);
  const [cats, setCats] = useState<string[]>(CATEGORIES.map(c => c.slug));
  const [nearby, setNearby] = useState(true);
  const [text, setText] = useState(true);
  const [cap, setCap] = useState('');
  const [llmCap, setLlmCap] = useState('');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const scope: RunScope = { all, cities, categories: cats, nearby, text };
  const est = useMemo(() => estimateRun(scope), [all, cities, cats, nearby, text]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxRequests = Number(cap) || Math.ceil((est.likely * 1.15) / 50) * 50;
  const valid = cats.length > 0 && (nearby || text) && (all || cities.length > 0);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const submit = () =>
    start(async () => {
      setMsg(null);
      const r = await startRunAction({ label: label || (all ? 'כל הארץ' : cities.map(c => CITIES.find(x => x.slug === c)?.name).join(', ')), scope, maxRequests, maxExtractions: llmCap ? Number(llmCap) : null });
      if (!r.ok) return setMsg({ ok: false, text: 'לא הצלחנו ליצור את הריצה. בדקו את הבחירות ונסו שוב.' });
      setMsg({
        ok: true,
        text: r.dispatched ? 'הריצה נוצרה והעובד הופעל. ההתקדמות תתעדכן כאן.' : 'הריצה נוצרה ומחכה בתור. הפעילו את ה־workflow ״Import worker״ ב־GitHub Actions.',
      });
      setLabel('');
      router.refresh();
    });

  return (
    <section className={`${styles.card} ${styles.stack}`} aria-labelledby="new-run">
      <h2 id="new-run" className={styles.h2}>ריצה חדשה</h2>
      <label>
        <span className={styles.label}>שם הריצה</span>
        <input className={styles.input} value={label} onChange={e => setLabel(e.target.value)} placeholder="לדוגמה: חיפה, כל התחומים" maxLength={80} />
      </label>

      <div>
        <span className={styles.label}>איך מחפשים</span>
        <div className={styles.checks}>
          <label className={styles.check}><input type="checkbox" checked={nearby} onChange={e => setNearby(e.target.checked)} />מפה לפי סוג עסק</label>
          <label className={styles.check}><input type="checkbox" checked={text} onChange={e => setText(e.target.checked)} />חיפוש לפי תחום ועיר</label>
        </div>
        <p className={styles.note}>המפה מוצאת מספרות, ציפורניים, ספא וקוסמטיקה. החיפוש לפי תחום מוצא גם קליניקות רפואיות, שיניים והשתלות שיער.</p>
      </div>

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
      </div>

      <div>
        <span className={styles.label}>אזורים וערים</span>
        <label className={styles.check}><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />כל הארץ, כולל יישובים שאינם ברשימה</label>
        {MENU_REGION_ORDER.map(slug => {
          const region = REGIONS.find(r => r.slug === slug)!;
          const list = CITIES.filter(c => c.region === slug);
          const allOn = list.every(c => cities.includes(c.slug));
          return (
            <div key={slug} className={styles.region}>
              <div className={styles.regionHead}>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={allOn}
                    onChange={() => setCities(allOn ? cities.filter(c => !list.some(x => x.slug === c)) : [...new Set([...cities, ...list.map(c => c.slug)])])}
                  />
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
        })}
      </div>

      <div className={styles.estimate} aria-live="polite">
        <div>קריאות Google (הערכה)<b className={styles.ltr}>{n(est.min)}–{n(est.likely)}</b></div>
        <div>עלות משוערת<b className={styles.ltr}>${n(est.usdMin)}–${n(est.usdLikely)}</b></div>
      </div>

      <div className={styles.grid2} style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <label>
          <span className={styles.label}>תקרת קריאות Google</span>
          <input className={styles.input} inputMode="numeric" dir="ltr" value={cap} onChange={e => setCap(e.target.value.replace(/\D/g, ''))} placeholder={String(maxRequests)} />
        </label>
        <label>
          <span className={styles.label}>תקרת קריאות Claude</span>
          <input className={styles.input} inputMode="numeric" dir="ltr" value={llmCap} onChange={e => setLlmCap(e.target.value.replace(/\D/g, ''))} placeholder="ללא תקרה" />
        </label>
      </div>
      <p className={styles.note}>הריצה נעצרת בתקרה וממשיכה עם מה שנמצא. אפשר להשהות ולהמשיך בכל שלב.</p>
      {!canDispatch ? <p className={styles.info}>אין חיבור להפעלה אוטומטית (GITHUB_DISPATCH_TOKEN). הריצה תחכה בתור עד שמפעילים את ה־workflow ב־GitHub.</p> : null}
      {msg ? <p className={msg.ok ? styles.info : styles.error} role="status">{msg.text}</p> : null}
      <div className={styles.btnRow}>
        <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={!valid || pending} onClick={submit}>
          {pending ? 'יוצרים…' : 'הפעלת ריצה'}
        </button>
      </div>
    </section>
  );
}

function Run({ r }: { r: RunRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const c = r.stats.counters ?? {};
  const b = r.byStatus;
  const pct = Math.min(100, Math.round((r.requestsUsed / Math.max(1, r.maxRequests)) * 100));
  const act = (a: 'pause' | 'resume' | 'cancel' | 'kick') =>
    start(async () => {
      if (a === 'cancel' && !confirm('לבטל את הריצה? רשומות שכבר נמצאו נשארות בתור הבדיקה.')) return;
      const res = await runControlAction(r.id, a);
      setNote(res.dispatched === false && (a === 'resume' || a === 'kick') ? 'העובד לא הופעל אוטומטית. הפעילו את ה־workflow ב־GitHub.' : '');
      router.refresh();
    });

  return (
    <article className={styles.card}>
      <div className={styles.runHead}>
        <span className={styles.runTitle}>{r.label}</span>
        <span className={`${styles.chip} ${STATUS_CHIP[r.status]}`}>{STATUS_NAME[r.status]}</span>
        <span className={styles.note}>{new Date(r.createdAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</span>
      </div>
      <div className={styles.note}>
        קריאות Google: <span className={styles.ltr}>{n(r.requestsUsed)} / {n(r.maxRequests)}</span>
        {' · '}Claude: <span className={styles.ltr}>{n(r.extractionsUsed)}{r.maxExtractions != null ? ` / ${n(r.maxExtractions)}` : ''}</span>
        {r.stats.budgetHit ? ' · הגיעה לתקרה' : ''}
      </div>
      <div className={styles.bar} aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <div className={styles.counts}>
        <span>נמצאו <b>{n(c.placesNew ?? 0)}</b></span>
        <span>אתרים נקראו <b>{n(c.enriched ?? 0)}</b></span>
        <span>חולצו <b>{n(c.extracted ?? 0)}</b></span>
        <span>מוכנים <b>{n(b.ready ?? 0)}</b></span>
        <span>לבדיקה <b>{n(b.needs_review ?? 0)}</b></span>
        <span>חסרים <b>{n(b.incomplete ?? 0)}</b></span>
        <span>כפולים <b>{n(b.duplicate ?? 0)}</b></span>
        <span>אושרו <b>{n((b.approved ?? 0) + (b.merged ?? 0))}</b></span>
      </div>
      {r.error ? <p className={styles.error}>{r.error}</p> : null}
      {r.stats.types?.dropped?.length ? <p className={styles.note}>סוגי מקום שלא נתמכו ודולגו: <span className={styles.ltr}>{r.stats.types.dropped.join(', ')}</span></p> : null}
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
        {r.status !== 'done' && r.status !== 'canceled' ? <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={pending} onClick={() => act('cancel')}>ביטול</button> : null}
      </div>
    </article>
  );
}

export function RunsView({ runs, canDispatch }: { runs: RunRow[]; canDispatch: boolean }) {
  const router = useRouter();
  const live = runs.some(r => r.status === 'running' || r.status === 'queued');
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [live, router]);

  return (
    <div className={styles.grid2}>
      <NewRun canDispatch={canDispatch} />
      <section className={styles.stack} aria-label="ריצות">
        {runs.length ? runs.map(r => <Run key={r.id} r={r} />) : <p className={`${styles.card} ${styles.empty}`}>עוד לא הופעלה ריצה.</p>}
      </section>
    </div>
  );
}
