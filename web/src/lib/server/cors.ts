// CORS for the MCP and OAuth endpoints: browser-based MCP clients (the inspector, desktop apps built on
// web views) send a preflight; server-side clients (claude.ai) do not need it but are unaffected.

const HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'access-control-expose-headers': 'Mcp-Session-Id, WWW-Authenticate',
  'access-control-max-age': '86400',
};

export function cors(res: Response): Response {
  for (const [k, v] of Object.entries(HEADERS)) res.headers.set(k, v);
  return res;
}

export const corsPreflight = () => new Response(null, { status: 204, headers: HEADERS });

export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  cors(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } }));
