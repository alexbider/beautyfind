'use client';

import Link from 'next/link';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { ArrowForward } from '@/components/icons';
import type { ListingCard } from '@/lib/server/public';
import { BizCard } from './BizCard';
import { fmtInt } from './format';
import styles from './BizTabs.module.css';

export interface BizTab {
  key: string; // URL param value; '' = the default tab
  name: string;
  /** "בגוש דן", "בתל אביב–יפו": used in "כל העסקים ב…" and the count line. */
  inName: string;
  allHref: string;
  total: number;
  items: Array<{ card: ListingCard; meta: string }>;
}

/**
 * "Top rated" section with tabs (cities on Region, regions on a category page).
 * Every tab is rendered on the server and switched on the client; the choice is mirrored
 * to `?{param}=` with replaceState so it can be shared, and read back on load.
 */
export function BizTabs({
  heading,
  headingId,
  param,
  ariaLabel,
  tabs,
  size = 92,
  variant = 'region',
}: {
  heading: ReactNode;
  headingId: string;
  param: string;
  ariaLabel: string;
  tabs: BizTab[];
  size?: 92 | 96;
  variant?: 'region' | 'category';
}) {
  const [active, setActive] = useState(tabs[0]?.key ?? '');
  const uid = useId();

  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get(param);
    if (v && tabs.some(t => t.key === v)) setActive(v);
  }, [param, tabs]);

  const pick = (key: string) => {
    setActive(key);
    const url = new URL(window.location.href);
    if (key) url.searchParams.set(param, key);
    else url.searchParams.delete(param);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  };

  const tab = tabs.find(t => t.key === active) ?? tabs[0];
  if (!tab) return null;
  const shown = tab.items.length;

  return (
    <section aria-labelledby={headingId} className={styles.section} data-variant={variant}>
      <div className={styles.head}>
        {heading}
        <span className={styles.count}>
          {shown === 1 ? 'מוצג אחד' : <><span className="ltr tnum">{fmtInt(shown)}</span> מוצגים</>} · <span className="ltr tnum">{fmtInt(tab.total)}</span> {tab.inName}
        </span>
      </div>
      <div className={styles.bar}>
        <div role="tablist" aria-label={ariaLabel} className={styles.tabs}>
          {tabs.map(t => {
            const on = t.key === tab.key;
            return (
              <button
                key={t.key || 'all'}
                type="button"
                role="tab"
                id={`${uid}-tab-${t.key || 'all'}`}
                aria-selected={on}
                aria-controls={`${uid}-panel`}
                tabIndex={on ? 0 : -1}
                className={styles.tab}
                data-on={on || undefined}
                onClick={() => pick(t.key)}
                onKeyDown={e => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                  e.preventDefault();
                  const i = tabs.findIndex(x => x.key === tab.key);
                  // RTL: ArrowLeft moves to the next tab.
                  const next = tabs[(i + (e.key === 'ArrowLeft' ? 1 : -1) + tabs.length) % tabs.length];
                  pick(next.key);
                  document.getElementById(`${uid}-tab-${next.key || 'all'}`)?.focus();
                }}
              >
                {t.name}
              </button>
            );
          })}
        </div>
        <Link href={tab.allHref} className={styles.all}>
          <span>כל העסקים {tab.inName}</span>
          <ArrowForward size={14} className={styles.allArrow} />
        </Link>
      </div>

      <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab.key || 'all'}`}>
        {shown > 0 ? (
          <ol className={styles.grid} key={tab.key}>
            {tab.items.map((it, i) => (
              <BizCard key={it.card.id} card={it.card} meta={it.meta} size={size} index={i} />
            ))}
          </ol>
        ) : (
          <p className={styles.empty}>
            עדיין אין עסקים רשומים {tab.inName}. <Link href="/for-business">יש לכם עסק כאן?</Link>
          </p>
        )}
      </div>
    </section>
  );
}
