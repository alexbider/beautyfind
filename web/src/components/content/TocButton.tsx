'use client';

import { useState, type MouseEvent } from 'react';
import { BottomSheet } from '@/components/shell/BottomSheet';
import styles from './content.module.css';

/**
 * Reading layout below 1024px (responsive spec §6 Legal / About / Standards): a sticky
 * "תוכן העניינים" button that opens the sections in a bottom sheet. The desktop rail is unchanged.
 */
export function TocButton({ sections, legal, label }: { sections: Array<{ id: string; head: string }>; legal: boolean; label: string }) {
  const [open, setOpen] = useState(false);

  const go = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    setOpen(false);
    // After the sheet has closed and handed focus back, jump to the section and move focus there.
    setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      // The section's scroll-margin keeps its heading clear of the sticky bars.
      const top = el.getBoundingClientRect().top + window.scrollY - (parseFloat(getComputedStyle(el).scrollMarginTop) || 0);
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
      try {
        window.history.replaceState(window.history.state, '', `#${id}`);
      } catch {}
      el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    }, 60);
  };

  return (
    <div className={styles.tocSticky}>
      <button type="button" className={styles.tocBtn} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <path d="M3 5h14M3 10h14M3 15h9" />
        </svg>
        תוכן העניינים
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="תוכן העניינים" size="half">
        <nav aria-label={label} className={styles.tocSheet}>
          {sections.map((s, i) => (
            <a key={s.id} href={`#${s.id}`} className={styles.tocLink} onClick={e => go(e, s.id)}>
              <span className={`${styles.tocNum} ltr`}>{legal ? String(i + 1) : String(i + 1).padStart(2, '0')}</span>
              <span className={styles.tocName}>{s.head}</span>
            </a>
          ))}
        </nav>
      </BottomSheet>
    </div>
  );
}
