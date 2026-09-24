import Link from 'next/link';
import { contactHref, slaLine } from '@/components/contact/reasons';
import { ROUTES } from '@/lib/routes';
import styles from './states.module.css';

// Design: project/BeautyFind States.dc.html → "כרטיס לא מאומת".
// Rule: say plainly the details are unverified, and offer both an ownership claim and a correction report.

export function UnclaimedBanner({
  text = 'הכרטיס הזה אינו מנוהל על ידי העסק. הפרטים נאספו ממקורות פומביים וייתכן שאינם מעודכנים.',
  className,
}: {
  text?: string;
  className?: string;
}) {
  return (
    <div role="note" className={`${styles.banner}${className ? ` ${className}` : ''}`}>
      <p>{text}</p>
    </div>
  );
}

export interface UnclaimedFact {
  label: string;
  value: string;
  /** unknown = grey "לא ידוע"; warn = e.g. medical responsibility not declared. */
  tone?: 'default' | 'unknown' | 'warn';
  /** Phone numbers, prices and other latin/number values. */
  ltr?: boolean;
}

export function UnclaimedFacts({ facts }: { facts: UnclaimedFact[] }) {
  return (
    <dl className={styles.facts}>
      {facts.map(f => (
        <div key={f.label} className={styles.fact}>
          <dt>{f.label}</dt>
          <dd data-tone={f.tone ?? 'default'} className={f.ltr ? 'ltr' : undefined}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Claim, correction and "verified clinics nearby" cards.
 * `pageUrl` (the listing's path) prefills the correction form.
 */
export function UnclaimedActions({
  pageUrl,
  claimHref = ROUTES.claim,
  verifiedHref = '/search',
}: {
  pageUrl?: string;
  claimHref?: string;
  /** Verified clinics in the same area, e.g. the region or city page. */
  verifiedHref?: string;
}) {
  return (
    <div className={styles.sug} data-n={3}>
      <div className={`${styles.action} ${styles.actionPrimary}`}>
        <h3>זה העסק שלכם?</h3>
        <p>נהלו את הכרטיס בעצמכם, עדכנו טיפולים ושעות וקבלו פניות ישירות אליכם.</p>
        <Link href={claimHref} className={styles.btnPrimary}>בקשת בעלות</Link>
      </div>
      <div className={styles.action}>
        <h3>משהו כאן לא מדויק?</h3>
        <p>דיווח על פרט שגוי: {slaLine('correction')}.</p>
        <Link href={contactHref('correction', pageUrl ? { page: pageUrl } : undefined)} className={styles.btnSecondary}>דיווח על תיקון</Link>
      </div>
      <div className={styles.action}>
        <h3>מחפשים תור עכשיו?</h3>
        <p>קליניקות מאומתות באותו אזור עם יומן פעיל.</p>
        <Link href={verifiedHref} className={styles.btnSecondary}>קליניקות מאומתות</Link>
      </div>
    </div>
  );
}
