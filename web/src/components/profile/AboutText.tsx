'use client';

import { useId, useState } from 'react';
import { ABOUT_PREVIEW_WORDS, splitAtWords } from './aboutSplit';
import styles from './AboutText.module.css';

/**
 * The "about" text: up to 250 words, then "קראו עוד" reveals the rest in place. The whole text is
 * always in the HTML (the hidden part carries the `hidden` attribute), so crawlers and screen
 * readers get all of it. Short texts render plainly, without a button.
 */
export function AboutText({ paragraphs, limit = ABOUT_PREVIEW_WORDS }: { paragraphs: string[]; limit?: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { head, tail } = splitAtWords(paragraphs, limit);
  if (tail.length === 0) {
    return (
      <div className={styles.text}>
        {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      </div>
    );
  }
  const last = head.length - 1;
  const cut = head[last] !== paragraphs[last]; // the last preview paragraph continues in the tail
  return (
    <div id={id} className={styles.text}>
      {open
        ? paragraphs.map((p, i) => <p key={i}>{p}</p>)
        : head.map((p, i) => <p key={i}>{i === last && cut ? `${p}…` : p}</p>)}
      {!open && (
        <div className={styles.rest} hidden>
          {tail.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      )}
      <button type="button" className={styles.more} aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
        {open ? 'הצגה מקוצרת' : 'קראו עוד'}
      </button>
    </div>
  );
}
