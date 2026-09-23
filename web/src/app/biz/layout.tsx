import type { Metadata } from 'next';
import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';
import { DashNav } from '@/components/dashboard/DashNav';
import { visibleViews } from '@/components/dashboard/views';
import { RoleMenu } from '@/components/dashboard/RoleMenu';
import { PRESET_NAMES } from '@/lib/permissions';
import { bizContext } from '@/lib/server/biz';
import { db } from '@/lib/server/db';
import styles from './layout.module.css';

// Design: project/BeautyFind Dashboard.dc.html (shell: header, role menu, side rail)

export const metadata: Metadata = {
  title: 'לוח הבקרה',
  description: 'לוח הבקרה לעסקים ב־BeautyFind: צפיות ופניות, שלמות הפרופיל, עריכת תפריט מחירים בשקלים, ניהול ביקורות וחיוב חודשי.',
  robots: { index: false },
};

export default async function BizLayout({ children }: { children: React.ReactNode }) {
  const ctx = await bizContext();
  const { business, branch, perms, role, member, preview } = ctx;

  const [openReviews, openLeads, cityRegion] = await Promise.all([
    branch ? db.review.count({ where: { branchId: branch.id, status: 'published', businessReply: null } }) : 0,
    db.lead.count({ where: { businessId: business.id, stage: 'new' } }),
    branch ? db.region.findUnique({ where: { slug: branch.regionSlug } }) : null,
  ]);
  const firstCat = branch ? await db.branchCategory.findFirst({ where: { branchId: branch.id }, include: { category: true } }) : null;

  const views = visibleViews({ member, preview, perms }).map(v => ({
    ...v,
    badge: v.key === 'reviews' ? openReviews : v.key === 'leads' ? openLeads : 0,
  }));

  const name = branch?.name ?? 'העסק שלי';
  const line = [firstCat?.category.name, branch?.cityName, cityRegion?.name].filter(Boolean).join(' · ');
  const verified = business.status === 'live';
  const branchCount = business.branches.length;
  const profileHref = branch ? `/${branch.regionSlug}/biz/${branch.slug}` : '/';

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.bar}>
          <Link href="/" aria-label="BeautyFind" className={styles.brand}>
            <Wordmark size={25} />
          </Link>
          <span aria-hidden="true" className={styles.divider} />
          <div className={styles.bizId}>
            <span className={styles.bizName}>{name}</span>
            <span className={styles.bizLine}>{line}</span>
          </div>
          <Link href="/biz/sponsored" className={styles.chip}>מקום ממומן</Link>
          <Link href="/biz/branches" aria-label="מעבר סניף" className={`${styles.chip} ${styles.chipTeal}`}>
            {branchCount === 1 ? 'סניף אחד' : branchCount === 2 ? 'שני סניפים' : <><span className="ltr">{branchCount}</span>&nbsp;סניפים</>}
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 4.2 6 8.2l4-4" />
            </svg>
          </Link>
          <Link href={profileHref} className={styles.profileLink}>
            <span>תצוגת הפרופיל</span>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 3H3v8h8V9M8 2h4v4M12 2 6.5 7.5" />
            </svg>
          </Link>
          <RoleMenu
            current={role}
            canPreview={member.isOwner}
            options={Object.entries(PRESET_NAMES).map(([key, v]) => ({ key, ...v }))}
          />
          <span className={styles.statusWide} data-pending={!verified || undefined}>
            <span aria-hidden="true" />
            {verified ? 'מאומת' : 'ממתין לאימות'}
          </span>
          <span className={styles.statusNarrow} data-pending={!verified || undefined}>{verified ? 'מאומת' : 'ממתין'}</span>
        </div>
      </header>

      <div className={styles.shell}>
        <DashNav views={views} />
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
