import type { Metadata } from 'next';
import Link from 'next/link';
import { ReplyForm } from '@/components/consult/ReplyForm';
import { PublicShell, StateCard, telHref } from '@/components/waitlist/ui';
import styles from '@/components/waitlist/Waitlist.module.css';
import { toE164 } from '@/lib/format';
import { ROUTES } from '@/lib/routes';
import { loadReplyView } from '@/lib/server/consultReply';

// The client's reply to a clinic about a consultation request. Linked from M8 and M9 (paid plans only);
// the answer is emailed to the clinic and shown in its consult inbox.

export const metadata: Metadata = { title: 'תשובה לעסק', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

export default async function ConsultReplyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await loadReplyView(token);
  const home = <Link href={ROUTES.home} className={styles.btn}>לדף הבית</Link>;

  if (!v) {
    return (
      <PublicShell title="תשובה לעסק">
        <StateCard title="הקישור לא תקין" actions={home}><p className={styles.doneP}>ייתכן שהקישור הועתק חלקית. אפשר לפתוח אותו שוב מההודעה שקיבלת.</p></StateCard>
      </PublicShell>
    );
  }
  const call = v.businessPhone ? <a href={telHref(toE164(v.businessPhone) ?? v.businessPhone)} className={styles.btn}>התקשרות לעסק</a> : home;
  if (!v.open || !v.paid) {
    return (
      <PublicShell title="תשובה לעסק">
        <StateCard title={v.open ? 'אפשר להשיב בטלפון' : 'הבקשה נסגרה'} actions={call}>
          <p className={styles.doneP}>{v.open ? `לתשובה ל${v.business}, אפשר להתקשר לעסק${v.businessPhone ? `: ${v.businessPhone}` : ''}.` : `בקשת הייעוץ ${v.ref} ב${v.business} כבר נסגרה. לשאלות אפשר להתקשר לעסק.`}</p>
        </StateCard>
      </PublicShell>
    );
  }
  return (
    <PublicShell title="תשובה לעסק">
      <div className={styles.card}>
        <h1 className={styles.doneH}>תשובה ל{v.business}</h1>
        <p className={styles.doneP}>{v.firstName ? `${v.firstName}, ` : ''}כאן אפשר להשיב לעסק על בקשת הייעוץ (מספר <bdi dir="ltr" style={{ whiteSpace: 'nowrap' }}>{v.ref}</bdi>). התשובה תגיע אליהם ישירות.</p>
        {v.replies.length ? <p className={styles.hint}>כבר שלחת {v.replies.length === 1 ? 'תשובה אחת' : `${v.replies.length} תשובות`} לבקשה הזו.</p> : null}
        <ReplyForm token={token} proposed={v.proposed} business={v.business} />
      </div>
    </PublicShell>
  );
}
