import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowForward } from '@/components/icons';
import type { Perms } from '@/lib/permissions';
import { Count, TREATMENTS } from '../charts/format';
import type { Task } from './tasks';
import s from './overview.module.css';

function note(t: Task): ReactNode {
  switch (t.key) {
    case 'menu':
      if (t.done) return 'כל הטיפולים עם מחיר בשקלים, בלי ״מחיר בהתאמה״';
      if (t.missing === undefined) return 'עדיין אין טיפולים בתפריט. הוסיפו טיפולים עם מחיר בשקלים';
      return <><Count n={t.missing} {...TREATMENTS} /> בלי מחיר. כל טיפול צריך מחיר בשקלים, בלי ״מחיר בהתאמה״</>;
    case 'hours':
      return 'כולל ציון מפורש של סגירה בשבת';
    case 'photos':
      if (t.done || !t.missing) return 'תמונות אמיתיות של הקליניקה, לא סטוק';
      return (
        <>
          {t.missing === 1 ? 'חסרה עוד תמונה אחת' : t.missing === 2 ? 'חסרות עוד שתי תמונות' : <>חסרות עוד <span className="ltr">{t.missing}</span> תמונות</>}
          . תמונות אמיתיות של הקליניקה, לא סטוק
        </>
      );
    case 'waze':
      return 'מפחית שיחות של ״איך מגיעים״ ומגדיל את מספר הפניות';
    case 'medical':
      return 'חובה בכל תחום שכולל הזרקה או פעולה חודרנית';
    case 'reviews': {
      const n = t.missing ?? 0;
      if (n === 0) return 'אין ביקורות שממתינות לתגובה';
      if (n === 1) return 'ביקורת אחת ממתינה לתגובה';
      if (n === 2) return 'שתי ביקורות ממתינות לתגובה';
      return <><span className="ltr">{n}</span> ביקורות ממתינות לתגובה</>;
    }
  }
}

/** Each item links to the tab that fixes it, when the viewer can open that tab. */
export function TaskList({ tasks, perms }: { tasks: Task[]; perms: Perms }) {
  return (
    <ul className={s.tasks}>
      {tasks.map(t => {
        const body = (
          <>
            <span aria-hidden="true" className={s.box}>
              {t.done ? (
                <svg width="12" height="12" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.8 7.6 6.6 11.4 15 3" />
                </svg>
              ) : null}
            </span>
            <span className={s.taskText}>
              <span className={s.taskName}>
                {t.name}
                <span className="sr-only">{t.done ? ': הושלם' : ': עדיין לא הושלם'}</span>
              </span>
              <span className={s.taskNote}>{note(t)}</span>
            </span>
          </>
        );
        const canOpen = perms[t.area] !== 'none';
        return (
          <li key={t.key}>
            {canOpen ? (
              <Link href={t.href} className={s.task} data-done={t.done || undefined}>
                {body}
                <ArrowForward size={14} className={s.taskGo} />
              </Link>
            ) : (
              <div className={s.task} data-done={t.done || undefined}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
