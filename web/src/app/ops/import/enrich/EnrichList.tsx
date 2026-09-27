'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CATEGORIES } from '@/lib/catalog';
import { SECTION_NAME, STATUS_NAME, type ProfileStatus } from '@/lib/import/coverage';
import type { EnrichRow } from '@/lib/server/enrichQueue';
import { copyPendingImagesAction, enhanceListingsAction } from '../actions';
import styles from '../import.module.css';

const STATUS_CHIP: Record<ProfileStatus, string> = { ready: styles.chipOk, ready_with_disclosed_gaps: styles.chipOk, needs_owner_information: styles.chipWarn, needs_review: styles.chipBad };
const SITE: Record<string, string> = { ok: 'האתר נקרא', no_email: 'נקרא, בלי דוא״ל', blocked: 'האתר חסם', robots: 'robots.txt אוסר', failed: 'האתר לא נטען', unsafe: 'כתובת לא בטוחה', unrelated: 'אתר של עסק אחר', directory: 'אינדקס, לא אתר', social_profile: 'רשת חברתית', google_profile: 'רק פרופיל Google', no_website: 'אין אתר', not_modified: 'לא השתנה', skipped_complete: 'לא נדרש' };
const catName = (s: string) => CATEGORIES.find(c => c.slug === s)?.name ?? s;
const usd = (x: number) => `$${x < 1 ? x.toFixed(3) : x.toFixed(2)}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('he-IL') : 'אף פעם');

export function EnrichList({ rows, allFilteredIds, focus, editorialUsd, dfs, canDispatch, mapConfigured }: { rows: EnrichRow[]; allFilteredIds: string[]; focus: string[]; editorialUsd: number; dfs: { perRequestUsd: number; perItemUsd: number }; canDispatch: boolean; mapConfigured: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rereadSite, setRereadSite] = useState(true);
  const [refresh, setRefresh] = useState(false);
  const [regenerate, setRegenerate] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copy, setCopy] = useState<string | null>(null);

  const toggle = (id: string) => setPicked(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const n = picked.size;
  const est = (refresh ? Math.ceil(n / 500) * dfs.perRequestUsd + n * dfs.perItemUsd : 0) + (regenerate ? n * editorialUsd * 1.3 : n * editorialUsd * 0.3);
  const go = () =>
    start(async () => {
      setMsg(null);
      const r = await enhanceListingsAction([...picked], { rereadSite, refresh, regenerate, focus });
      if (!r.ok) return setMsg({ ok: false, text: r.error === 'kill_switch' ? 'מתג החירום פעיל. כבו אותו בהגדרות.' : 'לא הצלחנו ליצור את הריצה.' });
      setMsg({ ok: true, text: `${r.count} עסקים נשלחו להעשרה${r.dispatched ? ', העובד הופעל.' : canDispatch ? '.' : '. העובד לא הופעל אוטומטית: הפעילו את ה־workflow ב־GitHub.'} התוצאות מופיעות בכרטיס הריצה ובציונים כאן אחרי שהריצה מסתיימת.` });
      setPicked(new Set());
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
      <div className={`${styles.card} ${styles.stack}`}>
        <div className={styles.btnRow}>
          <button type="button" className={styles.btn} onClick={() => setPicked(picked.size === rows.length ? new Set() : new Set(rows.map(r => r.branchId)))}>
            {picked.size === rows.length && rows.length ? 'ניקוי הבחירה' : `בחירת העמוד (${rows.length})`}
          </button>
          <button type="button" className={styles.btn} disabled={!allFilteredIds.length} onClick={() => setPicked(new Set(allFilteredIds.slice(0, 1000)))}>
            {`בחירת כל התוצאות (${Math.min(allFilteredIds.length, 1000)})`}
          </button>
          <span className={styles.note}>{n} נבחרו{focus.length ? ` · מיקוד: ${focus.join(', ')}` : ''}</span>
        </div>
        <div className={styles.checks}>
          <label className={styles.check}><input type="checkbox" checked={rereadSite} onChange={e => setRereadSite(e.target.checked)} />קריאה חוזרת של אתר העסק (מתעלמת ממטמון 30 הימים)</label>
          <label className={styles.check}><input type="checkbox" checked={refresh} onChange={e => setRefresh(e.target.checked)} />רענון מ־DataForSEO (בתשלום, דירוג, שעות ותמונות מהפרופיל)</label>
          <label className={styles.check}><input type="checkbox" checked={regenerate} onChange={e => setRegenerate(e.target.checked)} />כתיבה מחדש של התיאור והשאלות גם אם הראיות לא השתנו</label>
        </div>
        <p className={styles.note}>
          תקרה משוערת לריצה: <span className={styles.ltr}>{usd(est)}</span>. הכתיבה נעשית רק כשחבילת הראיות השתנתה (או בכתיבה מחדש), ומסולקת לפי הטוקנים בפועל. תמונות מועתקות בריצה רק כשלעובד יש אחסון; אחרת לחצו ״העתקת תמונות ממתינות״.
          {mapConfigured ? '' : ' מפתח Maps Embed לא מוגדר, לכן ״מפה והגעה״ מסומן כחסר בכל העסקים.'}
        </p>
        <div className={styles.btnRow}>
          <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={pending || !n} onClick={go}>{pending ? 'שולחים…' : `העשרת ${n} העסקים שנבחרו`}</button>
          <button type="button" className={styles.btn} disabled={pending} onClick={copyImages}>העתקת תמונות ממתינות</button>
          {copy ? <span className={styles.note} role="status">{copy}</span> : null}
        </div>
        {msg ? <p className={`${styles.result} ${msg.ok ? styles.resultOk : styles.resultBad}`} role="status">{msg.text}</p> : null}
      </div>

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
            תמונות {r.photos} · שירותים {r.services} ({r.unpriced} ללא מחיר) · תיאור {r.words != null ? `${r.words} מילים` : 'ללא טיוטה'} · {r.faqs} שאלות · {r.hasSite ? SITE[r.siteOutcome ?? ''] ?? r.siteOutcome ?? 'אתר' : 'אין אתר'} · האתר נקרא לאחרונה {when(r.lastEnriched)} · כתיבה {when(r.lastEditorial)}
          </p>
        </article>
      ))}
    </div>
  );
}
