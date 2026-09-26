'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowForward } from '@/components/icons';
import { ContactTrigger } from './ContactDialog';
import { PRICE_UNKNOWN, PRICE_UNKNOWN_ACTION, PRICE_UNKNOWN_NOTE, type PriceView } from './format';
import styles from './Services.module.css';

export interface ServiceItemView {
  id: string;
  name: string;
  price: PriceView;
  duration: string | null;
  medical: boolean;
  summary: string | null;
  bookable: boolean; // native booking available for this service
}

export interface ServiceGroupView {
  key: string;
  name: string;
  meta: string; // "4 אפשרויות"
  icon: string[];
  from: PriceView | null; // from comparable known prices only
  quoteCount: number; // services in the group without a published price
  medical: boolean;
  compare: { href: string; label: string } | null;
  items: ServiceItemView[];
}

/** Price with its Hebrew wording outside and the amount in an LTR span ("החל מ־₪900", "₪1,600 למ״ל"). */
export function Price({ p }: { p: PriceView }) {
  if (p.kind === 'unknown') return <span className={styles.unknown}>{PRICE_UNKNOWN}</span>;
  if (p.kind === 'free') return <span>ללא עלות לפי פרסום העסק</span>;
  return (
    <span>
      {p.pre}
      <span className="ltr">{p.amount}</span>
      {p.post}
    </span>
  );
}

/**
 * Services & prices accordion, one card per category, first open (design: openSvc = 0).
 * `contact`: whether a request can be sent through the platform (claimed listing with a lead inbox);
 * otherwise the quote action opens the direct-contact panel. Both carry the service id.
 */
export function Services({ groups, contact = true, bookHref }: { groups: ServiceGroupView[]; contact?: boolean; bookHref?: string | null }) {
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
                    <span className={styles.meta}>
                      {g.meta}
                      {g.quoteCount > 0 && g.quoteCount < g.items.length ? ` · ${g.quoteCount === 1 ? 'אחת בתיאום מחיר' : `${g.quoteCount} בתיאום מחיר`}` : ''}
                    </span>
                  </span>
                </span>
                <span className={styles.right}>
                  {g.from ? (
                    <span className={styles.from}>
                      <Price p={g.from} />
                    </span>
                  ) : (
                    <span className={`${styles.from} ${styles.fromUnknown}`}>בתיאום מחיר</span>
                  )}
                  <span className={styles.plus} aria-hidden="true">+</span>
                </span>
              </button>
            </h3>
            {on && (
              <div id={panelId} className={styles.panel}>
                <ul className={styles.rows}>
                  {g.items.map(t => (
                    <li key={t.id} className={styles.row} data-unknown={t.price.kind === 'unknown' || undefined}>
                      <span className={styles.rowName}>
                        {t.name}
                        {t.duration && <span className={styles.dur}>{t.duration}</span>}
                        {t.summary && <span className={styles.summary}>{t.summary}</span>}
                      </span>
                      <span className={styles.rowPrice}>
                        {t.medical && <span className={styles.medTag}>בתיאום ייעוץ רפואי</span>}
                        <Price p={t.price} />
                        {t.price.kind === 'unknown' && (
                          <ContactTrigger className={styles.quote} treatment={t.name} serviceId={t.id}>
                            {PRICE_UNKNOWN_ACTION}
                          </ContactTrigger>
                        )}
                        {t.bookable && bookHref && t.price.kind !== 'unknown' && (
                          <Link href={`${bookHref}?service=${t.id}`} className={styles.book}>קביעת תור</Link>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {g.quoteCount > 0 && <p className={styles.quoteNote}>{PRICE_UNKNOWN_NOTE}</p>}
                <div className={styles.foot}>
                  {g.compare ? (
                    <Link href={g.compare.href} className={styles.compare}>
                      <span>{g.compare.label}</span>
                      <ArrowForward size={13} />
                    </Link>
                  ) : (
                    <span />
                  )}
                  <ContactTrigger className={styles.ask} treatment={g.name}>
                    {g.medical ? (contact ? 'פנייה לתיאום ייעוץ רפואי' : 'בקשת ייעוץ') : contact ? 'פנייה לעסק על הטיפול' : 'בירור זמינות'}
                  </ContactTrigger>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

/** The section when no service is substantiated: kept, honest, with the contact action. */
export function ServicesEmpty({ contact }: { contact: boolean }) {
  return (
    <div className={styles.emptyBox}>
      <p className={styles.emptyText}>פירוט השירותים טרם עודכן. {contact ? 'אפשר לשאול את העסק ישירות על הטיפולים והמחירים.' : 'לפרטים על הטיפולים והמחירים פונים לעסק ישירות.'}</p>
      <ContactTrigger className={styles.ask}>{contact ? 'פנייה לעסק' : 'בירור זמינות'}</ContactTrigger>
    </div>
  );
}
