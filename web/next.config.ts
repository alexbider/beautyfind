import type { NextConfig } from 'next';

// STAGING=1 (test deployments): nothing may be indexed, whatever a page's own robots metadata says.
const staging = process.env.STAGING === '1';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Onboarding uploads photos through a server action (8MB max per file, see lib/server/media.ts).
  experimental: { serverActions: { bodySizeLimit: '9mb' } },
  async headers() {
    return [
      // The service worker must always be re-checked, or clients keep an old one.
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      ...(staging ? [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }] : []),
    ];
  },
};

export default nextConfig;
