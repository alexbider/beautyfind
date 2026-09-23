import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { bookingIdFromToken } from '@/lib/server/booking';
import { receiptForBooking } from '@/components/receipt/data';
import { ReceiptShell, ReceiptView } from '@/components/receipt/ReceiptView';
import styles from '@/components/receipt/receipt.module.css';

// Design: project/BeautyFind Receipt.dc.html. /b/:token/receipt: every payment of ONE booking,
// reachable with the signed guest token only (no login). A bad token is a 404.

export const metadata: Metadata = {
  title: 'קבלות וחשבוניות',
  description: 'חשבונית מס / קבלה, חשבונית זיכוי ומעקב החזר לתור.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function BookingReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const bookingId = bookingIdFromToken(token);
  if (!bookingId) notFound();
  const data = await receiptForBooking(bookingId);

  return (
    <ReceiptShell title="קבלות וחשבוניות" back={{ href: `/b/${token}`, label: 'לפרטי התור' }}>
      {data ? (
        <ReceiptView data={data} />
      ) : (
        <div className={styles.state}>
          <h1 className={styles.stateTitle}>אין תשלומים לתור הזה</h1>
          <p className={styles.stateText}>
            לא שולמה מקדמה דרך BeautyFind. תשלום על הטיפול עצמו נעשה בקליניקה, והיא מנפיקה את החשבונית ישירות.
          </p>
          <Link href={`/b/${token}`} className={styles.stateBtn}>לפרטי התור</Link>
        </div>
      )}
    </ReceiptShell>
  );
}
