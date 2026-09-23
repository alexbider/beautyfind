'use client';

import { useId, useState, type ReactNode } from 'react';
import styles from './Directory.module.css';

/** Local guide: clipped at 420px with a fade, full text always in the HTML for crawlers. */
export function GuideExpander({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <div id={id} className={styles.rich} data-open={open || undefined}>
        {children}
        {!open && <div aria-hidden="true" className={styles.fade} />}
      </div>
      <button type="button" className={styles.ghostBtn} aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
        {open ? 'הצגה מקוצרת' : 'קראו את המדריך המלא'}
      </button>
    </>
  );
}
