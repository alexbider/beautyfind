'use client';

import { ErrorState, errorStateClasses } from '@/components/states';
import { TopBar } from '@/components/shell/TopBar';
import styles from '../error.module.css';

export function OfflineView() {
  return (
    <div className={styles.root}>
      <TopBar mode="root" />
      <main className={styles.main}>
        <ErrorState
          headingLevel="h1"
          title="אין חיבור לאינטרנט"
          body="הדף הזה צריך חיבור. קליניקות שצפיתם בהן לאחרונה נפתחות גם בלי רשת. מה שכבר מילאתם בטפסים נשמר במכשיר, ותשלום לא נשלח אף פעם בלי חיבור."
          onRetry={() => window.location.reload()}
          retryLabel="ניסיון חוזר"
          secondary={<a href="/" className={errorStateClasses.secondary}>לדף הבית</a>}
        />
      </main>
    </div>
  );
}
