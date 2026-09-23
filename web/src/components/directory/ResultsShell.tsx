'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Check, ChevronDown } from '@/components/icons';
import { BIZ, RESULTS, fmtNum } from './copy';
import { Count } from './Count';
import { FILTER_KEYS, FILTER_LABELS, MAX_SHOW, PAGE, SORTS, dirHref, type DirQuery, type FilterKey } from './params';
import styles from './Directory.module.css';

type Menu = 'filter' | 'sort' | null;

interface Props {
  base: string; // canonical path of this listing, no params
  query: DirQuery;
  filterCounts: Record<FilterKey, number>;
  matched: number; // results for the current filters
  total: number; // results with no filters
  shown: number; // cards rendered
  searchHref: string; // fallback once ?show hits MAX_SHOW
  children: ReactNode; // server-rendered cards or the no-results box
}

/**
 * The only client part of the list: filter and sort dropdowns plus "show more". Every action
 * just updates the URL; the server re-renders the list, so the page stays crawlable and
 * shareable. The status line is a polite live region, so the new count is announced.
 */
export function ResultsShell({ base, query, filterCounts, matched, total, shown, searchHref, children }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [menu, setMenu] = useState<Menu>(null);
  const uid = useId();
  const filterBtn = useRef<HTMLButtonElement>(null);
  const sortBtn = useRef<HTMLButtonElement>(null);
  const filterPanel = useRef<HTMLDivElement>(null);
  const sortPanel = useRef<HTMLDivElement>(null);

  const go = (q: DirQuery) => startTransition(() => router.push(dirHref(base, q), { scroll: false }));

  // Focus the checked (or first) item when a menu opens, per the ARIA menu pattern.
  useEffect(() => {
    const panel = menu === 'filter' ? filterPanel.current : menu === 'sort' ? sortPanel.current : null;
    if (!panel) return;
    const items = [...panel.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    (items.find(i => i.getAttribute('aria-checked') === 'true' && menu === 'sort') ?? items[0])?.focus();
  }, [menu]);

  // Close on outside pointer down.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      const panel = menu === 'filter' ? filterPanel.current : sortPanel.current;
      const btn = menu === 'filter' ? filterBtn.current : sortBtn.current;
      const t = e.target as Node;
      if (!panel?.contains(t) && !btn?.contains(t)) setMenu(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menu]);

  const close = (focusTrigger: boolean) => {
    const btn = menu === 'filter' ? filterBtn.current : sortBtn.current;
    setMenu(null);
    if (focusTrigger) btn?.focus();
  };

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const move = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(items.length - 1);
    else if (e.key === 'Tab') setMenu(null);
  };

  const onTriggerKey = (m: Exclude<Menu, null>) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setMenu(m);
    } else if (e.key === 'Escape' && menu) {
      e.preventDefault();
      close(true);
    }
  };

  const toggleFilter = (k: FilterKey) => {
    const on = query.filters.includes(k);
    go({ ...query, filters: on ? query.filters.filter(f => f !== k) : [...query.filters, k], show: PAGE });
  };
  const clearFilters = () => go({ ...query, filters: [], show: PAGE });

  const nFilters = query.filters.length;
  const sortName = SORTS.find(s => s.key === query.sort)!.name;

  const remaining = Math.max(0, matched - shown);
  const nextShow = shown + PAGE;
  const canLoadMore = remaining > 0 && nextShow <= MAX_SHOW;
  const step = Math.min(PAGE, remaining);
  const moreLabel =
    step === 1 ? 'הצגת עסק נוסף' : step === 2 ? 'הצגת שני עסקים נוספים' : <>הצגת <span className="ltr">{fmtNum(step)}</span> עסקים נוספים</>;
  const moreHref = dirHref(base, { ...query, show: nextShow });
  const onMore = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    go({ ...query, show: nextShow });
  };
  const pct = `${Math.round(Math.min(1, shown / Math.max(1, matched)) * 100)}%`;

  return (
    <>
      <div className={styles.controls}>
        <div className={styles.dd}>
          <button
            ref={filterBtn}
            type="button"
            className={styles.ddBtn}
            data-active={nFilters > 0 || undefined}
            aria-haspopup="menu"
            aria-expanded={menu === 'filter'}
            aria-controls={`${uid}-filter`}
            onClick={() => setMenu(m => (m === 'filter' ? null : 'filter'))}
            onKeyDown={onTriggerKey('filter')}
          >
            <span>סינון</span>
            {nFilters > 0 && (
              <span className={`${styles.badge} ltr`} aria-label={`${nFilters} פעילים`}>
                {nFilters}
              </span>
            )}
            <ChevronDown />
          </button>
          {menu === 'filter' && (
            <div ref={filterPanel} id={`${uid}-filter`} role="menu" aria-label="סינון עסקים" className={styles.panel} onKeyDown={onPanelKey}>
              {FILTER_KEYS.map(k => {
                const on = query.filters.includes(k);
                const n = filterCounts[k];
                return (
                  <button
                    key={k}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    tabIndex={-1}
                    className={styles.opt}
                    data-dim={n === 0 && !on ? true : undefined}
                    onClick={() => toggleFilter(k)}
                  >
                    <span aria-hidden="true" className={styles.box}>
                      {on && <Check size={12} />}
                    </span>
                    <span className={styles.optName}>{FILTER_LABELS[k]}</span>
                    <span className={`${styles.optCount} ltr`}>{fmtNum(n)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles.dd}>
          <button
            ref={sortBtn}
            type="button"
            className={styles.ddBtn}
            aria-haspopup="menu"
            aria-expanded={menu === 'sort'}
            aria-controls={`${uid}-sort`}
            onClick={() => setMenu(m => (m === 'sort' ? null : 'sort'))}
            onKeyDown={onTriggerKey('sort')}
          >
            <span className={styles.ddMuted}>מיון</span>
            <span className={styles.ddStrong}>{sortName}</span>
            <ChevronDown />
          </button>
          {menu === 'sort' && (
            <div ref={sortPanel} id={`${uid}-sort`} role="menu" aria-label="מיון עסקים" className={styles.panel} data-kind="sort" onKeyDown={onPanelKey}>
              {SORTS.map(o => {
                const on = query.sort === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={on}
                    tabIndex={-1}
                    className={styles.opt}
                    data-kind="sort"
                    onClick={() => {
                      close(true);
                      if (!on) go({ ...query, sort: o.key, show: PAGE });
                    }}
                  >
                    <span>{o.name}</span>
                    <span aria-hidden="true" className={styles.tick}>
                      {on ? '✓' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {nFilters > 0 && (
          <button type="button" className={styles.clear} onClick={clearFilters}>
            נקו
          </button>
        )}

        <span role="status" aria-live="polite" className={styles.matchLine}>
          {pending ? (
            'מעדכן תוצאות'
          ) : nFilters > 0 ? (
            <><Count n={matched} f={RESULTS} /> אחרי סינון</>
          ) : (
            <>
              כל התוצאות<span className="sr-only">: <Count n={total} f={BIZ} /></span>
            </>
          )}
          {!pending && matched > 0 && <span className="sr-only">, מוצגים <span className="ltr">{fmtNum(Math.min(shown, matched))}</span> מתוך <span className="ltr">{fmtNum(matched)}</span></span>}
        </span>
      </div>

      <div className={styles.results} aria-busy={pending}>
        {children}
      </div>

      {matched > 0 && (
        <div className={styles.moreRow}>
          {canLoadMore ? (
            <a href={moreHref} rel="nofollow" className={styles.moreBtn} onClick={onMore} aria-disabled={pending || undefined}>
              {pending ? 'טוען' : moreLabel}
            </a>
          ) : (
            remaining > 0 && (
              <a href={searchHref} className={styles.moreBtn}>
                לכל <Count n={matched} f={BIZ} /> בחיפוש
              </a>
            )
          )}
          <div role="presentation" className={styles.progress}>
            <span style={{ width: pct }} />
          </div>
        </div>
      )}
    </>
  );
}
