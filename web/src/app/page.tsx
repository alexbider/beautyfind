import type { Metadata } from 'next';
import { DeskHome } from '@/components/home/desk/DeskHome';
import { HOME_JSON_LD, homeMetadata, loadHome } from '@/components/home/data';
import { HomeFooter } from '@/components/home/HomeFooter';
import { HomeHeader } from '@/components/home/HomeHeader';
import { MaintenanceNotice } from '@/components/shell/FeatureOff';
import { ldJson } from '@/lib/seo/schema';
import styles from './page.module.css';

// Designs: BeautyFind_Homepage_Desktop_new.html (this route) and BeautyFind_Homepage_Mobile.html
// (src/app/home/phone, which src/proxy.ts serves at / to phones). One layout per response, so the
// HTML has one H1 and each H2 once; the data comes from components/home/data.ts for both.

export const generateMetadata = (): Promise<Metadata> => homeMetadata();

// Counts and cards change as listings go live; refresh the cached page every 2 minutes.
export const revalidate = 120;

export default async function HomePage() {
  const home = await loadHome();
  return (
    <div className={styles.root}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(HOME_JSON_LD) }} />
      <MaintenanceNotice />
      <a href="#main" className={styles.skip}>דלגו לתוכן</a>
      <HomeHeader regions={home.headerRegions} total={home.total} />
      <main id="main">
        <DeskHome lists={home.cardLists} regionCounts={home.regionCounts} reviews={home.cardReviews} regionCities={home.regionCities} />
      </main>
      <HomeFooter />
    </div>
  );
}
