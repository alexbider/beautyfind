'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { ErrorState, errorStateClasses } from '@/components/states';
import { ROUTES } from '@/lib/routes';
import styles from './error.module.css';

// Design: project/BeautyFind States.dc.html → "תקלה".

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

/** DD/MM/YYYY HH:MM in Israel time. */
const stamp = (d: Date) => fmt.format(d).replace(',', '');

export default function ErrorPage({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  const [time, setTime] = useState<string>();

  useEffect(() => {
    console.error('[error boundary]', error.digest ?? '', error);
    setTime(stamp(new Date()));
  }, [error]);

  const code = error.digest ? `ERR-${error.digest}` : 'ERR-CLIENT';

  return (
    <div className={styles.root}>
      <SiteHeader variant="public" title="תקלה" backHref="/" />
      <main className={styles.main}>
        <ErrorState
          headingLevel="h1"
          body="לא הצלחנו לטעון את העמוד. שום שינוי לא נשמר בגלל התקלה הזו, ואפשר לנסות שוב בבטחה."
          onRetry={() => (retry ?? reset)?.()}
          secondary={<Link href={ROUTES.home} className={errorStateClasses.secondary}>לדף הבית</Link>}
          code={code}
          time={time}
        />
      </main>
    </div>
  );
}
