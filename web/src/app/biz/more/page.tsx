import type { Metadata } from 'next';
import { MoreMenu, type MoreRow } from '@/components/more/MoreMenu';
import { visibleViews } from '@/components/dashboard/views';
import { bizContext } from '@/lib/server/biz';
import { isAdvanced } from '@/lib/server/clinic';
import s from './page.module.css';

export const metadata: Metadata = { title: 'עוד' };

// Business "עוד" tab: dashboard sections that don't have a tab, the clinic system, account.
const IN_TABS = new Set(['/biz', '/biz/leads', '/biz/reviews', '/biz/profile']);

export default async function BizMorePage() {
  const ctx = await bizContext();
  const views = visibleViews(ctx).filter(v => !IN_TABS.has(v.href));
  const advanced = await isAdvanced(ctx.business.id);
  const profileHref = ctx.branch ? `/${ctx.branch.regionSlug}/biz/${ctx.branch.slug}` : null;

  const manage: MoreRow[] = views.map(v => ({ kind: 'link', label: v.name, href: v.href }));
  const business: MoreRow[] = [
    // Branches and sponsored placements get rows here once /biz/branches and /biz/sponsored exist.
    ...(profileHref ? [{ kind: 'link', label: 'תצוגת הפרופיל הציבורי', href: profileHref } as MoreRow] : []),
    ...(advanced ? [{ kind: 'link', label: 'מערכת הקליניקה', href: '/clinic' } as MoreRow] : []),
  ];

  return (
    <div className={s.bleed}>
      <MoreMenu
      nested
        title="עוד"
        groups={[
          { name: 'ניהול', rows: manage },
          { name: 'העסק', rows: business },
          {
            name: 'עזרה ומידע',
            rows: [
              { kind: 'link', label: 'מרכז עזרה', href: '/help' },
              { kind: 'link', label: 'צור קשר', href: '/contact' },
              { kind: 'link', label: 'תנאי שימוש', href: '/terms' },
              { kind: 'link', label: 'מדיניות פרטיות', href: '/privacy' },
            ],
          },
          { name: 'חשבון', rows: [{ kind: 'logout' }] },
        ]}
      />
    </div>
  );
}
