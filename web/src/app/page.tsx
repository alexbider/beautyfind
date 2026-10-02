import type { Metadata } from 'next';
import { applySeo } from '@/lib/server/seo';
import { publicMetadata } from '@/lib/seo/meta';
import { graph, ldJson, organizationNode, webPageNode, webSiteNode } from '@/lib/seo/schema';
import { cardExtras } from '@/app/search/extras';
import { CATEGORY_IMAGE } from '@/components/home/content';
import { DeskHome } from '@/components/home/desk/DeskHome';
import { HomeFooter } from '@/components/home/HomeFooter';
import { HomeHeader, type HeaderRegion } from '@/components/home/HomeHeader';
import { PhoneHome, type PhoneCard, type PhoneReview } from '@/components/home/phone/PhoneHome';
import { CATEGORIES, REGIONS, citiesOf, cityPageHref, type RegionSlug } from '@/lib/catalog';
import { listBranches, listingCounts, recentReviews, type ListingCard } from '@/lib/server/public';
import styles from './page.module.css';
import { MaintenanceNotice } from '@/components/shell/FeatureOff';

// Designs: BeautyFind_Homepage_Desktop_new.html (desktop body; the site header and footer are
// unchanged) and BeautyFind_Homepage_Mobile.html (app shell). Server component: both layouts
// get the same live data from lib/server/public.ts (live listings only).

const TITLE = 'מכוני יופי, קליניקות לאסתטיקה וספא בישראל | BeautyFind';
const DESCRIPTION =
  'מצאו מכוני יופי, קליניקות לאסתטיקה רפואית, מספרות וספא בכל רחבי ישראל, מהצפון ועד אילת. השוו מחירים וביקורות, גלו טיפולים וקבעו את הפגישה הבאה.';

export async function generateMetadata(): Promise<Metadata> {
  return applySeo('/', publicMetadata({ path: '/', title: { absolute: TITLE }, description: DESCRIPTION, image: '/assets/hero-clinic.jpg' }));
}

// Counts and cards change as listings go live; refresh the cached page every 5 minutes.
export const revalidate = 120;

const CARDS_PER_TAB = 10;

// The site graph: the WebSite and the Organization (stable ids every other page refers to) and the home page itself.
const JSON_LD = graph([
  webSiteNode(),
  organizationNode('BeautyFind הוא אינדקס מכוני יופי, קליניקות לאסתטיקה רפואית, מספרות וספא בכל רחבי ישראל, עם מחירים, ביקורות ופרטי קשר של כל עסק.'),
  webPageNode({ path: '/', name: TITLE, description: DESCRIPTION, image: '/assets/hero-clinic.jpg' }),
]);

export default async function HomePage() {
  const [counts, reviews, ...perRegion] = await Promise.all([
    listingCounts(),
    recentReviews(6),
    ...REGIONS.map(r => listBranches({ region: r.slug, take: CARDS_PER_TAB })),
  ]);

  const regionCount = (slug: string) => counts.region[slug as keyof typeof counts.region] ?? 0;
  const cityCount = (slug: string) => counts.city[slug] ?? 0;
  // Cities with the most live listings first (stable, so catalog order breaks ties).
  const topCities = (slug: (typeof REGIONS)[number]['slug'], n: number) =>
    [...citiesOf(slug)].sort((a, b) => cityCount(b.slug) - cityCount(a.slug)).slice(0, n);

  const lists = Object.fromEntries(REGIONS.map((r, i) => [r.slug, perRegion[i].items])) as Record<RegionSlug, ListingCard[]>;

  // WhatsApp, phone and "open now" for the cards.
  const extras = await cardExtras([...new Set(Object.values(lists).flatMap(l => l.map(c => c.id)))]);

  const toPhone = (c: ListingCard): PhoneCard => ({
    id: c.id,
    name: c.name,
    href: c.href,
    tag: c.categories[0]?.name ?? '',
    city: c.cityName,
    img: c.coverUrl ?? CATEGORY_IMAGE[c.categories[0]?.slug ?? ''] ?? '/assets/biz-facial.jpg',
    bf: c.beautyfind,
    g: c.google,
    from: c.priceFromShekels,
    openNow: extras[c.id]?.openNow ?? false,
    whatsapp: extras[c.id]?.whatsapp ?? null,
    phone: extras[c.id]?.phone ?? null,
    verified: c.verified,
  });
  const cardLists = Object.fromEntries(REGIONS.map(r => [r.slug, lists[r.slug].map(toPhone)])) as Record<RegionSlug, PhoneCard[]>;
  const regionCounts = Object.fromEntries(REGIONS.map(r => [r.slug, regionCount(r.slug)])) as Record<RegionSlug, number>;
  const regionCities = Object.fromEntries(
    REGIONS.map(r => [r.slug, topCities(r.slug, 2).map(c => ({ name: c.name, href: cityPageHref(c) }))]),
  ) as Record<RegionSlug, Array<{ name: string; href: string }>>;
  const monthYear = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' });
  const cardReviews: PhoneReview[] = reviews.map(r => ({
    id: r.id,
    initial: r.authorName.trim().charAt(0) || 'ל',
    name: r.authorName,
    date: monthYear.format(r.createdAt),
    rating: r.rating,
    text: r.body,
    treat: r.treatmentName,
    biz: r.branchName,
    href: r.branchHref,
    verified: r.verified,
  }));

  const headerRegions: HeaderRegion[] = REGIONS.map(r => ({
    slug: r.slug,
    name: r.name,
    count: regionCount(r.slug),
    cities: topCities(r.slug, 5).map(c => ({ name: c.name, href: cityPageHref(c) })),
  }));

  return (
    <div className={styles.root}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(JSON_LD) }} />
      <MaintenanceNotice />
      <div className="bf-shell-only">
        <PhoneHome lists={cardLists} reviews={cardReviews} regionCities={regionCities} catCount={CATEGORIES.length} />
      </div>

      <div className="bf-desk-only">
        <a href="#main" className={styles.skip}>דלגו לתוכן</a>
        <HomeHeader regions={headerRegions} total={counts.total} />

        <main id="main">
          <DeskHome lists={cardLists} regionCounts={regionCounts} reviews={cardReviews} regionCities={regionCities} />
        </main>
        <HomeFooter />
      </div>
    </div>
  );
}
