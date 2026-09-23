import type { Metadata } from 'next';
import Link from 'next/link';
import { ROUTES } from '@/lib/routes';
import { ilDate } from '@/lib/time';
import { ReviewForm } from '@/components/review/ReviewForm';
import { ReviewDone, ReviewShell, ReviewState } from '@/components/review/ReviewParts';
import styles from '@/components/review/Review.module.css';
import { loadReviewBooking, summaryOf, treatmentLabel } from './review';

// Design: project/BeautyFind Review.dc.html. Link from M6 (review request, 3 days after the visit).
// The token is the booking's guest token (lib/server/booking.ts bookingToken).

export const metadata: Metadata = {
  title: 'כתיבת ביקורת',
  description: 'ביקורת מאומתת ב־BeautyFind: דירוג, חוויה בפועל, תמונות בהסכמה, ופרסום לאחר בדיקה.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

const CLOSED = new Set(['cancelled_client', 'cancelled_clinic', 'no_show', 'abandoned']);

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = /^[0-9a-f]{32}\.[0-9a-f]{32}$/.test(token) ? await loadReviewBooking(token) : null;
  const home = (
    <Link href={ROUTES.home} className={styles.btn}>
      לדף הבית
    </Link>
  );

  if (!b) {
    return (
      <ReviewShell>
        <ReviewState title="הקישור לא תקין" actions={home}>
          ייתכן שהקישור הועתק חלקית. אפשר לפתוח אותו שוב מההודעה שקיבלת אחרי הביקור.
        </ReviewState>
      </ReviewShell>
    );
  }

  const profileHref = `/${b.branch.regionSlug}/biz/${b.branch.slug}`;

  if (b.review) {
    return (
      <ReviewShell>
        <ReviewDone summary={summaryOf(b.review)} clientName={b.clientName} status={b.review.status} profileHref={profileHref} />
      </ReviewShell>
    );
  }

  if (b.status !== 'completed') {
    const closed = CLOSED.has(b.status);
    return (
      <ReviewShell>
        <ReviewState
          waiting={!closed}
          title={closed ? 'אין ביקור לדרג' : 'אפשר לכתוב ביקורת אחרי הביקור'}
          actions={
            <>
              {!closed && (
                <Link href={`/b/${token}`} className={styles.btn}>
                  לפרטי התור
                </Link>
              )}
              <Link href={profileHref} className={closed ? styles.btn : styles.btnGhost}>
                לפרופיל הקליניקה
              </Link>
            </>
          }
        >
          {closed ? (
            'ב־BeautyFind מתפרסמות רק ביקורות על ביקורים שהתקיימו בפועל, והתור הזה לא התקיים.'
          ) : (
            <>
              ב־BeautyFind כותבים ביקורת רק על ביקור שהתקיים בפועל. אחרי הטיפול ב{b.branch.name} נשלח לך הודעה, והקישור הזה ייפתח לכתיבה.
            </>
          )}
        </ReviewState>
      </ReviewShell>
    );
  }

  return (
    <ReviewShell form>
      <ReviewForm
        token={token}
        profileHref={profileHref}
        visit={{
          branch: `${b.branch.name} · ${b.branch.cityName}`,
          treatment: treatmentLabel(b),
          practitioner: b.practitioner?.displayName ?? null,
          date: ilDate(b.startsAt),
          ref: b.ref,
          clientName: b.clientName,
        }}
      />
    </ReviewShell>
  );
}
