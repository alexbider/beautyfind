import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Onboarding uploads photos through a server action (8MB max per file, see lib/server/media.ts).
  experimental: { serverActions: { bodySizeLimit: '9mb' } },
};

export default nextConfig;
