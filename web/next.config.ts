import type { NextConfig } from 'next';
import { CATEGORIES, REGIONS } from './src/lib/catalog';
import { PRIVATE_PREFIXES } from './src/lib/indexing';

// STAGING=1 (test deployments): nothing may be indexed, whatever a page's own robots metadata says.
const staging = process.env.STAGING === '1';
const NOINDEX = [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }];
// The admin, the business dashboard, the clinic system, accounts, token pages and the API are never
// indexed, on every response (HTML, exports, JSON), whatever the deployment or the settings say.
const privateSources = PRIVATE_PREFIXES.flatMap(p => (p.endsWith('/') ? [`${p}:path*`] : [p, `${p}/:path*`]));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Every next/image (the heroes, hero-clinic on /for-business, category and region photos) is served as AVIF or WebP.
  images: { formats: ['image/avif', 'image/webp'] },
  // Onboarding uploads photos through a server action (8MB max per file, see lib/server/media.ts).
  experimental: { serverActions: { bodySizeLimit: '9mb' } },
  // Listing pages live at /:region/:category/:slug (the listing's primary category). They are served by
  // the /:region/biz/:slug page, which redirects any other address to that one. Only category slugs
  // match here, so /:region/:city/:category pages are unaffected (city and category slugs never overlap).
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: `/:region(${REGIONS.map(r => r.slug).join('|')})/:category(${CATEGORIES.map(c => c.slug).join('|')})/:slug`,
          destination: '/:region/biz/:slug?via=:category',
        },
      ],
    };
  },
  async headers() {
    return [
      // The service worker must always be re-checked, or clients keep an old one.
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      ...(staging ? [{ source: '/:path*', headers: NOINDEX }] : privateSources.map(source => ({ source, headers: NOINDEX }))),
    ];
  },
};

export default nextConfig;
