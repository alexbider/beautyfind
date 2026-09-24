import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/routes';
import { currentUser } from '@/lib/server/session';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { AccountView, type Tab } from '@/components/account/AccountView';
import { loadAccount } from '@/components/account/data';
import styles from '@/components/account/account.module.css';

// Design: project/BeautyFind Account.dc.html. Signed-in clients only; businesses go to /biz.

export const metadata: Metadata = {
  title: 'החשבון שלי',
  description: 'החשבון שלי ב־BeautyFind: התורים שלי, מועדפים, הביקורות שלי, העדפות דיוור ופרטיות.',
  robots: { index: false, follow: false },
};

const TABS: Tab[] = ['appts', 'saved', 'reviews', 'settings'];

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user) redirect(`${ROUTES.login}?next=${ROUTES.account}`);
  if (user.kind === 'business') redirect(ROUTES.dashboard);

  const sp = await searchParams;
  const tab = TABS.find(t => t === sp.tab) ?? 'appts';
  const data = await loadAccount(user);

  return (
    <div className={styles.page}>
      <div className="bf-desk-only">
        <SiteHeader variant="public" />
      </div>
      <AccountView key={tab} data={data} initialTab={tab} />
      <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
    </div>
  );
}
