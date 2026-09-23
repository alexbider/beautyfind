'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './ReadMore.module.css';

/**
 * Long guide text on phones (responsive spec §6): collapsed to about five lines with "המשך קריאה".
 * Only the app shell clamps; on desktop the text is shown in full and the button never appears.
 * The full text is always in the HTML, so crawlers and screen readers get all of it.
 * `lineHeight` is the line height of the text inside, e.g. "29px".
 */
export function ReadMore({ children, lines = 5, lineHeight, className }: { children: ReactNode; lines?: number; lineHeight: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  return (
    <>
      <div
        ref={ref}
        id={id}
        className={`${styles.clamp} ${className ?? ''}`}
        data-open={open || undefined}
        style={{ '--rm-max': `calc(${lines} * ${lineHeight})` } as React.CSSProperties}
      >
        {children}
      </div>
      {(clipped || open) && (
        <button type="button" className={`${styles.more} bf-shell-only`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
          {open ? 'הצגה מקוצרת' : 'המשך קריאה'}
        </button>
      )}
    </>
  );
}
