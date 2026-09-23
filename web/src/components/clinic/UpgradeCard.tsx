import Link from 'next/link';
import { PLAN_MONTHLY_NIS, PLATFORM_PRICE_NOTE } from '@/lib/pricing';
import styles from './ClinicBooking.module.css';

/** Clinic system areas are advanced-plan only; on the basic plan the page shows this instead. */
export function UpgradeCard({ area }: { area: string }) {
  return (
    <section className={`${styles.card} ${styles.upgrade}`} aria-labelledby="clinic-upgrade">
      <h1 id="clinic-upgrade" className={styles.upgradeTitle}>{area} זמינים ברישום המתקדם</h1>
      <p className={styles.actBody}>
        תורים, הצהרות בריאות, רישום קליני, רשימת המתנה ושוברי מתנה הם חלק ממערכת הקליניקה של רישום מתקדם + CRM,
        {' '}<span className="ltr">₪{PLAN_MONTHLY_NIS.advanced}</span> לחודש לסניף, {PLATFORM_PRICE_NOTE}.
      </p>
      <Link href="/biz/billing" className={styles.primaryLink}>שדרוג המנוי</Link>
    </section>
  );
}
