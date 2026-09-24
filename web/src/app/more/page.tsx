import type { Metadata } from 'next';
import { MoreMenu, type MoreRow } from '@/components/more/MoreMenu';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { ROUTES } from '@/lib/routes';
import { currentUser } from '@/lib/server/session';

export const metadata: Metadata = { title: 'עוד', robots: { index: false, follow: true } };

// Client "עוד" tab: account, gift cards, help, business entry, legal, language, logout.
export default async function MorePage() {
  const user = await currentUser();
  // Account settings live here on phones; "התורים שלי" is its own tab.
  const account: MoreRow[] = user
    ? user.kind === 'client'
      ? [
          { kind: 'link', label: 'התורים שלי', href: ROUTES.account },
          { kind: 'link', label: 'מועדפים', href: ROUTES.saved },
          { kind: 'link', label: 'הביקורות שלי', href: `${ROUTES.account}?tab=reviews` },
          { kind: 'link', label: 'הגדרות ופרטיות', href: `${ROUTES.account}?tab=settings`, note: user.fullName ?? undefined },
        ]
      : [{ kind: 'link', label: 'מועדפים', href: ROUTES.saved }]
    : [
        { kind: 'link', label: 'כניסה לחשבון', href: ROUTES.login },
        { kind: 'link', label: 'הרשמה', href: `${ROUTES.login}?view=signup` },
      ];
  const business: MoreRow[] =
    user?.kind === 'business'
      ? [{ kind: 'link', label: 'מעבר ללוח הבקרה', href: ROUTES.dashboard }]
      : [
          { kind: 'link', label: 'רישום העסק', href: ROUTES.forBusiness },
          { kind: 'link', label: 'כניסת בעלי עסקים', href: ROUTES.bizLogin },
        ];

  return (
    <>
      <div className="bf-desk-only">
        <SiteHeader variant="public" />
      </div>
      <MoreMenu
        title="עוד"
        groups={[
          { name: 'החשבון', rows: account },
          {
            name: 'שוברים ועזרה',
            rows: [
              { kind: 'link', label: 'בדיקת יתרת שובר מתנה', href: ROUTES.giftCheck },
              { kind: 'link', label: 'מרכז עזרה', href: ROUTES.help },
              { kind: 'link', label: 'צרו קשר', href: ROUTES.contact },
            ],
          },
          { name: 'לעסקים', rows: business },
          {
            name: 'מידע',
            rows: [
              { kind: 'link', label: 'אודות', href: '/about' },
              { kind: 'link', label: 'תקן הרישום', href: ROUTES.listingStandards },
              { kind: 'link', label: 'מדיניות פרטיות', href: ROUTES.privacy },
              { kind: 'link', label: 'תנאי שימוש', href: ROUTES.terms },
              { kind: 'link', label: 'הצהרת נגישות', href: ROUTES.accessibility },
              { kind: 'cookies' },
            ],
          },
          { name: 'הגדרות', rows: [{ kind: 'static', label: 'שפה', note: 'עברית' }, ...(user ? [{ kind: 'logout' } as MoreRow] : [])] },
        ]}
      />
      <div className="bf-desk-only">
        <SiteFooter />
      </div>
    </>
  );
}
