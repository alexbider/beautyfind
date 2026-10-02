import { corsPreflight, json } from '@/lib/server/cors';
import { registerClient } from '@/lib/server/mcp';

// OAuth dynamic client registration (RFC 7591) for MCP clients. Open, as the spec expects: a client
// gets nothing from registering until a staff member approves it on /ops/mcp/authorize.

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'invalid_client_metadata', error_description: 'body must be JSON' }, 400); }
  const r = await registerClient(body);
  return r.ok ? json(r.response, 201) : json(r.error, r.status);
}

export const OPTIONS = corsPreflight;
