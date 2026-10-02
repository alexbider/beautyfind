import { corsPreflight, json } from '@/lib/server/cors';
import { tokenEndpoint } from '@/lib/server/mcp';

// The OAuth token endpoint: authorization_code with PKCE, and refresh_token (rotated on every use).

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let form: URLSearchParams;
  const type = req.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) form = new URLSearchParams(Object.entries((await req.json()) as Record<string, string>).map(([k, v]) => [k, String(v)]));
    else form = new URLSearchParams(await req.text());
  } catch { return json({ error: 'invalid_request', error_description: 'body must be form encoded' }, 400); }
  const r = await tokenEndpoint(req.headers.get('authorization'), form);
  return json(r.body, r.status);
}

export const OPTIONS = corsPreflight;
