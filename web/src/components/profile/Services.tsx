'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowForward } from '@/components/icons';
import { ContactTrigger } from './ContactDialog';
import styles from './Services.module.css';

export interface PriceView {
  pre: string;
  amount: string;
  post: string;
}

export interface ServiceGroupView {
  key: string;
  name: string;
  meta: string; // "4 אפשרויות"
  icon: string[];
  from: PriceView | null;
  medical: boolean;
  compare: { href: string; label: string } | null;
  items: Array<{ id: string; name: string; price: PriceView; duration: string | null; medical: boolean }>;
}

/** Price with its Hebrew wording outside and the amount in an LTR span ("החל מ־₪900", "₪1,600 למ״ל"). */
export function Price({ p }: { p: PriceView }) {
  return (
    <span>
      {p.pre}
      <span className="ltr">{p.amount}</span>
      {p.post}
    </span>
  );
}

/** Services & prices accordion, one card per category, first open (design: openSvc = 0). */
export function Services({ groups, contact = true }: { groups: ServiceGroupView[]; contact?: boolean }) {
  const [open, setOpen] = useState(0);
  return (
    <div className={styles.list}>
      {groups.map((g, i) => {
        const on = open === i;
        const panelId = `svc-${g.key}`;
        return (
          <article key={g.key} className={styles.card} data-open={on || undefined}>
            <h3 className={styles.h}>
              <button type="button" className={styles.toggle} aria-expanded={on} aria-controls={panelId} onClick={() => setOpen(on ? -1 : i)}>
                <span className={styles.left}>
                  <span className={styles.icon} aria-hidden="true">
                    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#0B7A87" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {g.icon.map(d => <path key={d} d={d} />)}
                    </svg>
                  </span>
                  <span className={styles.names}>
                    <span className={styles.name}>{g.name}</span>
                    <span className={styles.meta}>{g.meta}</span>
                  </span>
                </span>
                <span className={styles.right}>
                  {g.from && (
                    <span className={styles.from}>
                      <Price p={g.from} />
                    </span>
                  )}
                  <span className={styles.plus} aria-hidden="true">+</span>
                </span>
              </button>
            </h3>
            {on && (
              <div id={panelId} className={styles.panel}>
                <ul className={styles.rows}>
                  {g.items.map(t => (
                    <li key={t.id} className={styles.row}>
                      <span className={styles.rowName}>
                        {t.name}
                        {t.duration && <span className={styles.dur}>{t.duration}</span>}
                      </span>
                      <span className={styles.rowPrice}>
                        {t.medical && <span className={styles.medTag}>בתיאום ייעוץ רפואי</span>}
                        <Price p={t.price} />
                      </span>
                    </li>
                  ))}
                </ul>
                <div className={styles.foot}>
                  {g.compare ? (
                    <Link href={g.compare.href} className={styles.compare}>
                      <span>{g.compare.label}</span>
                      <ArrowForward size={13} />
                    </Link>
                  ) : (
                    <span />
                  )}
                  {contact ? (
                    <ContactTrigger className={styles.ask} treatment={g.name}>
                      {g.medical ? 'פנייה לתיאום ייעוץ רפואי' : 'פנייה לעסק על הטיפול'}
                    </ContactTrigger>
                  ) : null}
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
