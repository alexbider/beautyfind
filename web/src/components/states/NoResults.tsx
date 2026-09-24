import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './states.module.css';

// Design: project/BeautyFind States.dc.html → "אין תוצאות".
// Rule: show what was filtered, let each filter be removed in one click, and offer ways to
// widen the search with real result counts. Works from server components (hrefs) and from
// client components (onRemove / onPick).

export interface ActiveFilter {
  key: string;
  label: string;
  /** URL of the same search without this filter. */
  removeHref?: string;
  onRemove?: () => void;
}

export interface WidenOption {
  key: string;
  label: string;
  note?: string;
  /** Real number of results after widening. */
  count: number;
  href?: string;
  onPick?: () => void;
}

export function NoResults({
  filters = [],
  title,
  body,
  widen = [],
  children,
}: {
  filters?: ActiveFilter[];
  title?: string;
  body?: string;
  widen?: WidenOption[];
  /** Optional extra block under the options, e.g. <AreaAlertForm />. */
  children?: ReactNode;
}) {
  const heading = title ?? (filters.length > 1 ? 'אין קליניקה שעונה על כל הסינונים' : 'אין קליניקה שעונה על החיפוש');
  const lede = body ?? (widen.length ? 'בדרך כלל מספיק להרחיב סינון אחד.' : 'נסו להסיר סינון או לחפש במילה אחרת.');

  return (
    <div className={styles.enter}>
      {filters.length > 0 && (
        <div className={styles.filters}>
          <span className={styles.filtersLabel}>החיפוש שלכם:</span>
          {filters.map(f => {
            const inner = (
              <>
                <span>{f.label}</span>
                <span aria-hidden="true" className={styles.chipX}>×</span>
              </>
            );
            const label = `הסרת הסינון ${f.label}`;
            return f.removeHref ? (
              <Link key={f.key} href={f.removeHref} aria-label={label} className={styles.chip}>{inner}</Link>
            ) : (
              <button key={f.key} type="button" onClick={f.onRemove} aria-label={label} className={styles.chip}>{inner}</button>
            );
          })}
        </div>
      )}

      <div className={styles.noResHead}>
        <h2 className={styles.h2}>{heading}</h2>
        <p className={styles.lede}>{lede}</p>
      </div>

      {widen.length > 0 && (
        <>
          <h3 className={styles.h3}>נסו להרחיב את החיפוש</h3>
          <div className={`${styles.sug} ${styles.widen}`} data-n={Math.min(widen.length, 3)}>
            {widen.map(w => {
              const inner = (
                <>
                  <span className={styles.sugText}>
                    <span className={styles.sugName}>{w.label}</span>
                    {w.note && <span className={styles.sugNote}>{w.note}</span>}
                  </span>
                  <span aria-hidden="true" className={`${styles.sugNum} ltr`}>{w.count}</span>
                  <span className="sr-only">, {resultsLabel(w.count)}</span>
                </>
              );
              return w.href ? (
                <Link key={w.key} href={w.href} className={styles.sugCard}>{inner}</Link>
              ) : (
                <button key={w.key} type="button" onClick={w.onPick} className={styles.sugCard}>{inner}</button>
              );
            })}
          </div>
        </>
      )}

      {children}
    </div>
  );
}

/** תוצאה אחת · שתי תוצאות · N תוצאות */
export const resultsLabel = (n: number) => (n === 1 ? 'תוצאה אחת' : n === 2 ? 'שתי תוצאות' : `${n} תוצאות`);
