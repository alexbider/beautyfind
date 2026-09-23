'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BOOKING_LIVE } from '@/lib/features';
import { nisFromAgorot } from '@/lib/format';
import { SavedTabs } from './SavedView';
import { ratingText, reviewsCount, type CompareColumn } from './types';
import styles from './saved.module.css';

type Cell = { v: React.ReactNode; sub?: string; best?: boolean; dim?: boolean; soft?: boolean };

/** Lowest numeric value in a row, only when at least two clinics have one (a single value is not "best"). */
function bestOf(vals: Array<number | null>): number | null {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length > 1 ? Math.min(...nums) : null;
}

/**
 * Compare up to three clinics on the same fields (design "view: compare").
 * Every value comes from the clinic's own public data; sponsored placement is never read.
 */
export function CompareView({ cols }: { cols: CompareColumn[] }) {
  const cmp = cols.map(c => c.id);
  // Treatment chips: "all", then each category any of the compared clinics offers.
  const cats = new Map<string, string>();
  cols.forEach(c => c.cats.forEach(k => cats.set(k.slug, k.name)));
  const [treat, setTreat] = useState<string>('all');
  const treatName = treat === 'all' ? 'כל הטיפולים' : cats.get(treat) ?? '';

  const prices = cols.map(c => c.priceFrom[treat] ?? null);
  const bestPrice = bestOf(prices);

  const rows: Array<{ label: string; cells: Cell[] }> = [
    {
      label: `מחיר החל מ · ${treatName}`,
      cells: cols.map((c, i) =>
        prices[i] != null
          ? { v: <span className="ltr tnum">{nisFromAgorot(prices[i]!)}</span>, sub: 'לא כולל מע״מ', best: prices[i] === bestPrice }
          : { v: treat === 'all' ? 'אין מחירון מפורסם' : 'לא מבוצע', dim: true },
      ),
    },
    {
      label: 'אחריות',
      cells: cols.map(c => (c.responsible ? { v: c.responsible.name, sub: `${c.responsible.label} · ${c.responsible.sub}` } : { v: 'לא צוין אחראי מאומת', dim: true })),
    },
    {
      label: 'דירוג Google',
      cells: cols.map(c =>
        c.google ? { v: <span className="ltr tnum">★ {ratingText(c.google.rating)}</span>, sub: `${reviewsCount(c.google.count)} בגוגל` } : { v: 'אין נתון', dim: true },
      ),
    },
    {
      label: 'ביקורות BeautyFind',
      cells: cols.map(c =>
        c.beautyfind
          ? { v: <span className="ltr tnum">★ {ratingText(c.beautyfind.rating)}</span>, sub: `${reviewsCount(c.beautyfind.count)} מאומתות` }
          : { v: 'עדיין אין ביקורות', dim: true },
      ),
    },
    { label: 'אימות', cells: cols.map(c => (c.verified ? { v: 'בעלות מאומתת' } : { v: 'טרם אומת', dim: true })) },
    { label: 'תחומים', cells: cols.map(c => ({ v: c.cats.map(k => k.name).join(', ') || 'לא צוין', soft: true })) },
    {
      label: 'שעות היום',
      cells: cols.map(c =>
        !c.hoursKnown ? { v: 'לא צוין', dim: true } : c.hoursToday ? { v: <span className="ltr tnum">{c.hoursToday}</span> } : { v: 'סגור היום', dim: true },
      ),
    },
    { label: 'נגישות', cells: cols.map(c => (c.accessible ? { v: 'נגיש לכיסא גלגלים', soft: true } : { v: 'לא צוינה נגישות', dim: true })) },
    { label: 'חניה', cells: cols.map(c => (c.freeParking ? { v: 'חניה חינם', soft: true } : { v: 'לא צוינה חניה חינם', dim: true })) },
    ...(BOOKING_LIVE ? [{ label: 'קביעה', cells: cols.map(c => ({ v: c.online ? 'אונליין' : 'בטלפון או בייעוץ', soft: true })) }] : []),
  ];

  return (
    <>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.h1}>השוואת קליניקות</h1>
          <p className={styles.sub}>עד שלוש קליניקות, אותם שדות, אותו טיפול.</p>
        </div>
        <SavedTabs current="compare" cmp={cmp} />
      </div>

      {cols.length < 2 ? (
        <p className={styles.tooFew}>
          סמנו לפחות שתי קליניקות <Link href="/saved">ברשימת השמורות</Link> כדי להשוות.
        </p>
      ) : (
        <div className={styles.cmpWrap}>
          <div className={styles.treatRow}>
            <span className={styles.treatLabel}>השוואה לפי טיפול:</span>
            {[['all', 'כל הטיפולים'] as const, ...cats.entries()].map(([k, name]) => (
              <button key={k} type="button" className={styles.chip} aria-pressed={treat === k} onClick={() => setTreat(k)}>
                {name}
              </button>
            ))}
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className="sr-only">השוואה בין {cols.map(c => c.name).join(', ')}</caption>
              <thead>
                <tr>
                  <td />
                  {cols.map(c => (
                    <th key={c.id} scope="col">
                      <Link href={c.href} className={styles.colName}>{c.name}</Link>
                      <span className={styles.colSub}>{[c.city, c.cats[0]?.name].filter(Boolean).join(' · ')}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    {r.cells.map((cl, i) => (
                      <td key={cols[i].id} data-best={cl.best || undefined} data-dim={cl.dim || undefined} data-soft={cl.soft || undefined}>
                        <span className={styles.cellV}>{cl.v}</span>
                        {cl.sub && <span className={styles.cellSub}>{cl.sub}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row"><span className="sr-only">פעולות</span></th>
                  {cols.map(c => (
                    <td key={c.id}>
                      <Link href={c.bookHref} className={styles.cta}>{c.bookLabel}</Link>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className={styles.foot2}>
            הנתונים מגיעים מהקליניקות עצמן. המחירים לא כוללים מע״מ. דירוג Google ודירוג BeautyFind מוצגים בנפרד ולא מתמזגים. מקום ממומן לא משפיע על ההשוואה. הערך המודגש בשורת המחיר מסמן את הנמוך ביותר, לא המלצה.
          </p>
        </div>
      )}
    </>
  );
}
