import { fmtNum } from './copy';
import { dirHref, pagerItems, type DirQuery } from './params';
import styles from './Directory.module.css';

/**
 * Numbered pages as plain links, server-rendered, so every business of a city is reachable by a crawler
 * without JavaScript. rel="prev"/"next" on the neighbours; the current page is marked, not linked.
 */
export function Pager({ base, query, pages }: { base: string; query: DirQuery; pages: number }) {
  if (pages <= 1) return null;
  const href = (page: number) => dirHref(base, { ...query, page });
  const cur = query.page;
  return (
    <nav aria-label="עמודים" className={styles.pager}>
      {cur > 1 ? (
        <a href={href(cur - 1)} rel="prev" className={styles.pagerBtn}>
          הקודם
        </a>
      ) : (
        <span className={styles.pagerBtn} aria-disabled="true">הקודם</span>
      )}
      <ol className={styles.pagerList}>
        {pagerItems(cur, pages).map((n, i) =>
          n == null ? (
            <li key={`gap-${i}`} aria-hidden="true" className={styles.pagerGap}>…</li>
          ) : (
            <li key={n}>
              {n === cur ? (
                <span aria-current="page" className={`${styles.pagerNum} ltr`}>{fmtNum(n)}</span>
              ) : (
                <a href={href(n)} className={`${styles.pagerNum} ltr`} aria-label={`עמוד ${n}`}>{fmtNum(n)}</a>
              )}
            </li>
          ),
        )}
      </ol>
      {cur < pages ? (
        <a href={href(cur + 1)} rel="next" className={styles.pagerBtn}>
          הבא
        </a>
      ) : (
        <span className={styles.pagerBtn} aria-disabled="true">הבא</span>
      )}
    </nav>
  );
}
