'use client';

import { useId, useState } from 'react';
import styles from './Faq.module.css';

/**
 * Single-open FAQ, first item open. Two looks from the designs:
 * `cards` (Treatments, Treatment Category) and `rules` (Region: divider list).
 */
export function Faq({ items, variant = 'cards' }: { items: Array<{ q: string; a: string }>; variant?: 'cards' | 'rules' }) {
  const [open, setOpen] = useState(0);
  const uid = useId();
  return (
    <div className={styles.list} data-variant={variant}>
      {items.map((f, i) => {
        const on = open === i;
        return (
          <div key={f.q} className={styles.item} data-open={on || undefined}>
            <h3 className={styles.h}>
              <button type="button" aria-expanded={on} aria-controls={`${uid}-a${i}`} className={styles.q} onClick={() => setOpen(on ? -1 : i)}>
                <span>{f.q}</span>
                <span aria-hidden="true" className={styles.plus}>+</span>
              </button>
            </h3>
            <p id={`${uid}-a${i}`} className={styles.a} hidden={!on}>
              {f.a}
            </p>
          </div>
        );
      })}
    </div>
  );
}
