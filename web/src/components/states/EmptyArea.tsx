import Link from 'next/link';
import { contactHref } from '@/components/contact/reasons';
import { ROUTES } from '@/lib/routes';
import styles from './states.module.css';

// Design: project/BeautyFind States.dc.html → "אזור ללא עסקים".
// Rule: never fill an empty area with unverified businesses. Point to nearby areas and invite listings.

export interface NearbyArea {
  name: string;
  note?: string;
  /** Verified businesses there. */
  count: number;
  href: string;
}

/** קליניקה מאומתת אחת · שתי קליניקות מאומתות · N קליניקות מאומתות */
export const verifiedClinics = (n: number) => (n === 1 ? 'קליניקה מאומתת אחת' : n === 2 ? 'שתי קליניקות מאומתות' : `${n} קליניקות מאומתות`);

export function EmptyArea({
  areaName,
  nearby,
  joinHref = ROUTES.forBusiness,
  recommendHref = contactHref('business'),
}: {
  /** As it follows "ב": "ערבה" → "בערבה". */
  areaName: string;
  nearby: NearbyArea[];
  joinHref?: string;
  recommendHref?: string;
}) {
  return (
    <div className={styles.enter}>
      <div className={styles.areaHead}>
        <span className={styles.pillWarn}>אזור בהקמה</span>
        <h2 className={styles.h2}>עדיין אין קליניקות מאומתות ב{areaName}</h2>
        <p className={styles.lede}>
          אנחנו לא מציגים עסקים שלא עברו אימות, גם במחיר של עמוד ריק.{nearby.length > 0 && ' עד שיצטרפו, הנה מה שיש בסביבה הקרובה.'}
        </p>
      </div>

      {nearby.length > 0 && (
        <div className={`${styles.sug} ${styles.nearby}`} data-n={Math.min(nearby.length, 3)}>
          {nearby.map(n => (
            <Link key={n.href} href={n.href} className={`${styles.sugCard} ${styles.sugCardLg}`}>
              <span className={styles.sugText}>
                <span className={styles.sugName}>{n.name}</span>
                {n.note && <span className={styles.sugNote}>{n.note}</span>}
              </span>
              <span aria-hidden="true" className={`${styles.sugNum} ltr`}>{n.count}</span>
              <span className="sr-only">, {verifiedClinics(n.count)}</span>
            </Link>
          ))}
        </div>
      )}

      <div className={styles.pair}>
        <div className={`${styles.action} ${styles.actionPrimary}`}>
          <h3>יש לכם קליניקה ב{areaName}?</h3>
          <p>רישום ראשון באזור חדש מקבל ליווי אישי בהקמת הכרטיס.</p>
          <Link href={joinHref} className={styles.btnPrimary}>רישום העסק</Link>
        </div>
        <div className={styles.action}>
          <h3>מכירות מטפלת באזור?</h3>
          <p>ספרו לנו והצוות יפנה אליה. אנחנו בונים את המדריך מלמטה למעלה.</p>
          <Link href={recommendHref} className={styles.btnSecondary}>המלצה על עסק</Link>
        </div>
      </div>
    </div>
  );
}
