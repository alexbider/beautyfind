import Link from 'next/link';
import { TopBar } from '@/components/shell/TopBar';
import { WHY } from './constants';
import styles from './consult.module.css';

/**
 * The clinic isn't on the clinic system (basic plan) or has no verified doctor with a calendar:
 * no online consult, so send the client to the profile's contact form instead.
 */
export function ConsultUnavailable({ branchName, place, contactHref, closeHref }: { branchName: string; place: string; contactHref: string; closeHref: string }) {
  return (
    <>
      <TopBar mode="flow" title="בקשת ייעוץ" noBack closeHref={closeHref} />
      <div className={styles.flowBody}>
        <h1 className={styles.h1}>בקשת ייעוץ לפני הזרקה</h1>
        <p className={styles.lead}>
          בוטוקס וחומרי מילוי הם טיפול רפואי. לפני שקובעים טיפול, רופא/ה צריך/ה לראות אותך, לשמוע מה חשוב לך ולהחליט אם ובאיזו כמות זה מתאים.
        </p>
        <div className={styles.shell}>
          <main className={styles.main}>
            <section aria-labelledby="cs-na" className={styles.card}>
              <h2 id="cs-na" className={`${styles.h2} ${styles.h2Gap}`}>תיאום ייעוץ ישירות מול הקליניקה</h2>
              <p className={styles.hint} style={{ color: 'var(--text)', fontSize: 15 }}>
                ב{branchName} עדיין אין קביעת ייעוץ אונליין. אפשר לשלוח פנייה לקליניקה, והצוות יחזור אלייך לתיאום מועד לייעוץ.
              </p>
              <div className={styles.row}>
                <Link href={contactHref} className={styles.btnLink}>פנייה לקליניקה</Link>
              </div>
            </section>
          </main>
          <aside className={styles.aside}>
            <div className={styles.cardTeal}>
              <dl className={styles.facts}>
                <dt>קליניקה</dt>
                <dd>{place}</dd>
              </dl>
            </div>
            <div className={styles.whyCard}>
              <h2 className={styles.whyH}>למה ייעוץ ולא תור ישיר</h2>
              <ul className={styles.whyList}>
                {WHY.map(w => (
                  <li key={w}>
                    <span aria-hidden="true" className={styles.dot} />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
