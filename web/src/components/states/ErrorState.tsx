import Link from 'next/link';
import type { ReactNode } from 'react';
import { contactHref } from '@/components/contact/reasons';
import styles from './states.module.css';

// Design: project/BeautyFind States.dc.html → "תקלה".
// Rule: say the fault is ours, say the request was not carried out, and give a code and time
// that support can find in the log. At least two ways forward.

export function ErrorState({
  title = 'משהו נשבר אצלנו, לא אצלכם',
  body,
  onRetry,
  retryLabel = 'ניסיון חוזר',
  secondary,
  code,
  time,
  headingLevel = 'h2',
}: {
  title?: string;
  body: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Middle action, e.g. a call button or a link home. */
  secondary?: ReactNode;
  code?: string;
  /** Already formatted DD/MM/YYYY HH:MM. */
  time?: string;
  headingLevel?: 'h1' | 'h2';
}) {
  const H = headingLevel;
  return (
    <div className={`${styles.centerNarrow} ${styles.enter}`}>
      <span aria-hidden="true" className={styles.errIcon}>!</span>
      <H className={styles.h2}>{title}</H>
      <p className={styles.errLede}>{body}</p>
      <div className={styles.errActions}>
        {onRetry && (
          <button type="button" onClick={onRetry} className={styles.errPrimary}>{retryLabel}</button>
        )}
        {secondary}
        <Link href={contactHref('general', code ? { code: time ? `${code} ${time}` : code } : undefined)} className={styles.errGhost}>
          דיווח לתמיכה
        </Link>
      </div>
      {code && (
        <p className={styles.errCode}>
          קוד תקלה <strong className="ltr">{code}</strong>
          {time && (
            <>
              {' · '}
              <span className="ltr">{time}</span>
            </>
          )}
          . צטטו את הקוד בפנייה לתמיכה.
        </p>
      )}
    </div>
  );
}

/** Class names for callers building the secondary action (keeps one button style). */
export const errorStateClasses = { secondary: styles.errSecondary, primary: styles.errPrimary };
