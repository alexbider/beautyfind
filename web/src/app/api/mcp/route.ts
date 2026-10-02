import { bearerChallenge } from '@/lib/mcp';
import { authenticateBearer, handleMcpRequest } from '@/lib/server/mcp';
import { siteUrl } from '@/lib/server/site';
import { cors, corsPreflight } from '@/lib/server/cors';

// The MCP endpoint (Streamable HTTP, stateless). Unauthenticated requests get the 401 challenge that
// points clients at the OAuth metadata; see src/lib/mcp.ts for the flow and src/lib/server/mcp.ts
// for the tools. GET (a standalone SSE stream) is not offered: every call is one POST.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function serve(req: Request): Promise<Response> {
  const caller = await authenticateBearer(req);
  if (!caller) {
    const hasToken = /^Bearer\s+\S+/i.test(req.headers.get('authorization') ?? '');
    return cors(new Response(JSON.stringify({ error: hasToken ? 'invalid_token' : 'unauthorized', error_description: 'a bearer token of a BeautyFind staff member is required' }), {
      status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': bearerChallenge(siteUrl(), hasToken ? 'invalid_token' : undefined) },
    }));
  }
  return cors(await handleMcpRequest(req, caller));
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
export const OPTIONS = corsPreflight;
