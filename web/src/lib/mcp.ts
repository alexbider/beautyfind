import { createHash, timingSafeEqual } from 'node:crypto';

// The MCP server's pure parts (no database): OAuth metadata, redirect URI rules, PKCE, token formats.
// The database side is src/lib/server/mcp.ts; the routes are under src/app/api/mcp and src/app/.well-known.
//
// How a client connects: claude.ai, Claude Desktop and Claude Code follow the MCP authorization flow.
// They read /.well-known/oauth-protected-resource/api/mcp, then /.well-known/oauth-authorization-server,
// register themselves (dynamic client registration), send the staff member to /ops/mcp/authorize to
// approve, and exchange the code for a bearer token at /api/mcp/oauth/token (PKCE S256). A staff member
// can also create a personal token on /ops/ai and paste it as a bearer header.

export const MCP_PATH = '/api/mcp';
export const MCP_SCOPE = 'mcp';
/**
 * The narrow scope for article writers: the magazine tools plus a few shared reads (list_pages, list_branches,
 * search_businesses, revalidate_pages). No business, billing or client data. A token with this scope is
 * still filtered by its owner's role.
 */
export const MCP_MAGAZINE_SCOPE = 'mcp:magazine';
export const MCP_SCOPES = [MCP_SCOPE, MCP_MAGAZINE_SCOPE] as const;
export type TokenScope = 'magazine' | null;

/** The stored token scope for a requested OAuth scope string: "magazine" when only the magazine scope was asked for. */
export function tokenScopeFor(scope: string | null | undefined): TokenScope {
  const parts = (scope ?? '').split(/\s+/).filter(Boolean);
  return parts.length > 0 && parts.every(p => p === MCP_MAGAZINE_SCOPE) ? 'magazine' : null;
}
export const PERSONAL_TOKEN_PREFIX = 'bfmcp_';
export const ACCESS_TOKEN_DAYS = 7;
export const REFRESH_TOKEN_DAYS = 180;
export const AUTH_CODE_MINUTES = 10;

export const mcpUrl = (site: string) => `${site.replace(/\/$/, '')}${MCP_PATH}`;

/** RFC 8414 authorization server metadata, served at /.well-known/oauth-authorization-server. */
export function authorizationServerMetadata(site: string) {
  const s = site.replace(/\/$/, '');
  return {
    issuer: s,
    authorization_endpoint: `${s}/ops/mcp/authorize`,
    token_endpoint: `${s}/api/mcp/oauth/token`,
    registration_endpoint: `${s}/api/mcp/oauth/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [...MCP_SCOPES],
    service_documentation: `${s}/ops/ai?tab=mcp`,
  };
}

/** RFC 9728 protected resource metadata, served at /.well-known/oauth-protected-resource(/api/mcp). */
export function protectedResourceMetadata(site: string) {
  const s = site.replace(/\/$/, '');
  return { resource: mcpUrl(s), authorization_servers: [s], bearer_methods_supported: ['header'], scopes_supported: [...MCP_SCOPES], resource_name: 'BeautyFind ניהול' };
}

/** The 401 challenge that points a client at the metadata (MCP authorization spec). */
export const bearerChallenge = (site: string, error?: string) =>
  `Bearer resource_metadata="${site.replace(/\/$/, '')}/.well-known/oauth-protected-resource/api/mcp"${error ? `, error="${error}"` : ''}`;

/** Redirect URIs must be https, or http on localhost for desktop and CLI clients. No fragments. */
export function validRedirectUri(uri: string): boolean {
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  return false;
}

/** Exact match, as RFC 6749 requires for registered redirect URIs. */
export const redirectAllowed = (registered: string[], uri: string) => registered.includes(uri);

const base64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** PKCE S256: the challenge is base64url(sha256(verifier)). */
export const pkceChallenge = (verifier: string) => base64url(createHash('sha256').update(verifier).digest());

export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const a = Buffer.from(pkceChallenge(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Builds the redirect back to the client with the code or the error, keeping its own query and state. */
export function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

export interface AuthorizeParams { clientId: string; redirectUri: string; codeChallenge: string; state?: string; scope?: string; resource?: string }

/** Validates the query of an authorization request. Returns the params or the OAuth error to show. */
export function parseAuthorizeQuery(q: Record<string, string | undefined>): { ok: true; params: AuthorizeParams } | { ok: false; error: string; description: string } {
  if (q.response_type !== 'code') return { ok: false, error: 'unsupported_response_type', description: 'response_type must be code' };
  if (!q.client_id) return { ok: false, error: 'invalid_request', description: 'client_id is required' };
  if (!q.redirect_uri || !validRedirectUri(q.redirect_uri)) return { ok: false, error: 'invalid_request', description: 'redirect_uri is missing or not allowed' };
  if (!q.code_challenge || (q.code_challenge_method ?? 'S256') !== 'S256') return { ok: false, error: 'invalid_request', description: 'PKCE with S256 is required' };
  if (!/^[A-Za-z0-9\-_]{43}$/.test(q.code_challenge)) return { ok: false, error: 'invalid_request', description: 'code_challenge is not a valid S256 value' };
  if (q.scope && q.scope.split(/\s+/).some(sc => sc && !(MCP_SCOPES as readonly string[]).includes(sc))) return { ok: false, error: 'invalid_scope', description: `only the ${MCP_SCOPES.join(' and ')} scopes exist` };
  return { ok: true, params: { clientId: q.client_id, redirectUri: q.redirect_uri, codeChallenge: q.code_challenge, state: q.state, scope: q.scope, resource: q.resource } };
}

/** Parses a Basic or form client authentication into id and optional secret. */
export function clientCredentials(authorization: string | null, form: URLSearchParams): { clientId: string | null; secret: string | null } {
  const m = /^Basic\s+(.+)$/i.exec(authorization ?? '');
  if (m) {
    const [id, ...rest] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
    return { clientId: decodeURIComponent(id ?? '') || null, secret: rest.length ? decodeURIComponent(rest.join(':')) : null };
  }
  return { clientId: form.get('client_id'), secret: form.get('client_secret') };
}

export const isPersonalToken = (t: string) => t.startsWith(PERSONAL_TOKEN_PREFIX);
