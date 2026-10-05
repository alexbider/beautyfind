import type { ReactNode } from 'react';
import { barShape, categoryBounds, isWideRange, priceSpeech, priceText, updatedLabel, type MarketPricesMeta, type PublicPriceItem } from '@/lib/marketPrices';
import shared from './shared.module.css';
import styles from './MarketPrices.module.css';
import { WideRangeBadge } from './WideRangeBadge';

// The "טווחי מחירים בשוק" section of a treatment category page: a real table (visually hidden caption), one row
// per treatment with its unit, its price and a decorative range bar on the category's shared track; under
// 640px the rows stack into cards through CSS while the table semantics stay. Everything renders on the
// server: no chart library, no client-only rendering, so every price is in the HTML. No Offer or
// PriceSpecification schema: these are market ranges, not prices the site sells at.

export function MarketPrices({
  meta,
  items,
  categoryName,
  freq,
  aesthetic,
  heading,
}: {
  meta: MarketPricesMeta;
  items: PublicPriceItem[];
  categoryName: string;
  /** "כל 4–6 חודשים": the category's typical frequency, shown as a chip. */
  freq: string;
  /** Medical and aesthetic categories add the "not in the סל" line under the footnote. */
  aesthetic: boolean;
  /** The h2, rendered by the page so its id and classes match the rest of the page. */
  heading: ReactNode;
}) {
  const bounds = categoryBounds(items);
  return (
    <section id="prices" aria-labelledby="h-prices" className={styles.section}>
      <header className={styles.head}>
        {heading}
        <p className={styles.intro}>{meta.intro}</p>
        <ul className={styles.chips} aria-label="על הנתונים">
          <li className={styles.chip}>{updatedLabel(meta.updated)}</li>
          {meta.includesVat && <li className={styles.chip}>כולל מע״מ</li>}
          {freq && <li className={styles.chip}>תדירות אופיינית: {freq}</li>}
        </ul>
      </header>

      {items.length === 0 ? (
        <p className={styles.empty}>עדיין אין טווחי מחירים לתחום הזה.</p>
      ) : (
        <table className={styles.table} data-scale={bounds.log ? 'log' : 'linear'}>
          <caption className="sr-only">טווחי מחירים בשוק לטיפולים הנפוצים בתחום {categoryName}, בשקלים כולל מע״מ</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.thLabel}>טיפול</th>
              <th scope="col" className={styles.thPrice}>טווח מחיר</th>
              <th scope="col" className={styles.thUnit}>יחידה</th>
              <th scope="col" className={styles.thBar}><span className="sr-only">מיקום בטווח התחום</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const shape = barShape(item, bounds);
              return (
                <tr key={item.label} className={styles.row}>
                  <th scope="row" className={styles.tdLabel}>
                    <span className={styles.labelRow}>
                      <span className={styles.label}>{item.label}</span>
                      {item.medical && <span className={`${styles.badge} ${styles.badgeMedical}`}>{meta.medicalLabel}</span>}
                      {isWideRange(item) && <WideRangeBadge label={meta.wideRangeLabel} tip={meta.wideRangeTooltip} />}
                    </span>
                    {item.note && <span className={styles.note}>{item.note}</span>}
                  </th>
                  <td className={styles.tdPrice}>
                    <bdi dir="ltr" className={styles.price} aria-hidden="true">{priceText(item)}</bdi>
                    <span className="sr-only">{priceSpeech(item)}</span>
                  </td>
                  <td className={styles.tdUnit}>
                    <span className={styles.unit}>{item.unit}</span>
                  </td>
                  <td className={styles.tdBar} aria-hidden="true">
                    <span className={styles.track} dir="ltr">
                      {shape.kind === 'dot' && <span className={styles.dot} style={{ left: `${shape.at}%` }} />}
                      {shape.kind === 'range' && <span className={styles.fill} style={{ left: `${shape.from}%`, width: `${Math.max(1.5, shape.to - shape.from)}%` }} />}
                      {shape.kind === 'open' && <span className={`${styles.fill} ${styles.fillOpen}`} style={{ left: `${shape.from}%`, width: `${Math.max(1.5, 100 - shape.from)}%` }} />}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <footer className={styles.foot}>
        <p className={shared.note}>{meta.footnote}</p>
        {aesthetic && <p className={shared.note}>טיפולים אסתטיים אלקטיביים אינם בסל הבריאות.</p>}
      </footer>
    </section>
  );
}
