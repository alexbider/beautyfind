import type { Metadata } from 'next';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { CompareView } from '@/components/saved/CompareView';
import { cleanIds, compareColumns } from '@/components/saved/data';
import { MAX_COMPARE } from '@/components/saved/types';
import styles from '@/components/saved/saved.module.css';

// Design: project/BeautyFind Saved.dc.html (view: compare). /saved/compare?ids=a,b,c
// Public data only, so it works for guests too; at most three clinics, the rest are ignored.

export const metadata: Metadata = {
  title: 'השוואת קליניקות',
  description: 'השוואה של עד שלוש קליניקות: מחיר, אחריות רפואית, דירוג, שעות, נגישות וחניה.',
  robots: { index: false, follow: false },
};

type Search = Record<string, string | string[] | undefined>;

export default async function ComparePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const ids = cleanIds(typeof sp.ids === 'string' ? sp.ids.split(',') : [], MAX_COMPARE);
  const cols = await compareColumns(ids);

  return (
    <div className={styles.page}>
      <SiteHeader variant="public" />
      <main className={styles.wrap}>
        <CompareView cols={cols} />
      </main>
      <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
    </div>
  );
}
