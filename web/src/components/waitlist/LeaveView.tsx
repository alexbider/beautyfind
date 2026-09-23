'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { haptic } from '@/components/shell/haptics';
import { ROUTES } from '@/lib/routes';
import styles from './Waitlist.module.css';

// Leave the waitlist from a signed link. GET never changes anything (link previews open it);
// the button does.

export function LeaveView({
  token,
  treatmentName,
  branchLabel,
  rejoinHref,
  leave,
}: {
  token: string;
  treatmentName: string | null;
  branchLabel: string;
  rejoinHref: string;
  leave: (token: string) => Promise<{ ok: boolean }>;
}) {
  const [state, setState] = useState<'ask' | 'left' | 'error'>('ask');
  const [pending, start] = useTransition();
  const h = useRef<HTMLHeadingElement>(null);

  const go = () =>
    start(async () => {
      const r = await leave(token).catch(() => ({ ok: false }));
      setState(r.ok ? 'left' : 'error');
      haptic(r.ok ? 'success' : 'warning');
      requestAnimationFrame(() => h.current?.focus());
    });

  if (state === 'left') {
    return (
      <div className={`${styles.done} ${styles.center}`}>
        <h1 className={styles.doneH} ref={h} tabIndex={-1}>
          יצאת מרשימת ההמתנה
        </h1>
        <p className={styles.doneP}>לא נשלח לך עוד הודעות על תורים שמתפנים לטיפול הזה. אפשר להצטרף שוב בכל זמן.</p>
        <div className={styles.actions}>
          <Link href={rejoinHref} className={styles.btn}>
            הצטרפות מחדש
          </Link>
          <Link href={ROUTES.home} className={styles.btnGhost}>
            לדף הבית
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.done} ${styles.plain} ${styles.center}`}>
      <h1 className={styles.doneH} ref={h} tabIndex={-1}>
        יציאה מרשימת ההמתנה
      </h1>
      <p className={styles.doneP}>
        {treatmentName ? `${treatmentName} · ` : ''}
        {branchLabel}. אחרי היציאה לא נשלח לך הצעות לתורים שמתפנים, והמקום שלך ברשימה עובר לבאה בתור.
      </p>
      {state === 'error' && (
        <p role="alert" className={`${styles.alert} ${styles.alertGap}`}>
          לא הצלחנו להוציא אותך מהרשימה. נסי שוב בעוד רגע.
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={go} disabled={pending}>
          {pending ? 'רגע…' : 'יציאה מהרשימה'}
        </button>
        <Link href={ROUTES.home} className={styles.btnGhost}>
          להישאר ברשימה
        </Link>
      </div>
    </div>
  );
}
