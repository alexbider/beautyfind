'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import styles from './Lists.module.css';

// Scrollable segmented control with fade edges (spec §3); the active item is scrolled into view.
// Items are links (URL state) or buttons (local state).
export interface SegmentItem {
  key: string;
  label: React.ReactNode;
  href?: string;
  count?: number;
}

export function Segmented({ items, value, onChange, label, sticky }: { items: SegmentItem[]; value: string; onChange?: (key: string) => void; label: string; sticky?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = scroller.current;
    const on = s?.querySelector<HTMLElement>('[data-on]');
    if (!s || !on) return;
    // scrollTo on the container (never scrollIntoView, which also scrolls the page).
    const left = on.offsetLeft - (s.clientWidth - on.offsetWidth) / 2;
    s.scrollTo({ left, behavior: 'smooth' });
  }, [value]);

  return (
    <div className={styles.segWrap} data-sticky={sticky || undefined}>
      <div ref={scroller} className={styles.seg} role={onChange ? 'tablist' : undefined} aria-label={label}>
        {items.map(it => {
          const on = it.key === value;
          const inner = (
            <>
              {it.label}
              {it.count !== undefined && <span className={`${styles.segCount} ltr tnum`}>{it.count}</span>}
            </>
          );
          return it.href ? (
            <Link key={it.key} href={it.href} className={styles.segItem} data-on={on || undefined} aria-current={on ? 'page' : undefined} scroll={false}>
              {inner}
            </Link>
          ) : (
            <button key={it.key} type="button" role="tab" aria-selected={on} className={styles.segItem} data-on={on || undefined} onClick={() => onChange?.(it.key)}>
              {inner}
            </button>
          );
        })}
      </div>
    </div>
  );
}
