import type { Metadata } from 'next';
import { HOME_JSON_LD, homeMetadata, loadHome } from '@/components/home/data';
import { PhoneHome } from '@/components/home/phone/PhoneHome';
import { MaintenanceNotice } from '@/components/shell/FeatureOff';
import { CATEGORIES } from '@/lib/catalog';
import { ldJson } from '@/lib/seo/schema';
import styles from '../../page.module.css';

// The phone layout of the home page (BeautyFind_Homepage_Mobile.html). src/proxy.ts rewrites / to this
// route for phone user agents and redirects a direct visit to /home/phone back to /, so the only address
// the page ever has is /. Same data, metadata and structured data as the desktop route.

export const generateMetadata = (): Promise<Metadata> => homeMetadata();
export const revalidate = 120;

export default async function PhoneHomePage() {
  const home = await loadHome();
  return (
    <div className={styles.root}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(HOME_JSON_LD) }} />
      <MaintenanceNotice />
      <PhoneHome lists={home.cardLists} reviews={home.cardReviews} regionCities={home.regionCities} catCount={CATEGORIES.length} />
    </div>
  );
}
