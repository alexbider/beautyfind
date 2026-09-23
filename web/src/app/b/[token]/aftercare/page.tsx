import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AFTERCARE, aftercareKeyFor, phaseNow } from '@/components/aftercare/content';
import { PhaseView } from '@/components/aftercare/PhaseView';
import styles from '@/components/aftercare/Aftercare.module.css';
import { Wordmark } from '@/components/Wordmark';
import { fromE164, telHref } from '@/lib/format';
import { bookingIdFromToken } from '@/lib/server/booking';
import { db } from '@/lib/server/db';
import { hhmm, ilDate } from '@/lib/time';

// Design: project/BeautyFind Aftercare.dc.html. Sent as M5 when the booking is completed.

export const metadata: Metadata = {
  title: 'הנחיות אחרי הטיפול',
  description: 'הנחיות אחרי טיפול: מה לעשות ומה להימנע ממנו לפי שלבים, מתי לפנות לקליניקה, וביקורת מעקב.',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const WA_PATH = 'M12 2.2A9.7 9.7 0 0 0 3.6 16.8L2.3 21.7l5-1.3A9.7 9.7 0 1 0 12 2.2zm0 17.7c-1.5 0-2.9-.4-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8 1c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3.9 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2 .7 2.8.6.4-.1 1.4-.6 1.6-1.1.2-.5.2-1 .1-1.1z';
const PHONE_PATH = 'M5 3.5h3.2l1.6 4-2 1.3a11 11 0 0 0 5.4 5.4l1.3-2 4 1.6V17a2.5 2.5 0 0 1-2.7 2.5A15.5 15.5 0 0 1 2.5 6.2 2.5 2.5 0 0 1 5 3.5z';

export default async function AftercarePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const bookingId = bookingIdFromToken(token);
  if (!bookingId) notFound();
  const b = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      treatment: { select: { name: true, categorySlug: true, isMedical: true } },
      practitioner: { select: { displayName: true } },
      branch: { select: { name: true, phone: true, whatsapp: true, slug: true, regionSlug: true } },
    },
  });
  // Available only once the treatment is completed.
  if (!b || b.status !== 'completed' || !b.finishedAt) notFound();

  const key = aftercareKeyFor(b.treatment?.categorySlug, !!b.treatment?.isMedical);
  const set = AFTERCARE[key];
  const nowIdx = phaseNow(set, b.finishedAt);
  const tel = b.branch.phone ?? b.branch.whatsapp;
  const wa = b.branch.whatsapp ?? b.branch.phone;
  const treatmentName = b.treatment?.name ?? 'הטיפול';
  const who = [b.practitioner?.displayName, treatmentName].filter(Boolean).join(' · ');

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerBar}>
          <Link href="/" aria-label="BeautyFind" className={styles.brand}><Wordmark size={21} /></Link>
          <span className={styles.clinic}>{b.branch.name}</span>
        </div>
      </header>

      <main className={styles.wrap}>
        <PhaseView
          kicker={`הנחיות אחרי ${treatmentName}`}
          meta={<>{who} · <span className="ltr tnum">{ilDate(b.finishedAt)} {hhmm(b.finishedAt)}</span></>}
          phases={set.phases.map(({ untilHours: _u, ...p }) => p)}
          nowIdx={nowIdx}
        />

        <section aria-labelledby="ac-norm" className={styles.card}>
          <h2 id="ac-norm" className={styles.h2} style={{ marginBottom: 6 }}>מה נורמלי</h2>
          <p className={styles.body}>{set.normal}</p>
        </section>

        <section aria-labelledby="ac-red" className={styles.red}>
          <h2 id="ac-red" className={styles.h2} data-tone="bad" style={{ marginBottom: 8 }}>פני לקליניקה מיד אם</h2>
          <ul className={styles.redList}>
            {set.red.map(r => <li key={r}><span aria-hidden="true" /><span>{r}</span></li>)}
          </ul>
          <div className={styles.row}>
            {tel && (
              <a href={telHref(tel)} className={styles.emergency}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PHONE_PATH} /></svg>
                חיוג לקליניקה <span className="ltr" style={{ fontWeight: 600 }}>{fromE164(tel)}</span>
              </a>
            )}
            {wa && (
              <a href={`https://wa.me/${wa.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className={styles.wa}>
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={WA_PATH} /></svg>
                וואטסאפ עם תמונה
              </a>
            )}
          </div>
          <p className={styles.afterHours}>
            מחוץ לשעות הפעילות ובשבת: {set.after} בקושי בנשימה או בבליעה, חייגי מיד למד״א.
          </p>
          <a href="tel:101" className={styles.mda}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PHONE_PATH} /></svg>
            במצב חירום: חיוג למד״א <span className="ltr">101</span>
          </a>
        </section>

        {set.follow && (
          <section aria-labelledby="ac-fu" className={styles.follow}>
            <div className={styles.followText}>
              <h2 id="ac-fu" className={styles.h2} style={{ marginBottom: 3 }}>{set.follow.title}</h2>
              <p className={styles.followBody}>{set.follow.body}</p>
            </div>
            <Link href={`/${b.branch.regionSlug}/biz/${b.branch.slug}`} className={styles.primary}>{set.follow.cta}</Link>
          </section>
        )}

        <p className={styles.foot}>
          ההנחיות נשלחו מטעם {b.branch.name} ואינן מחליפות ייעוץ רפואי אישי. בעוד 3 ימים נשלח לך בקשה לכתוב ביקורת.
          {' '}<Link href={`/b/${token}`}>לפרטי התור</Link>
        </p>
      </main>
    </div>
  );
}
