import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fromE164 } from '@/lib/format';
import { currentUser } from '@/lib/server/session';
import { JoinForm } from '@/components/waitlist/JoinForm';
import { PhoneIcon, PublicShell, StateCard, WaIcon, telHref, waHref } from '@/components/waitlist/ui';
import styles from '@/components/waitlist/Waitlist.module.css';
import { loadJoinPage } from '../entries';
import { joinAction, leaveAction } from './actions';

// Design: project/BeautyFind Waitlist.dc.html (view=join). Advanced plan only; a basic listing
// shows "call or WhatsApp the clinic" instead of the form.

type Props = { params: Promise<{ branch: string }>; searchParams: Promise<{ t?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { branch } = await params;
  const data = await loadJoinPage(branch);
  return {
    title: data ? `רשימת המתנה · ${data.branch.name}` : 'רשימת המתנה',
    description: 'הצטרפות לרשימת המתנה לתור שמתפנה: ימים, שעות ומשך המתנה. הודעת וואטסאפ עם זמן שמירה.',
    robots: { index: false, follow: false },
  };
}

export default async function WaitlistJoinPage({ params, searchParams }: Props) {
  const [{ branch: slug }, sp] = await Promise.all([params, searchParams]);
  const data = await loadJoinPage(slug);
  if (!data) notFound();
  const { branch, advanced, treatments, holdMinutes } = data;
  const profileHref = `/${branch.regionSlug}/biz/${branch.slug}`;
  const t = typeof sp.t === 'string' ? sp.t : null;

  if (!advanced || treatments.length === 0) {
    const wa = branch.whatsapp ?? null;
    const phone = branch.phone ?? null;
    return (
      <PublicShell title="רשימת המתנה" closeHref={profileHref}>
        <StateCard
          title={advanced ? 'אין כרגע טיפולים לרשימת המתנה' : 'רשימת המתנה לא זמינה כאן'}
          actions={
            <>
              {wa && (
                <a className={styles.wa} href={waHref(wa, `שלום, אשמח להיכנס לרשימת המתנה לתור ב${branch.name}`)} target="_blank" rel="noopener noreferrer">
                  <WaIcon />
                  וואטסאפ לקליניקה
                </a>
              )}
              {phone && (
                <a className={styles.tel} href={telHref(phone)}>
                  <PhoneIcon />
                  <span dir="ltr" className="ltr">
                    {fromE164(phone)}
                  </span>
                </a>
              )}
              <a className={styles.btnGhost} href={profileHref}>
                לפרופיל הקליניקה
              </a>
            </>
          }
        >
          <p className={styles.doneP}>
            {branch.name} לא מנהלת רשימת המתנה אונליין. אפשר להתקשר או לשלוח וואטסאפ לקליניקה ולבקש שיעדכנו אותך כשמתפנה תור.
          </p>
        </StateCard>
      </PublicShell>
    );
  }

  const user = await currentUser();
  const prefill = user?.kind === 'client' ? { name: user.fullName ?? '', phone: user.phone ? fromE164(user.phone) : '' } : { name: '', phone: '' };

  return (
    <PublicShell title="רשימת המתנה" closeHref={profileHref}>
      <JoinForm
        branch={{ id: branch.id, name: branch.name, cityName: branch.cityName }}
        treatments={treatments}
        initialTreatmentId={t}
        holdMinutes={holdMinutes}
        prefill={prefill}
        profileHref={profileHref}
        join={joinAction}
        leave={leaveAction}
      />
    </PublicShell>
  );
}
