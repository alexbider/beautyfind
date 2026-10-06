import type { MetadataRoute } from 'next';
import { sitemapEntries } from '@/lib/server/sitemapEntries';

export const revalidate = 3600;

// The sitemap is the same list the get_sitemap_urls MCP tool returns (src/lib/server/sitemapEntries.ts):
// public, indexable pages only, city + category pages with at least one live listing, articles that are
// published and indexable, each with its last change where one is known.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries = await sitemapEntries();
  return entries.map(e => ({ url: e.url, priority: e.priority, changeFrequency: e.changeFrequency, ...(e.lastModified ? { lastModified: e.lastModified } : {}) }));
}
