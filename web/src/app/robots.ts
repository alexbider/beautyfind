import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/server/site';

export default function robots(): MetadataRoute.Robots {
  // Test deployments are never crawled.
  if (process.env.STAGING === '1') return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/biz', '/ops', '/login', '/logout', '/invite', '/for-business/join', '/for-business/claim', '/api'] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
