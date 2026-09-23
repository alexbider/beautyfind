import type { Metadata } from 'next';
import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';
import { contactsFor, maskContact, senderName } from '@/components/unsubscribe/data';
import { CHANNELS, parseUnsubscribeToken } from '@/components/unsubscribe/token';
import { UnsubscribeForm } from '@/components/unsubscribe/UnsubscribeForm';
import styles from '@/components/unsubscribe/unsubscribe.module.css';

// Design: project/BeautyFind Unsubscribe.dc.html. /unsubscribe/:token, no login needed.
// The token is HMAC-signed { contact, scope, channel } (components/unsubscribe/token.ts, unsubscribeUrl()).

export const metadata: Metadata = {
  title: 'הסרה מדיוור',
  description: 'הסרה מרשימת דיוור: בחירה לפי קליניקה וערוץ. הודעות על תורים ממשיכות להגיע.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = parseUnsubscribeToken(token);

  let body: React.ReactNode;
  if (!t) {
    body = (
      <div className={styles.invalid}>
        <h1 className={styles.h1}>הקישור לא תקין</h1>
        <p>ייתכן שהקישור הועתק חלקית. כדי להפסיק לקבל דיוור, אפשר לשלוח ״הסר״ בתשובה להודעה שקיבלת, וזה נכנס לתוקף מיד.</p>
        <p>
          אם יש לך חשבון, אפשר לנהל את כל ההעדפות <Link href="/account?tab=settings">בחשבון שלי</Link>.
        </p>
      </div>
    );
  } else {
    const [source, avail] = await Promise.all([senderName(t.scope), contactsFor(t)]);
    const channels = CHANNELS.filter(c => !!avail.contacts[c]);
    body = (
      <UnsubscribeForm
        token={token}
        source={source}
        masked={maskContact(t.contact)}
        channel={t.channel}
        channels={channels}
        allOnly={t.scope === 'all'}
      />
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerIn}>
          <Link href="/" aria-label="BeautyFind, לדף הבית" className={styles.logo}><Wordmark size={21} /></Link>
        </div>
      </header>
      <main className={styles.wrap}>{body}</main>
    </div>
  );
}
