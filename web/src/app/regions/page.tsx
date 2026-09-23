import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { JsonLd, breadcrumbLd } from '@/components/treatments/format';
import shared from '@/components/treatments/shared.module.css';
import { CITIES, MENU_REGION_ORDER, citiesOf, cityHref, regionBySlug } from '@/lib/catalog';
import { listingCounts } from '@/lib/server/public';
import styles from './page.module.css';

// All regions and their cities, linked from the homepage "כל הערים". Counts are live listings.

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'כל האזורים והערים',
  description: `מכוני יופי ואסתטיקה בכל ${CITIES.length} הערים שבאינדקס, לפי שבעה אזורים: מהצפון ועד אילת.`,
  alternates: { canonical: '/regions' },
};

export default async function RegionsPage() {
  const counts = await listingCounts();
  return (
    <div className={shared.root}>
      <JsonLd data={breadcrumbLd([{ name: 'ראשי', path: '/' }, { name: 'כל האזורים והערים', path: '/regions' }])} />
      <SiteHeader variant="public" title="אזורים וערים" backHref="/" />
      <nav aria-label="נתיב ניווט" className={shared.crumbBar}>
        <ol className={shared.crumbs}>
          <li><Link href="/">ראשי</Link></li>
          <li aria-hidden="true" className={shared.crumbSep}>/</li>
          <li aria-current="page" className={shared.crumbNow}>כל האזורים והערים</li>
        </ol>
      </nav>
      <main id="main" className={styles.main}>
        <h1 id="h-title" className={styles.h1}>כל האזורים והערים<span className={styles.dot}>.</span></h1>
        <p className={styles.lede}>שבעה אזורים ו־<span className="ltr">{CITIES.length}</span> ערים. בחרו אזור או עיר כדי לראות את העסקים שבה.</p>
        <div className={styles.grid}>
          {MENU_REGION_ORDER.map(slug => {
            const r = regionBySlug(slug)!;
            const n = counts.region[slug] ?? 0;
            return (
              <section key={slug} aria-labelledby={`r-${slug}`} className={styles.card}>
                <Link href={`/${slug}`} className={styles.head}>
                  <span className={styles.img}><Image src={`/assets/landmark-${slug}.jpg`} alt="" fill sizes="(min-width: 1024px) 400px, 100vw" className={styles.cover} /></span>
                  <span className={styles.headText}>
                    <h2 id={`r-${slug}`} className={styles.h2}>{r.name}</h2>
                    <span className={styles.count}>{n === 1 ? 'עסק אחד' : <><span className="ltr">{n}</span> עסקים</>}</span>
                  </span>
                </Link>
                <ul className={styles.cities}>
                  {citiesOf(slug).map(c => (
                    <li key={c.slug}>
                      <Link href={cityHref(c)} className={styles.city}>
                        {c.name}
                        {counts.city[c.slug] ? <span className={`${styles.cityCount} ltr`}>{counts.city[c.slug]}</span> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </main>
      <SiteFooter wide />
    </div>
  );
}
