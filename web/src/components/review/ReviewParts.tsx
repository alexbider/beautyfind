import Link from 'next/link';
import type { ReactNode, Ref } from 'react';
import { Wordmark } from '@/components/Wordmark';
import { ROUTES } from '@/lib/routes';
import { publishedAs, starsText, type SubmittedSummary } from './shared';
import styles from './Review.module.css';

// Server-safe parts of the review page: the frame, the success card and simple state cards.

export const CheckIcon = ({ size = 12, width = 2.2 }: { size?: number; width?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 7.5 5.5 10.5 11.5 4" />
  </svg>
);

const ClockIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export function ReviewShell({ children }: { children: ReactNode }) {
  return (
    <div dir="rtl" lang="he" className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href={ROUTES.home} className={styles.logo} aria-label="BeautyFind, לדף הבית">
            <Wordmark size={21} />
          </Link>
          <span className={styles.spacer} />
          <Link href={ROUTES.account} className={styles.headLink}>
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 7H2M6 3 2 7l4 4" />
            </svg>
            <span>לחשבון שלי</span>
          </Link>
        </div>
      </header>
      <main className={styles.wrap}>{children}</main>
    </div>
  );
}

/** Success card (design isDone), also shown when the review was already sent. */
export function ReviewDone({
  summary,
  clientName,
  status = 'submitted',
  profileHref,
  headingRef,
}: {
  summary: SubmittedSummary;
  clientName: string;
  status?: 'submitted' | 'published' | 'rejected' | 'removed';
  profileHref: string;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const withPhotos = summary.photos > 0 && summary.photoConsent;
  const title = status === 'published' ? 'הביקורת פורסמה' : status === 'submitted' ? 'הביקורת נשלחה' : 'הביקורת לא פורסמה';
  const body =
    status === 'published' ? (
      'הביקורת שלך מופיעה בפרופיל הקליניקה. תודה שעזרת ללקוחות הבאות לבחור נכון.'
    ) : status === 'submitted' ? (
      <>
        {withPhotos ? 'הביקורת והתמונות נבדקות' : 'הביקורת נבדקת'} לפני פרסום, בדרך כלל בתוך <span dir="ltr" className="ltr">6</span> שעות. נעדכן בוואטסאפ כשהיא תעלה.
      </>
    ) : (
      'הביקורת לא עמדה בכללי הפרסום. שלחנו לך הודעה עם ההסבר.'
    );
  return (
    <div className={styles.done}>
      <span aria-hidden="true" className={styles.doneIcon}>
        <CheckIcon size={27} width={2} />
      </span>
      <h1 className={styles.doneH} ref={headingRef} tabIndex={-1}>
        {title}
      </h1>
      <p className={styles.doneP}>{body}</p>
      <dl className={styles.doneDl}>
        <dt>דירוג</dt>
        <dd>
          <span dir="ltr" className={`ltr ${styles.doneStars}`} aria-hidden="true">
            {starsText(summary.rating)}
          </span>
          <span className="sr-only">{`${summary.rating} מתוך 5`}</span>
        </dd>
        <dt>כותרת</dt>
        <dd>{summary.title}</dd>
        <dt>פרסום</dt>
        <dd>{publishedAs(summary.nameMode, clientName)}</dd>
      </dl>
      <div className={styles.actions}>
        <Link href={ROUTES.account} className={styles.btn}>
          לביקורות שלי
        </Link>
        <Link href={profileHref} className={styles.btnGhost}>
          לפרופיל הקליניקה
        </Link>
      </div>
    </div>
  );
}

export function ReviewState({ title, children, actions, waiting = false }: { title: string; children: ReactNode; actions?: ReactNode; waiting?: boolean }) {
  return (
    <div className={`${styles.done} ${styles.plain}`}>
      {waiting && (
        <span aria-hidden="true" className={`${styles.doneIcon} ${styles.doneIconMuted}`}>
          <ClockIcon />
        </span>
      )}
      <h1 className={styles.doneH}>{title}</h1>
      <p className={styles.doneP}>{children}</p>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
