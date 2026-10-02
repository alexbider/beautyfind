import type { MetadataRoute } from 'next';
import { PRIVATE_PREFIXES } from '@/lib/indexing';
import { indexingPolicy } from '@/lib/server/indexing';
import { siteUrl } from '@/lib/server/site';

// Re-read every five minutes, and at once when staff flip a switch on /ops/content (revalidatePath).
export const revalidate = 300;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const policy = await indexingPolicy();
  // Test deployments, and a site whose master switch is off, are never crawled.
  if (policy.staging || !policy.site) return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: PRIVATE_PREFIXES }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
