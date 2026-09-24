import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ARTICLES } from '@/components/home/content';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import shared from '@/components/treatments/shared.module.css';
import { ROUTES } from '@/lib/routes';
import styles from './page.module.css';

// Guides index. TODO(cms): the articles are not written yet, so this page lists what is coming
// and points to the reference pages that exist today. Kept out of the index until articles exist.

export const metadata: Metadata = {
  title: 'מדריכים',
  description: 'מדריכים של BeautyFind לבחירת מכון יופי או קליניקה, להבנת מחירי טיפולים ולהכנה לפגישת ייעוץ.',
  alternates: { canonical: '/magazine' },
  robots: { index: false, follow: true },
};

const NOW = [
  { href: ROUTES.treatments, title: 'תחומי טיפול', sub: 'מה כולל כל תחום, מחירים חציוניים ועסקים לפי אזור' },
  { href: ROUTES.listingStandards, title: 'תקן הרישום', sub: 'מה בודקים לפני שעסק עולה לאתר' },
  { href: `${ROUTES.methodology}#ranking`, title: 'איך מדרגים', sub: 'סדר ההצגה, ביקורות ודירוג Google' },
];

export default function MagazinePage() {
  return (
    <div className={shared.root}>
      <SiteHeader variant="public" title="מדריכים" backHref="/" />
      <main id="main" className={styles.main}>
        <h1 className={styles.h1}>מדריכים<span className={styles.dot}>.</span></h1>
        <p className={styles.lede}>המדריכים הראשונים נכתבים עכשיו ויעלו כאן בקרוב, כל אחד עם תאריך עדכון גלוי.</p>
        <div className={styles.grid}>
          {ARTICLES.map(a => (
            <article key={a.title} className={styles.card}>
              <span className={styles.img}><Image src={a.img} alt="" fill sizes="(min-width: 1024px) 400px, 100vw" className={styles.cover} /></span>
              <span className={styles.kind}>{a.kind} · בקרוב</span>
              <h2 className={styles.h2}>{a.title}</h2>
              <p className={styles.desc}>{a.desc}</p>
            </article>
          ))}
        </div>
        <h2 className={styles.nowTitle}>בינתיים אפשר לקרוא</h2>
        <div className={styles.now}>
          {NOW.map(n => (
            <Link key={n.href} href={n.href} className={styles.nowLink}>
              <strong>{n.title}</strong>
              <span>{n.sub}</span>
            </Link>
          ))}
        </div>
      </main>
      <SiteFooter wide />
    </div>
  );
}
