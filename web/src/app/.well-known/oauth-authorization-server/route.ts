import { authorizationServerMetadata } from '@/lib/mcp';
import { corsPreflight, json } from '@/lib/server/cors';
import { siteUrl } from '@/lib/server/site';

// RFC 8414 metadata for the MCP server's OAuth flow (src/lib/mcp.ts).
export const dynamic = 'force-dynamic';
export const GET = () => json(authorizationServerMetadata(siteUrl()), 200, { 'cache-control': 'public, max-age=3600' });
export const OPTIONS = corsPreflight;
