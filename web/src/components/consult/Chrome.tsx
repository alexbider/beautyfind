import Link from 'next/link';
import { ArrowForward } from '@/components/icons';
import { Wordmark } from '@/components/Wordmark';
import styles from './consult.module.css';

/**
 * Page chrome from the design: white header bar with the wordmark, then the 1160px column.
 * `bare` drops the header, for pages inside the /clinic layout which has its own.
 */
export function ConsultChrome({ back, bare, children }: { back?: { href: string; label: string }; bare?: boolean; children: React.ReactNode }) {
  if (bare) {
    return (
      <div className={styles.root}>
        <div className={styles.page}>{children}</div>
      </div>
    );
  }
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerBar}>
          <Link href="/" aria-label="BeautyFind, לדף הבית" className={styles.brand}>
            <Wordmark size={21} />
          </Link>
          <span className={styles.grow} />
          {back && (
            <Link href={back.href} className={styles.backLink}>
              <span>{back.label}</span>
              <ArrowForward size={14} />
            </Link>
          )}
        </div>
      </header>
      <div className={styles.page}>{children}</div>
    </div>
  );
}
