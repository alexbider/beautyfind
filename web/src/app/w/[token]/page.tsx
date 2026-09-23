import type { Metadata } from 'next';
import Link from 'next/link';
import { ROUTES } from '@/lib/routes';
import { addDays, hhmm, ilDateKey, ilParts } from '@/lib/time';
import { OfferView, type OfferViewData } from '@/components/waitlist/OfferView';
import { DAY_SHORT, OFFER_TOKEN_RE, pad2 } from '@/components/waitlist/shared';
import { PublicShell, StateCard } from '@/components/waitlist/ui';
import styles from '@/components/waitlist/Waitlist.module.css';
import { loadOffer } from '../offers';
import { acceptOfferAction, passOfferAction } from './actions';

// Design: project/BeautyFind Waitlist.dc.html (view=offer). Link from M7 (05-messages.md).
// Rendering closes an offer whose hold has passed and moves the slot to the next match.

export const metadata: Metadata = {
  title: 'התפנה תור',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

export default async function WaitlistOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const o = OFFER_TOKEN_RE.test(token) ? await loadOffer(token) : null;

  if (!o) {
    return (
      <PublicShell accountLink>
        <StateCard
          title="הקישור לא תקין"
          actions={
            <Link href={ROUTES.home} className={styles.btn}>
              לדף הבית
            </Link>
          }
        >
          <p className={styles.doneP}>ייתכן שהקישור הועתק חלקית. אפשר לפתוח אותו שוב מהודעת הוואטסאפ.</p>
        </StateCard>
      </PublicShell>
    );
  }

  const now = new Date();
  const slotKey = ilDateKey(o.slotStartsAt);
  const today = ilDateKey(now);
  const p = ilParts(o.slotStartsAt);
  const data: OfferViewData = {
    state: o.state,
    relative: slotKey === today ? 'היום' : slotKey === addDays(today, 1) ? 'מחר' : null,
    weekday: `יום ${DAY_SHORT[p.dow]}`,
    dateText: `${pad2(p.d)}/${pad2(p.m)}`,
    time: hhmm(o.slotStartsAt),
    sub: [o.treatmentName, o.practitionerName, o.branchName].filter(Boolean).join(' · '),
    practitioner: o.practitionerName,
    holdUntil: o.holdUntil.getTime(),
    serverNow: now.getTime(),
    bookingPath: o.bookingPath,
    leaveToken: o.leaveToken,
  };

  return (
    <PublicShell accountLink>
      <OfferView key={o.state} token={token} data={data} accept={acceptOfferAction} pass={passOfferAction} />
    </PublicShell>
  );
}
