'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { CATEGORIES } from '@/lib/catalog';
import { SECTION_NAME } from '@/lib/import/coverage';
import { STEP_SHORT } from '@/lib/import/enrichPlan';
import type { ReportGroup } from '@/lib/server/importReport';
import { enhanceGroupAction } from '../actions';
import styles from '../import.module.css';

const n = (x: number) => x.toLocaleString('he-IL');
const usd = (x: number) => `$${x.toFixed(2)}`;
const catName = (slug: string) => CATEGORIES.find(c => c.slug === slug)?.name ?? (slug || 'ללא תחום');

/**
 * The groups table of the profiles report: one row per city and category over the current filter,
 * with a one-click completion batch for the published listings in the group. Refreshes while a
 * run is live so the rows move as the worker fills them.
 */
export function ReportGroups({ groups, region, live, canDispatch, hrefFor }: { groups: ReportGroup[]; region: string; live: boolean; canDispatch: boolean; hrefFor: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [live, router]);

  const go = (g: ReportGroup, rewrite = false) =>
    start(async () => {
      const what = `${g.cityName || 'כל הערים'} · ${catName(g.category)}`;
      const ask = rewrite
        ? `לכתוב מחדש את התיאור והשאלות הנפוצות ל־${n(g.publishedUnclaimed.length)} עסקים שפורסמו בקבוצה ${what}? קריאת כתיבה אחת לכל עסק; הטקסט החדש מחליף את הקיים.`
        : `להתחיל אצוות השלמה ל־${n(g.publishedUnclaimed.length)} עסקים שפורסמו בקבוצה ${what}? כל מקור רץ רק לעסקים שהוא יכול לעזור להם, והתקרה נקבעת לפי ההערכה.`;
      if (!confirm(ask)) return;
      setBusy(g.key);
      const r = await enhanceGroupAction({ region: region || undefined, city: g.cityName || undefined, category: g.category || undefined, label: `${rewrite ? 'כתיבה מחדש' : 'השלמות'}: ${what}`.slice(0, 60), rewrite });
      setBusy(null);
      if (!r.ok) setNote({ kind: 'bad', text: r.error === 'forbidden' ? 'אין הרשאה.' : `האצווה לא נוצרה: ${r.error}` });
      else if (!r.count) setNote({ kind: 'ok', text: 'אין בקבוצה עסקים שאפשר להשלים כרגע.' });
      else {
        const plan = Object.entries(r.plan).map(([k, v]) => `${STEP_SHORT[k as keyof typeof STEP_SHORT] ?? k} ${n(v)}`).join(' · ');
        setNote({ kind: 'ok', text: `נוצרה אצווה ל־${n(r.count)} עסקים (תקרה ${usd(r.budgetUsd)}${plan ? `; ${plan}` : ''}).${r.dispatched === false && canDispatch ? ' העובד לא הופעל אוטומטית, הפעילו אותו ב־GitHub.' : ''}` });
      }
      router.refresh();
    });

  if (!groups.length) return <p className={styles.empty}>אין קבוצות בסינון הזה.</p>;
  return (
    <div className={styles.stack}>
      {note ? <p className={note.kind === 'ok' ? styles.info : styles.error} role="status">{note.text}</p> : null}
      <div style={{ overflowX: 'auto' }}>
        <table className={styles.groups}>
          <thead>
            <tr>
              <th>עיר</th>
              <th>תחום</th>
              <th>עסקים</th>
              <th>פורסמו</th>
              <th>בבדיקה</th>
              <th>מוכנות ממוצעת</th>
              <th>חוסרים נפוצים</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <tr key={g.key}>
                <td>{g.cityName || 'ללא עיר'}</td>
                <td>{catName(g.category)}</td>
                <td><Link href={hrefFor[g.key] ?? '#'} className={styles.ltr}>{n(g.n)}</Link></td>
                <td>{n(g.published)}</td>
                <td>{n(g.inReview)}</td>
                <td><span className={`${styles.sec} ${g.avgReadiness >= 80 ? styles.secOn : g.avgReadiness >= 50 ? styles.secHalf : styles.secOff}`}>{g.avgReadiness}%</span></td>
                <td>{g.topGaps.map(x => SECTION_NAME[x] ?? x).join(', ') || 'אין'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={pending || !g.publishedUnclaimed.length} onClick={() => go(g)} title={g.publishedUnclaimed.length ? `השלמת חוסרים ל־${n(g.publishedUnclaimed.length)} עסקים שפורסמו` : 'אין בקבוצה עסקים שפורסמו ולא נתבעו'}>
                    {busy === g.key ? 'יוצר אצווה…' : `השלמת חוסרים (${n(g.publishedUnclaimed.length)})`}
                  </button>{' '}
                  <button type="button" className={styles.btn} disabled={pending || !g.publishedUnclaimed.length} onClick={() => go(g, true)} title="כתיבה מחדש של התיאור והשאלות הנפוצות לכל העסקים שפורסמו בקבוצה">
                    כתיבה מחדש
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
