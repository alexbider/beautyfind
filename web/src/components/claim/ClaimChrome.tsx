import Link from 'next/link';
import { nis } from '@/lib/format';
import { PLAN_MONTHLY_NIS } from '@/lib/pricing';
import { ROUTES } from '@/lib/routes';
import { Wordmark } from '../Wordmark';
import styles from './Claim.module.css';

const NAV = [
  { name: 'רישום עסק', href: ROUTES.forBusiness },
  { name: 'תקן הרישום', href: ROUTES.listingStandards },
  { name: 'מידע על פרסום', href: ROUTES.sponsorship },
];

const FOOT_LINKS = [
  ...NAV,
  { name: 'תנאי שימוש', href: ROUTES.terms },
  { name: 'יצירת קשר', href: ROUTES.contact },
];

/** Slim business header with the flow's progress bar (0 to 100). */
export function ClaimHeader({ progress }: { progress: number }) {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href={ROUTES.home} aria-label="BeautyFind, לדף הבית" className={styles.brand}>
          <Wordmark size={28} />
        </Link>
        <nav aria-label="ראשי" className={styles.nav}>
          {NAV.map(l => (
            <Link key={l.href} href={l.href} className={styles.navLink}>{l.name}</Link>
          ))}
        </nav>
        <Link href={ROUTES.contact} className={styles.helpDesk}>צריכים עזרה?</Link>
        <Link href={ROUTES.contact} className={styles.helpMobile}>עזרה</Link>
      </div>
      <div aria-hidden="true" className={styles.progress}>
        <div className={styles.progressBar} style={{ width: `${progress}%` }} />
      </div>
    </header>
  );
}

export function ClaimFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerTop}>
        <div className={styles.footerAbout}>
          <Wordmark size={26} onDark />
          <p>
            אישור בעלות חינם. רישום מלא <span className="ltr">{nis(PLAN_MONTHLY_NIS.basic)}</span> לחודש, לא כולל מע״מ, ללא התחייבות.
          </p>
        </div>
        <nav aria-label="קישורים לעסקים" className={styles.footerNav}>
          {FOOT_LINKS.map(l => (
            <Link key={l.href} href={l.href} className={styles.footerLink}>{l.name}</Link>
          ))}
        </nav>
      </div>
      <div className={styles.footerBottom}>
        <span>© 2026 BeautyFind · Israfind Group</span>
        <span>מידע כללי בלבד, לא ייעוץ רפואי</span>
      </div>
    </footer>
  );
}
