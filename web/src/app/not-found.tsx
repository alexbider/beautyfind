import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowForward } from '@/components/icons';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { ReportBrokenLink } from '@/components/states/ReportBrokenLink';
import { categoryBySlug, categoryHref, regionBySlug, type RegionSlug } from '@/lib/catalog';
import { ROUTES } from '@/lib/routes';
import styles from './not-found.module.css';

// Design: project/BeautyFind States.dc.html → "עמוד לא קיים".
// Generic on purpose: also rendered for notFound() from region, city and profile pages.
// Rule: always three ways out (home, search, report a broken link), never only "back".

export const metadata: Metadata = {
  title: 'העמוד לא נמצא',
  robots: { index: false },
};

const SEARCH = '/search';

const POPULAR: Array<{ name: string; note: string; href: string }> = [
  ...(['dan', 'sharon', 'haifa'] as RegionSlug[]).map(s => ({ name: `קליניקות ב${regionBySlug(s)!.name}`, note: 'עסקים מאומתים באזור', href: `/${s}` })),
  ...['hair-removal', 'medical-aesthetics', 'facials'].map(s => {
    const c = categoryBySlug(s)!;
    return { name: c.name, note: 'מחירים וטווחי טיפול', href: categoryHref(c) };
  }),
];

export default function NotFound() {
  return (
    <div className={styles.root}>
      <SiteHeader variant="public" title="העמוד לא נמצא" backHref="/" />
      <main className={styles.main}>
        <div className={styles.inner}>
          <span dir="ltr" aria-hidden="true" className={styles.code}>404</span>
          <h1 className={styles.h1}>העמוד הזה לא קיים</h1>
          <p className={styles.lede}>ייתכן שהכרטיס הוסר, שהקישור נשבר, או שיש שגיאת כתיב בכתובת. הנה הדרכים הקצרות להמשיך.</p>

          <form action={SEARCH} method="get" role="search" className={styles.search}>
            <label htmlFor="nf-q" className="sr-only">חיפוש קליניקה או טיפול</label>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#5B6B7B" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="6" />
              <path d="m13 13 5 5" />
            </svg>
            <input id="nf-q" name="q" type="search" placeholder="חיפוש קליניקה, טיפול או עיר" autoComplete="off" enterKeyHint="search" />
            <button type="submit">חיפוש</button>
          </form>

          <div className={styles.actions}>
            <Link href={ROUTES.home} className={styles.primary}>לדף הבית</Link>
            <Link href={SEARCH} className={styles.secondary}>חיפוש קליניקה</Link>
            <ReportBrokenLink className={styles.ghost} />
          </div>

          <h2 className={styles.h2}>אולי חיפשתם</h2>
          <div className={styles.popular}>
            {POPULAR.map(p => (
              <Link key={p.href} href={p.href} className={styles.card}>
                <span className={styles.cardText}>
                  <span className={styles.cardName}>{p.name}</span>
                  <span className={styles.cardNote}>{p.note}</span>
                </span>
                <ArrowForward size={15} className={styles.cardArrow} />
              </Link>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
    </div>
  );
}
