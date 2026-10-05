'use client';

import { useEffect, useId, useRef, useState } from 'react';
import styles from './MarketPrices.module.css';

/**
 * The "טווח רחב" badge with its tooltip. The tooltip text is in the HTML and tied to the button with
 * aria-describedby, so a screen reader hears it on focus; it shows on hover and on keyboard focus through CSS,
 * and a tap or click toggles it (Escape and an outside tap close it).
 */
export function WideRangeBadge({ label, tip }: { label: string; tip: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <span ref={wrap} className={styles.tipWrap} data-open={open || undefined}>
      <button type="button" className={`${styles.badge} ${styles.badgeWide}`} aria-describedby={id} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {label}
      </button>
      <span role="tooltip" id={id} className={styles.tip}>
        {tip}
      </span>
    </span>
  );
}
