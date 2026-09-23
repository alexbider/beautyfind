import type { Metadata } from 'next';
import Link from 'next/link';
import { ROUTES } from '@/lib/routes';
import { LeaveView } from '@/components/waitlist/LeaveView';
import { ENTRY_TOKEN_RE } from '@/components/waitlist/shared';
import { PublicShell, StateCard } from '@/components/waitlist/ui';
import styles from '@/components/waitlist/Waitlist.module.css';
import { leaveAction } from '../../[branch]/actions';
import { loadEntryForLeave } from '../../entries';

export const metadata: Metadata = {
  title: 'יציאה מרשימת ההמתנה',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function WaitlistLeavePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const e = ENTRY_TOKEN_RE.test(token) ? await loadEntryForLeave(token) : null;
  const home = (
    <Link href={ROUTES.home} className={styles.btn}>
      לדף הבית
    </Link>
  );

  if (!e) {
    return (
      <PublicShell title="רשימת המתנה">
        <StateCard title="הקישור לא תקין" actions={home}>
          <p className={styles.doneP}>ייתכן שהקישור הועתק חלקית. אפשר לפתוח אותו שוב מההודעה שקיבלת.</p>
        </StateCard>
      </PublicShell>
    );
  }

  const rejoin = `/waitlist/${e.branch.slug}?t=${e.treatmentId}`;
  if (e.status !== 'active' && e.status !== 'offered') {
    const text =
      e.status === 'booked' ? 'קבעת תור מרשימת ההמתנה, ולכן כבר לא ממתינה לטיפול הזה.' : e.status === 'expired' ? 'תקופת ההמתנה שבחרת הסתיימה.' : 'כבר יצאת מרשימת ההמתנה לטיפול הזה.';
    return (
      <PublicShell title="רשימת המתנה">
        <StateCard
          title="את לא ברשימת ההמתנה"
          actions={
            <>
              <Link href={rejoin} className={styles.btn}>
                הצטרפות מחדש
              </Link>
              <Link href={ROUTES.home} className={styles.btnGhost}>
                לדף הבית
              </Link>
            </>
          }
        >
          <p className={styles.doneP}>{text}</p>
        </StateCard>
      </PublicShell>
    );
  }

  return (
    <PublicShell title="רשימת המתנה">
      <LeaveView token={token} treatmentName={e.treatmentName} branchLabel={`${e.branch.name}, ${e.branch.cityName}`} rejoinHref={rejoin} leave={leaveAction} />
    </PublicShell>
  );
}
