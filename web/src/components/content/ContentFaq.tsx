'use client';

import { useId, useState } from 'react';
import type { Faq } from './types';
import { rich } from './Rich';
import styles from './content.module.css';

/** Single-open ruled accordion from the Standards design. First item open by default. */
export function ContentFaq({ faqs }: { faqs: Faq[] }) {
  const [open, setOpen] = useState(0);
  const uid = useId();
  return (
    <div className={styles.faq}>
      {faqs.map((f, i) => {
        const on = open === i;
        const id = `${uid}-a${i}`;
        return (
          <div key={f.q} className={styles.faqItem} data-open={on || undefined}>
            <h3 className={styles.faqH}>
              <button type="button" className={styles.faqQ} aria-expanded={on} aria-controls={id} onClick={() => setOpen(on ? -1 : i)}>
                <span>{rich(f.q, `q${i}`)}</span>
                <span aria-hidden="true" className={styles.faqPlus}>+</span>
              </button>
            </h3>
            <p id={id} className={styles.faqA} hidden={!on}>{rich(f.a, `a${i}`)}</p>
          </div>
        );
      })}
    </div>
  );
}
