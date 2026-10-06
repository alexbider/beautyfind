// Structured data shared by every public template. One site graph: the Organization and the WebSite carry
// stable ids, every page adds a WebPage that belongs to the WebSite and is published by the Organization,
// and the page's own nodes (BreadcrumbList, ItemList, FAQPage, the business) hang off that WebPage with
// ids of their own. Pure: no database, no React.

import { CATEGORIES, categoryBySlug, type Category } from '../catalog';
import { SITE_ORIGIN } from './meta';

export const ORG_ID = `${SITE_ORIGIN}/#organization`;
export const WEBSITE_ID = `${SITE_ORIGIN}/#website`;
export const LOGO_URL = `${SITE_ORIGIN}/assets/logo.png`;
export const LOGO_SIZE = { width: 1200, height: 300 };

/**
 * Official profiles of BeautyFind elsewhere. TODO: fill in when the Instagram, Facebook and LinkedIn
 * accounts exist; an empty list writes no sameAs.
 */
export const ORG_SAME_AS: string[] = [];
/** TODO: the founding date, once the company confirms the one to publish (YYYY or YYYY-MM-DD). */
export const ORG_FOUNDING_DATE: string | null = null;

export const absoluteUrl = (path: string) => (path.startsWith('http') ? path : `${SITE_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`);

/** JSON for a <script type="application/ld+json"> that can never close the tag. */
export const ldJson = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

export const graph = (nodes: unknown[]) => ({ '@context': 'https://schema.org', '@graph': nodes });

/** The contact channels of /contact, as ContactPoints. */
export const ORG_CONTACTS: Array<{ contactType: string; email: string }> = [
  { contactType: 'customer support', email: 'hello@beautyfind.co.il' },
  { contactType: 'sales', email: 'business@beautyfind.co.il' },
  { contactType: 'corrections', email: 'corrections@beautyfind.co.il' },
  { contactType: 'accessibility', email: 'access@beautyfind.co.il' },
  { contactType: 'privacy', email: 'privacy@beautyfind.co.il' },
];

export function organizationNode(description?: string) {
  return {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: 'BeautyFind',
    alternateName: 'ביוטיפיינד',
    legalName: 'Israfind Group',
    url: `${SITE_ORIGIN}/`,
    logo: { '@type': 'ImageObject', '@id': `${SITE_ORIGIN}/#logo`, url: LOGO_URL, contentUrl: LOGO_URL, width: LOGO_SIZE.width, height: LOGO_SIZE.height, caption: 'BeautyFind' },
    image: { '@id': `${SITE_ORIGIN}/#logo` },
    ...(description ? { description } : {}),
    areaServed: { '@type': 'Country', name: 'Israel' },
    knowsLanguage: 'he',
    contactPoint: ORG_CONTACTS.map(c => ({ '@type': 'ContactPoint', contactType: c.contactType, email: c.email, url: `${SITE_ORIGIN}/contact`, availableLanguage: 'he' })),
    address: { '@type': 'PostalAddress', addressRegion: 'DE', addressCountry: 'US' },
    ...(ORG_SAME_AS.length ? { sameAs: ORG_SAME_AS } : {}),
    ...(ORG_FOUNDING_DATE ? { foundingDate: ORG_FOUNDING_DATE } : {}),
  };
}

export function webSiteNode() {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    url: `${SITE_ORIGIN}/`,
    name: 'BeautyFind',
    inLanguage: 'he-IL',
    publisher: { '@id': ORG_ID },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE_ORIGIN}/search?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

export interface WebPageInput {
  path: string;
  name: string;
  description?: string | null;
  image?: string | null; // absolute or site path
  /** The page's main thing (a business, an item list), by @id. */
  mainEntityId?: string;
  /** The breadcrumb node is on the page: reference it. */
  breadcrumb?: boolean;
  type?: 'WebPage' | 'CollectionPage' | 'ItemPage' | 'AboutPage' | 'ContactPage' | 'FAQPage' | 'SearchResultsPage';
  /** Dates for pages whose content has a life of its own (articles). */
  datePublished?: string;
  dateModified?: string;
}

export const pageId = (path: string) => `${absoluteUrl(path)}#webpage`;
export const breadcrumbId = (path: string) => `${absoluteUrl(path)}#breadcrumb`;
export const listId = (path: string) => `${absoluteUrl(path)}#list`;
export const faqId = (path: string) => `${absoluteUrl(path)}#faq`;
export const businessId = (path: string) => `${absoluteUrl(path)}#biz`;

export function webPageNode(p: WebPageInput) {
  const url = absoluteUrl(p.path);
  return {
    '@type': p.type ?? 'WebPage',
    '@id': pageId(p.path),
    url,
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    inLanguage: 'he-IL',
    isPartOf: { '@id': WEBSITE_ID },
    publisher: { '@id': ORG_ID },
    ...(p.image ? { primaryImageOfPage: { '@type': 'ImageObject', url: absoluteUrl(p.image) } } : {}),
    ...(p.breadcrumb ? { breadcrumb: { '@id': breadcrumbId(p.path) } } : {}),
    ...(p.mainEntityId ? { mainEntity: { '@id': p.mainEntityId } } : {}),
    ...(p.datePublished ? { datePublished: p.datePublished } : {}),
    ...(p.dateModified ? { dateModified: p.dateModified } : {}),
  };
}

export const articleId = (path: string) => `${absoluteUrl(path)}#article`;

export interface ArticlePerson { name: string; url?: string | null; jobTitle?: string | null; sameAs?: string[]; image?: string | null }

export interface ArticleInput {
  path: string;
  type: 'Article' | 'BlogPosting';
  headline: string;
  description?: string | null;
  image?: { url: string; width?: number | null; height?: number | null; caption?: string | null } | null;
  datePublished: string;
  dateModified: string;
  author?: ArticlePerson | null;
  reviewedBy?: ArticlePerson | null;
  wordCount?: number;
  keywords?: string[];
  section?: string | null;
}

const person = (p: ArticlePerson) => ({
  '@type': 'Person',
  name: p.name,
  ...(p.url ? { url: absoluteUrl(p.url) } : {}),
  ...(p.jobTitle ? { jobTitle: p.jobTitle } : {}),
  ...(p.image ? { image: absoluteUrl(p.image) } : {}),
  ...(p.sameAs?.length ? { sameAs: p.sameAs } : {}),
});

/**
 * The Article (or BlogPosting) of a magazine page: the page's main entity, published by the Organization
 * by reference (never a second Organization node), with the real permalink and featured image.
 */
export function articleNode(a: ArticleInput) {
  const url = absoluteUrl(a.path);
  return {
    '@type': a.type,
    '@id': articleId(a.path),
    headline: a.headline,
    ...(a.description ? { description: a.description } : {}),
    url,
    mainEntityOfPage: { '@id': pageId(a.path) },
    isPartOf: { '@id': pageId(a.path) },
    inLanguage: 'he-IL',
    datePublished: a.datePublished,
    dateModified: a.dateModified,
    publisher: { '@id': ORG_ID },
    ...(a.image ? { image: { '@type': 'ImageObject', url: absoluteUrl(a.image.url), contentUrl: absoluteUrl(a.image.url), ...(a.image.width ? { width: a.image.width } : {}), ...(a.image.height ? { height: a.image.height } : {}), ...(a.image.caption ? { caption: a.image.caption } : {}) } } : {}),
    ...(a.author ? { author: person(a.author) } : {}),
    ...(a.reviewedBy ? { reviewedBy: person(a.reviewedBy) } : {}),
    ...(a.wordCount ? { wordCount: a.wordCount } : {}),
    ...(a.keywords?.length ? { keywords: a.keywords.join(', ') } : {}),
    ...(a.section ? { articleSection: a.section } : {}),
  };
}

export interface Crumb {
  name: string;
  path: string;
}

/** BreadcrumbList with the page's id. Every item carries its URL, the last one is the page itself. */
export function breadcrumbNode(pagePath: string, items: Crumb[]) {
  return {
    '@type': 'BreadcrumbList',
    '@id': breadcrumbId(pagePath),
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: absoluteUrl(it.path) })),
  };
}

export function faqNode(pagePath: string, faqs: Array<{ q: string; a: string }>) {
  return {
    '@type': 'FAQPage',
    '@id': faqId(pagePath),
    mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

export function itemListNode(pagePath: string, name: string, items: Array<{ path: string; name: string }>) {
  return {
    '@type': 'ItemList',
    '@id': listId(pagePath),
    name,
    numberOfItems: items.length,
    itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: absoluteUrl(c.path), name: c.name })),
  };
}

/** The schema.org type of a business by its primary category. */
export const BUSINESS_TYPE: Record<string, string> = {
  'hair-salons': 'HairSalon',
  nails: 'NailSalon',
  facials: 'BeautySalon',
  'brows-lashes': 'BeautySalon',
  makeup: 'BeautySalon',
  'permanent-makeup': 'BeautySalon',
  tanning: 'BeautySalon',
  'spa-massage': 'DaySpa',
  'dental-aesthetics': 'Dentist',
  'medical-aesthetics': 'MedicalClinic',
  'plastic-surgery': 'MedicalClinic',
  'hair-restoration': 'MedicalClinic',
  'body-contouring': 'HealthAndBeautyBusiness',
};

export function businessType(primaryCategory: string | null | undefined, medical = false): string {
  if (primaryCategory && BUSINESS_TYPE[primaryCategory]) return BUSINESS_TYPE[primaryCategory];
  return medical ? 'MedicalBusiness' : 'LocalBusiness';
}

/** Nodes with an @id must not repeat within one page's graph. */
export function duplicateIds(nodes: unknown[]): string[] {
  const seen = new Map<string, number>();
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    // A reference ({ "@id": x } alone) is not a definition.
    if (typeof o['@id'] === 'string' && Object.keys(o).length > 1) seen.set(o['@id'], (seen.get(o['@id']) ?? 0) + 1);
    for (const v of Object.values(o)) walk(v);
  };
  walk(nodes);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}

export const categoryOf = (slug: string): Category | undefined => categoryBySlug(slug) ?? CATEGORIES.find(c => c.slug === slug);
