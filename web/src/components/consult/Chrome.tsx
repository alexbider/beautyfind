import Link from 'next/link';
import { ArrowForward } from '@/components/icons';
import { Wordmark } from '@/components/Wordmark';
import styles from './consult.module.css';

/**
 * Page chrome from the design: white header bar with the wordmark, then the 1160px column.
 * `bare` drops the header, for pages inside the /clinic layout which has its own.
 * `flow` marks the patient flow: in the app shell the page renders its own flow top bar instead.
 */
export function ConsultChrome({ back, bare, flow, children }: { back?: { href: string; label: string }; bare?: boolean; flow?: boolean; children: React.ReactNode }) {
  if (bare) {
    return (
      <div className={styles.root}>
        <div className={styles.page}>{children}</div>
      </div>
    );
  }
  return (
    <div className={`${styles.root} ${flow ? styles.flowRoot : ''}`}>
      <header className={`${styles.header} ${flow ? 'bf-desk-only' : ''}`}>
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
