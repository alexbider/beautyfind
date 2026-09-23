import type { Metadata } from 'next';
import Link from 'next/link';
import { ClinicNav } from '@/components/clinic/ClinicNav';
import { CLINIC_NAV, clinicLevel } from '@/components/clinic/levels';
import { Wordmark } from '@/components/Wordmark';
import { PRESET_NAMES } from '@/lib/permissions';
import { bizContext } from '@/lib/server/biz';
import styles from './layout.module.css';

// Shared chrome for /clinic/* (the clinic system). Kept minimal: every page renders its own
// content and gates itself through clinicContext(); this only shows who and where you are.
// Visual language: the navy bar of BeautyFind Clinic Booking.dc.html.

export const metadata: Metadata = {
  title: { default: 'מערכת הקליניקה', template: '%s | מערכת הקליניקה' },
  robots: { index: false, follow: false },
};

export default async function ClinicLayout({ children }: { children: React.ReactNode }) {
  const ctx = await bizContext();
  const items = CLINIC_NAV.filter(n => clinicLevel(ctx, n.area) !== 'none').map(({ name, href }) => ({ name, href }));
  const name = ctx.branch?.name ?? 'העסק שלי';
  const viewer = `${ctx.member.displayName} · ${PRESET_NAMES[ctx.role].name}`;

  return (
    <div className={styles.root} dir="rtl" lang="he">
      <header className={styles.header}>
        <div className={styles.bar}>
          <Link href="/clinic" aria-label="מערכת הקליניקה" className={styles.brand}>
            <Wordmark size={21} onDark />
          </Link>
          <span aria-hidden="true" className={styles.divider} />
          <span className={styles.bizName}>{name}</span>
          <span className={styles.viewer}>{viewer}</span>
          <Link href="/biz" className={styles.bizLink}>
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 7H2M6 3 2 7l4 4" /></svg>
            ללוח הבקרה
          </Link>
        </div>
        {items.length > 1 && (
          <div className={styles.navBar}>
            <ClinicNav items={items} />
          </div>
        )}
      </header>
      <main>{children}</main>
    </div>
  );
}
