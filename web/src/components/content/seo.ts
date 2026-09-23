import type { Metadata } from 'next';
import type { Crumb } from './ContentPage';
import type { ContentView } from './types';

/** Same origin as metadataBase in app/layout.tsx. */
export const SITE = 'https://beautyfind.co.il';

/**
 * Per-route metadata with a canonical. All these pages are indexable; the legal ones are meant to be
 * low priority, which is a sitemap concern (priority 0.3), not a robots one.
 */
export function contentMetadata(view: ContentView): Metadata {
  return {
    title: view.metaTitle,
    description: view.description,
    alternates: { canonical: view.href },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      locale: 'he_IL',
      siteName: 'BeautyFind',
      url: view.href,
      title: view.metaTitle,
      description: view.description,
    },
  };
}

export function breadcrumbJsonLd(crumbs: Crumb[], currentHref: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: `${SITE}${c.href ?? currentHref}`,
    })),
  };
}

export function faqJsonLd(faqs: Array<{ q: string; a: string }>) {
  const plain = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({ '@type': 'Question', name: plain(f.q), acceptedAnswer: { '@type': 'Answer', text: plain(f.a) } })),
  };
}

export function organizationJsonLd(description: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'BeautyFind',
    alternateName: 'ביוטיפיינד',
    url: SITE,
    description,
    areaServed: { '@type': 'Country', name: 'Israel' },
    knowsLanguage: 'he',
    contactPoint: [{ '@type': 'ContactPoint', contactType: 'customer support', url: `${SITE}/contact`, availableLanguage: 'he' }],
    // TODO(legal): add legalName, taxID and address once COMPANY in meta.ts is filled.
  };
}
