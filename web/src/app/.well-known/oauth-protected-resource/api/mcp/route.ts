import { protectedResourceMetadata } from '@/lib/mcp';
import { corsPreflight, json } from '@/lib/server/cors';
import { siteUrl } from '@/lib/server/site';

// RFC 9728 metadata for /api/mcp (path form, the one the 401 challenge names).
export const dynamic = 'force-dynamic';
export const GET = () => json(protectedResourceMetadata(siteUrl()), 200, { 'cache-control': 'public, max-age=3600' });
export const OPTIONS = corsPreflight;
