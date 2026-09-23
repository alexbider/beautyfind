import type { Metadata } from 'next';
import Link from 'next/link';
import { clinicContext } from '@/lib/server/clinic';
import { ClinicQueue } from '@/components/waitlist/ClinicQueue';
import styles from '@/components/waitlist/Waitlist.module.css';
import cq from '@/components/waitlist/ClinicQueue.module.css';
import { TopBar } from '@/components/shell/TopBar';
import { offerSlotAction, removeEntryAction } from './actions';
import { accessibleBranches, loadQueue } from './data';

// Design: project/BeautyFind Waitlist.dc.html (view=clinic). Renders inside the clinic layout.
// Advanced plan only: the basic plan shows an upgrade card. View level sees the queue without actions.

export const metadata: Metadata = { title: 'רשימת המתנה', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function ClinicWaitlistPage({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  const ctx = await clinicContext('waitlist');
  const branches = accessibleBranches(ctx);
  const { b } = await searchParams;
  const branch = branches.find(x => x.id === b) ?? branches.find(x => x.id === ctx.branch?.id) ?? branches[0] ?? null;

  if (!ctx.advanced || !branch) {
    return (
      <div className={`${styles.embed} ${cq.wrap}`}>
        <TopBar mode="root" largeTitle="רשימת המתנה" />
        <div className={cq.inset}>
        <div className={styles.qHead}>
          <div className={styles.qHeadText}>
            <span className={styles.qKicker}>{branch?.name ?? 'העסק שלי'} · יומן</span>
            <h1 className={`${styles.qH1} bf-desk-only`}>רשימת המתנה</h1>
          </div>
        </div>
        <div className={styles.upgrade}>
          <h2 className={styles.doneH}>{branch ? 'רשימת המתנה היא חלק ממערכת הקליניקה' : 'אין עדיין סניף פעיל'}</h2>
          <p className={styles.doneP}>
            {branch
              ? 'ברישום מתקדם + CRM לקוחות מצטרפות לרשימת המתנה מעמוד ההזמנה, וכשמתבטל תור הוא מוצע אוטומטית לראשונה שמתאימה, עם זמן שמירה. בינתיים לקוחות יכולות להתקשר או לשלוח וואטסאפ.'
              : 'רשימת ההמתנה תופיע כאן אחרי שהסניף הראשון יעלה לאוויר.'}
          </p>
          {branch && (
            <div className={styles.actions}>
              <Link href="/biz/billing" className={styles.btn}>
                לשדרוג החבילה
              </Link>
            </div>
          )}
        </div>
        </div>
      </div>
    );
  }

  const data = await loadQueue(branch.id, ctx.business.settings);
  return (
    <div className={`${styles.embed} ${cq.wrap}`}>
      <ClinicQueue
        kicker={`${branch.name} · יומן`}
        branchId={branch.id}
        branches={branches.map(x => ({ id: x.id, name: x.name, href: `/clinic/waitlist?b=${x.id}` }))}
        canManage={ctx.canManage}
        data={data}
        offerSlot={offerSlotAction}
        removeEntry={removeEntryAction}
      />
    </div>
  );
}
