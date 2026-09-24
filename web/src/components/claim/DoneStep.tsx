import Link from 'next/link';
import type { RefObject } from 'react';
import { ROUTES } from '@/lib/routes';
import { ArrowForward } from '../icons';
import styles from './Claim.module.css';

const NEXT_STEPS = [
  { name: 'תפריט מחירים', body: 'לפחות חמישה טיפולים עם מחיר בשקלים, לא כולל מע״מ. זה השדה שמביא פניות.' },
  { name: 'תמונות של המקום', body: 'שלוש תמונות אמיתיות של הקליניקה או הסטודיו. תמונות סטוק מוסרות.' },
  { name: 'קישור Waze', body: 'מוסיפים ניווט בלחיצה אחת, וזה מפחית שיחות של ״איך מגיעים״.' },
  { name: 'תגובה לביקורות', body: 'אפשר להגיב בשם העסק. התגובה מוצגת לצד הביקורת המקורית.' },
];

interface Props {
  headingRef: RefObject<HTMLHeadingElement | null>;
  bizName: string;
  refCode: string;
  onRestart: () => void;
}

// Ownership is granted only after BeautyFind approves the request, so this state
// confirms the submission and its ref instead of the prototype's "ownership approved".
export function DoneStep({ headingRef, bizName, refCode, onRestart }: Props) {
  return (
    <section aria-labelledby="h-done" className={styles.doneSection}>
      <span aria-hidden="true" className={styles.doneMark}>
        <svg width="23" height="23" viewBox="0 0 18 18" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.8 7.6 6.6 11.4 15 3" />
        </svg>
      </span>
      <h2 id="h-done" ref={headingRef} tabIndex={-1} className={styles.h2}>
        הבקשה התקבלה<span className={styles.dot}>.</span>
      </h2>
      <p className={`${styles.lede} ${styles.doneLede}`}>
        הבקשה לאישור בעלות על <strong>{bizName}</strong> ממתינה לבדיקה, מספר הבקשה <span className={`${styles.strong} ltr`}>{refCode}</span>. בדרך כלל אנחנו בודקים בתוך יום עסקים ומעדכנים בדוא״ל. בינתיים אפשר להכין את מה שנשאר: תפריט המחירים הוא הדבר הראשון שלקוחות מחפשים.
      </p>
      <ol className={styles.nextSteps}>
        {NEXT_STEPS.map((n, i) => (
          <li key={n.name} className={styles.nextStep}>
            <span aria-hidden="true" className={styles.nextNum}>{i + 1}</span>
            <span className={styles.nextText}>
              <span className={styles.nextName}>{n.name}</span>
              <span className={styles.nextBody}>{n.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className={styles.doneActions}>
        <Link href={ROUTES.dashboard} className={styles.linkDark}>
          <span>ללוח הבקרה</span>
          <ArrowForward />
        </Link>
        <button type="button" className={styles.btnGhost} onClick={onRestart}>אישור עסק נוסף</button>
      </div>
    </section>
  );
}
