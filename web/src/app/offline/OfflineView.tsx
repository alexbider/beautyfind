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
          body="הדף הזה דורש חיבור לאינטרנט. קליניקות שצפיתם בהן לאחרונה נפתחות גם בלי רשת. מה שכבר מילאתם בטפסים נשמר במכשיר, ותשלום לעולם לא נשלח בלי חיבור."
          onRetry={() => window.location.reload()}
          retryLabel="ניסיון חוזר"
          secondary={<a href="/" className={errorStateClasses.secondary}>לדף הבית</a>}
        />
      </main>
    </div>
  );
}
