import type { Metadata } from 'next';
import { publicMetadata } from '@/lib/seo/meta';
import { breadcrumbNode, faqNode, graph, organizationNode, webPageNode } from '@/lib/seo/schema';
import type { Crumb } from './ContentPage';
import type { ContentView } from './types';

/**
 * Per-route metadata with a canonical. All these pages are indexable; the legal ones are meant to be
 * low priority, which is a sitemap concern (priority 0.3), not a robots one.
 */
export function contentMetadata(view: ContentView): Metadata {
  return { ...publicMetadata({ path: view.href, title: view.metaTitle, description: view.description }), robots: { index: true, follow: true } };
}

const plain = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

/**
 * The page's structured data as one graph: the WebPage (AboutPage for /about) with its breadcrumb, the
 * Organization on the about page, and the FAQ where the page has one.
 */
export function contentJsonLd(view: ContentView, crumbs: Crumb[], opts: { organization?: boolean; faqs?: Array<{ q: string; a: string }>; type?: 'WebPage' | 'AboutPage' } = {}) {
  return graph([
    webPageNode({ path: view.href, type: opts.type ?? 'WebPage', name: view.metaTitle, description: view.description, breadcrumb: true }),
    breadcrumbNode(view.href, crumbs.map(c => ({ name: c.name, path: c.href ?? view.href }))),
    ...(opts.organization ? [organizationNode(view.description)] : []),
    ...(opts.faqs?.length ? [faqNode(view.href, opts.faqs.map(f => ({ q: plain(f.q), a: plain(f.a) })))] : []),
  ]);
}

