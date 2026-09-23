import type { Metadata } from 'next';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { cleanIds, clientUser, savedCardsOf } from '@/components/saved/data';
import { SavedView } from '@/components/saved/SavedView';
import { MAX_COMPARE } from '@/components/saved/types';
import styles from '@/components/saved/saved.module.css';

// Design: project/BeautyFind Saved.dc.html (view: list)
// Signed-in clients: SavedClinic rows. Guests: localStorage['bf-saved'], rendered through a server action.

export const metadata: Metadata = {
  title: 'קליניקות שמורות',
  description: 'הקליניקות ששמרתם ב־BeautyFind, והשוואה של עד שלוש קליניקות זו לצד זו.',
  robots: { index: false, follow: false },
};

type Search = Record<string, string | string[] | undefined>;

export default async function SavedPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const raw = typeof sp.ids === 'string' ? sp.ids.split(',') : [];
  const user = await clientUser();
  const cards = user ? await savedCardsOf(user.id) : [];

  return (
    <div className={styles.page}>
      <SiteHeader variant="public" largeTitle="שמורות" />
      <main className={styles.wrap}>
        <SavedView initialCards={cards} initialCmp={cleanIds(raw, MAX_COMPARE)} serverSignedIn={!!user} />
      </main>
      <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
    </div>
  );
}
