import Link from 'next/link';
import styles from './OpsHeader.module.css';

type Section = 'admin' | 'moderation' | 'verification';

const NAV: Array<{ key: Section; name: string; href: string }> = [
  { key: 'admin', name: 'ניהול', href: '/ops' },
  { key: 'moderation', name: 'ביקורות', href: '/ops/moderation' },
  { key: 'verification', name: 'אימות', href: '/ops/verification' },
];

/**
 * The dark BeautyFind staff bar shared by Admin, Moderation and Verification. Desktop only: on phones
 * each screen shows the app shell top bar (staff have no tab bar, spec §2.2).
 */
export function OpsHeader({ current, who }: { current: Section; who: string }) {
  return (
    <header className={`${styles.bar} bf-desk-only`}>
      <div className={styles.inner}>
        <Link href="/ops" dir="ltr" className={styles.mark} aria-label="BeautyFind, ניהול">
          beauty<span className={styles.markFind}>find.</span>
        </Link>
        <nav aria-label="צוות BeautyFind" className={styles.nav}>
          {NAV.map(n =>
            n.key === current ? (
              <span key={n.key} aria-current="page" className={`${styles.link} ${styles.on}`}>
                {n.name}
              </span>
            ) : (
              <Link key={n.key} href={n.href} className={styles.link}>
                {n.name}
              </Link>
            ),
          )}
        </nav>
        <span className={styles.who}>{who}</span>
      </div>
    </header>
  );
}
