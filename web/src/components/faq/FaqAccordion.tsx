'use client';

import { useState } from 'react';
import styles from './FaqAccordion.module.css';

/** Single-open accordion. First item open by default, as in the designs. */
export function FaqAccordion({ items, defaultOpen = 0 }: { items: Array<{ q: string; a: string }>; defaultOpen?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={styles.list}>
      {items.map((f, i) => {
        const on = open === i;
        return (
          <div key={f.q} className={styles.item} data-open={on || undefined} style={{ animationDelay: `${i * 60}ms` }}>
            <h3 className={styles.h}>
              <button type="button" aria-expanded={on} aria-controls={`faq-a-${i}`} className={styles.q} onClick={() => setOpen(on ? -1 : i)}>
                <span>{f.q}</span>
                <span aria-hidden="true" className={styles.plus}>+</span>
              </button>
            </h3>
            {on && <p id={`faq-a-${i}`} className={styles.a}>{f.a}</p>}
          </div>
        );
      })}
    </div>
  );
}
