import 'server-only';
import type { Metadata } from 'next';
import { cardExtras } from '@/app/search/extras';
import { CATEGORY_IMAGE, PLACEHOLDER_GUIDES, type HomeGuide } from '@/components/home/content';
import type { HeaderRegion } from '@/components/home/HomeHeader';
import type { PhoneCard, PhoneReview } from '@/components/home/phone/PhoneHome';
import { REGIONS, citiesOf, cityPageHref, type RegionSlug } from '@/lib/catalog';
import { homeGuides } from '@/lib/server/articles';
import { listBranches, listingCounts, recentReviews, type ListingCard } from '@/lib/server/public';
import { applySeo } from '@/lib/server/seo';
import { publicMetadata } from '@/lib/seo/meta';
import { graph, organizationNode, webPageNode, webSiteNode } from '@/lib/seo/schema';

// The home page's data, metadata and structured data, shared by the desktop route (/) and the phone
// route (/home/phone, served at / to phones by src/proxy.ts). One layout per response: the HTML never
// carries both trees, so there is one H1 and every H2 once.

export const HOME_TITLE = 'מכוני יופי, קליניקות לאסתטיקה וספא בישראל | BeautyFind';
export const HOME_DESCRIPTION =
  'מצאו מכוני יופי, קליניקות לאסתטיקה רפואית, מספרות וספא בכל רחבי ישראל, מהצפון ועד אילת. השוו מחירים וביקורות, גלו טיפולים וקבעו את הפגישה הבאה.';

/** Both routes are the same page: the canonical is always /. */
export const homeMetadata = (): Promise<Metadata> => applySeo('/', publicMetadata({ path: '/', title: { absolute: HOME_TITLE }, description: HOME_DESCRIPTION, image: '/assets/hero-clinic.jpg' }));

// The site graph: the WebSite and the Organization (stable ids every other page refers to) and the home page itself.
export const HOME_JSON_LD = graph([
  webSiteNode(),
  organizationNode('BeautyFind הוא אינדקס מכוני יופי, קליניקות לאסתטיקה רפואית, מספרות וספא בכל רחבי ישראל, עם מחירים, ביקורות ופרטי קשר של כל עסק.'),
  webPageNode({ path: '/', name: HOME_TITLE, description: HOME_DESCRIPTION, image: '/assets/hero-clinic.jpg' }),
]);

const CARDS_PER_TAB = 10;

export interface HomeData {
  cardLists: Record<RegionSlug, PhoneCard[]>;
  regionCounts: Record<RegionSlug, number>;
  regionCities: Record<RegionSlug, Array<{ name: string; href: string }>>;
  cardReviews: PhoneReview[];
  headerRegions: HeaderRegion[];
  total: number;
  /** The three newest published articles, or the "coming soon" placeholders until there is one. */
  guides: HomeGuide[];
}

/** Live listings per region, the newest reviews and the region menu, from the public reads only. */
export async function loadHome(): Promise<HomeData> {
  const [counts, reviews, guides, ...perRegion] = await Promise.all([
    listingCounts(),
    recentReviews(6),
    homeGuides().catch(() => null),
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

  return { cardLists, regionCounts, regionCities, cardReviews, headerRegions, total: counts.total, guides: guides ?? PLACEHOLDER_GUIDES };
}
