'use client';

import { useId, useState } from 'react';
import styles from './Directory.module.css';

/**
 * Compact single-open FAQ for the sidebar (the Directory design's variant: divider rows and a
 * 26px plus, not the large cards of the shared FaqAccordion). Answers stay in the DOM when
 * closed (hidden) so the text matches the FAQPage JSON-LD for crawlers.
 */
export function SidebarFaq({ items }: { items: Array<{ q: string; a: string }> }) {
  const [open, setOpen] = useState(0);
  const uid = useId();
  return (
    <div>
      {items.map((f, i) => {
        const on = open === i;
        return (
          <div key={f.q} className={styles.faqItem}>
            <h3 className={styles.faqH3}>
              <button type="button" className={styles.faqQ} aria-expanded={on} aria-controls={`${uid}-${i}`} onClick={() => setOpen(on ? -1 : i)}>
                <span>{f.q}</span>
                <span aria-hidden="true" className={styles.faqPlus}>+</span>
              </button>
            </h3>
            <p id={`${uid}-${i}`} className={styles.faqA} hidden={!on}>
              {f.a}
            </p>
          </div>
        );
      })}
    </div>
  );
}
