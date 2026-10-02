import 'server-only';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { McpClient, McpTokenKind, User } from '@prisma/client';
import { z } from 'zod';
import { permissionOverrides } from './platformSettings';
import { AREAS, atLeast, levelOf, type Area, type Level } from '@/components/ops/roles';
import {
  ACCESS_TOKEN_DAYS, AUTH_CODE_MINUTES, MCP_SCOPE, PERSONAL_TOKEN_PREFIX, REFRESH_TOKEN_DAYS, type AuthorizeParams, clientCredentials, pkceMatches, redirectAllowed, validRedirectUri,
} from '@/lib/mcp';
import { withActor } from './actorContext';
import type { Proposal } from './assistant';
import { MCP_TOOLS } from './mcpTools';
import { randomToken, sha256 } from './crypto';
import { db } from './db';
import { siteUrl } from './site';

// The MCP server behind /api/mcp (src/lib/mcp.ts explains the flow). Every request is authenticated
// with a bearer token that belongs to one staff member; the tools offered are the assistant's catalog
// filtered by that person's admin permissions, writes still go to the approvals queue (source
// mcp:claude), and every call is one audit row. Stateless: one McpServer per request, no sessions.

const SOURCE = 'mcp:claude';
const days = (n: number) => new Date(Date.now() + n * 86_400_000);
const minutes = (n: number) => new Date(Date.now() + n * 60_000);

// ---------- bearer tokens ----------

export interface McpCaller { user: User; tokenId: string; clientId: string | null; kind: McpTokenKind }

/** The staff member behind a bearer token, or null. Personal and access tokens only, live and unexpired. */
export async function authenticateBearer(req: Request): Promise<McpCaller | null> {
  const raw = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!raw) return null;
  const t = await db.mcpToken.findUnique({ where: { tokenHash: sha256(raw) }, include: { user: true } });
  if (!t || t.revokedAt || t.kind === 'refresh' || (t.expiresAt && t.expiresAt < new Date()) || !t.user.opsRole) return null;
  db.mcpToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return { user: t.user, tokenId: t.id, clientId: t.clientId, kind: t.kind };
}

/** A personal token for a staff member, shown once. Stored as a hash, never expires until revoked. */
export async function createPersonalToken(user: Pick<User, 'id'>, name: string): Promise<{ id: string; token: string }> {
  const token = PERSONAL_TOKEN_PREFIX + randomToken(32);
  const row = await db.mcpToken.create({ data: { userId: user.id, kind: 'personal', name: name.trim().slice(0, 60) || 'אסימון אישי', tokenHash: sha256(token) }, select: { id: true } });
  await db.auditLog.create({ data: { actorId: user.id, action: 'mcp_token_created', subjectType: 'mcp_token', subjectId: row.id, meta: { ref: name } } });
  return { id: row.id, token };
}

export async function revokeToken(user: Pick<User, 'id'>, tokenId: string): Promise<boolean> {
  const r = await db.mcpToken.updateMany({ where: { id: tokenId, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (r.count) await db.auditLog.create({ data: { actorId: user.id, action: 'mcp_token_revoked', subjectType: 'mcp_token', subjectId: tokenId, meta: {} } });
  return r.count > 0;
}

/** Disconnects an app: every live token this staff member holds for the client. */
export async function revokeClientForUser(user: Pick<User, 'id'>, clientId: string): Promise<number> {
  const r = await db.mcpToken.updateMany({ where: { clientId, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (r.count) await db.auditLog.create({ data: { actorId: user.id, action: 'mcp_client_revoked', subjectType: 'mcp_client', subjectId: clientId, meta: { count: r.count } } });
  return r.count;
}

async function issueTokens(userId: string, clientId: string) {
  const access = randomToken(32);
  const refresh = randomToken(32);
  await db.mcpToken.createMany({ data: [
    { userId, clientId, kind: 'access', tokenHash: sha256(access), expiresAt: days(ACCESS_TOKEN_DAYS) },
    { userId, clientId, kind: 'refresh', tokenHash: sha256(refresh), expiresAt: days(REFRESH_TOKEN_DAYS) },
  ] });
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TOKEN_DAYS * 86_400, refresh_token: refresh, scope: MCP_SCOPE };
}

// ---------- OAuth: clients, codes, token endpoint ----------

const Registration = z.object({
  client_name: z.string().trim().min(1).max(120).optional(),
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  token_endpoint_auth_method: z.enum(['none', 'client_secret_post', 'client_secret_basic']).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
});

export type OAuthError = { error: string; error_description: string };

/** Dynamic client registration (RFC 7591). Public clients by default; a secret only when asked for. */
export async function registerClient(body: unknown): Promise<{ ok: true; response: Record<string, unknown> } | { ok: false; status: number; error: OAuthError }> {
  const p = Registration.safeParse(body);
  if (!p.success) return { ok: false, status: 400, error: { error: 'invalid_client_metadata', error_description: p.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') } };
  const bad = p.data.redirect_uris.find(u => !validRedirectUri(u));
  if (bad) return { ok: false, status: 400, error: { error: 'invalid_redirect_uri', error_description: `redirect_uri not allowed: ${bad}` } };
  const method = p.data.token_endpoint_auth_method ?? 'none';
  const secret = method === 'none' ? null : randomToken(32);
  const row = await db.mcpClient.create({ data: { name: p.data.client_name ?? 'MCP client', redirectUris: p.data.redirect_uris, secretHash: secret ? sha256(secret) : null }, select: { id: true, createdAt: true } });
  await db.auditLog.create({ data: { action: 'mcp_client_registered', subjectType: 'mcp_client', subjectId: row.id, meta: { ref: p.data.client_name ?? 'MCP client', redirect: p.data.redirect_uris } } });
  return { ok: true, response: {
    client_id: row.id, ...(secret ? { client_secret: secret } : {}), client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
    client_name: p.data.client_name ?? 'MCP client', redirect_uris: p.data.redirect_uris, token_endpoint_auth_method: method,
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: MCP_SCOPE,
  } };
}

export const getClient = (id: string) => (/^[0-9a-f-]{36}$/i.test(id) ? db.mcpClient.findUnique({ where: { id } }) : Promise.resolve(null));

/** After the staff member approved on /ops/mcp/authorize: a one-time code bound to the client, the redirect and the PKCE challenge. */
export async function createAuthCode(user: Pick<User, 'id'>, client: McpClient, params: AuthorizeParams): Promise<string> {
  const code = randomToken(32);
  await db.mcpAuthCode.create({ data: { codeHash: sha256(code), clientId: client.id, userId: user.id, redirectUri: params.redirectUri, codeChallenge: params.codeChallenge, expiresAt: minutes(AUTH_CODE_MINUTES) } });
  await db.auditLog.create({ data: { actorId: user.id, action: 'mcp_authorized', subjectType: 'mcp_client', subjectId: client.id, meta: { ref: client.name } } });
  return code;
}

async function authenticatedClient(authorization: string | null, form: URLSearchParams): Promise<McpClient | OAuthError> {
  const { clientId, secret } = clientCredentials(authorization, form);
  const client = clientId ? await getClient(clientId) : null;
  if (!client) return { error: 'invalid_client', error_description: 'unknown client' };
  if (client.secretHash && (!secret || sha256(secret) !== client.secretHash)) return { error: 'invalid_client', error_description: 'client authentication failed' };
  return client;
}

/** The token endpoint: authorization_code (with PKCE) and refresh_token (rotated). */
export async function tokenEndpoint(authorization: string | null, form: URLSearchParams): Promise<{ status: number; body: Record<string, unknown> }> {
  const client = await authenticatedClient(authorization, form);
  if ('error' in client) return { status: 401, body: client };
  const grant = form.get('grant_type');
  if (grant === 'authorization_code') {
    const code = form.get('code') ?? '';
    const verifier = form.get('code_verifier') ?? '';
    const redirectUri = form.get('redirect_uri') ?? '';
    const row = code ? await db.mcpAuthCode.findUnique({ where: { codeHash: sha256(code) }, include: { user: true } }) : null;
    if (!row || row.clientId !== client.id || row.usedAt || row.expiresAt < new Date()) return { status: 400, body: { error: 'invalid_grant', error_description: 'code is unknown, used or expired' } };
    if (redirectUri && redirectUri !== row.redirectUri) return { status: 400, body: { error: 'invalid_grant', error_description: 'redirect_uri does not match' } };
    if (!pkceMatches(verifier, row.codeChallenge)) return { status: 400, body: { error: 'invalid_grant', error_description: 'PKCE verification failed' } };
    if (!row.user.opsRole) return { status: 400, body: { error: 'invalid_grant', error_description: 'the account is no longer staff' } };
    const used = await db.mcpAuthCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!used.count) return { status: 400, body: { error: 'invalid_grant', error_description: 'code already used' } };
    return { status: 200, body: await issueTokens(row.userId, client.id) };
  }
  if (grant === 'refresh_token') {
    const raw = form.get('refresh_token') ?? '';
    const row = raw ? await db.mcpToken.findUnique({ where: { tokenHash: sha256(raw) }, include: { user: true } }) : null;
    if (!row || row.kind !== 'refresh' || row.clientId !== client.id || row.revokedAt || (row.expiresAt && row.expiresAt < new Date())) return { status: 400, body: { error: 'invalid_grant', error_description: 'refresh token is unknown, revoked or expired' } };
    if (!row.user.opsRole) return { status: 400, body: { error: 'invalid_grant', error_description: 'the account is no longer staff' } };
    const rotated = await db.mcpToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!rotated.count) return { status: 400, body: { error: 'invalid_grant', error_description: 'refresh token already used' } };
    return { status: 200, body: await issueTokens(row.userId, client.id) };
  }
  return { status: 400, body: { error: 'unsupported_grant_type', error_description: 'use authorization_code or refresh_token' } };
}

// ---------- the MCP server ----------

const INSTRUCTIONS = `שרת הניהול של BeautyFind (מדריך יופי ואסתטיקה ישראלי). הכלים הם מסכי הניהול עצמם: עסקים ופרופילים (פרטים, תוכן, מדיה, עובדות, טיפולים), עמודים ו־SEO, אינדוקס, ביקורות ודיווחים, מחלוקות, מקומות ממומנים, לקוחות ופרטיות, תור אישורי ה־AI והגדרות הפלטפורמה. כל קריאה וכל כתיבה נרשמות ביומן הפעולות על שם איש הצוות שהתחבר, וכתיבה עוברת את אותם אימותים כמו במסך. אין גישה לפרטי בריאות של לקוחות. הכלים הזמינים תלויים בהרשאות של איש הצוות. לפני שינוי, קראו את הרשומה (get_branch, get_business, list_pages) ושלחו רק את השדות שמשתנים.`;

/** The caller's level in every area, after the overrides saved on /ops/team. */
export async function callerLevels(user: Pick<User, 'opsRole'>): Promise<Record<Area, Level>> {
  const over = await permissionOverrides();
  return Object.fromEntries(AREAS.map(a => [a, user.opsRole ? levelOf(user.opsRole, a, over) : 'none'])) as Record<Area, Level>;
}

export const toolAllowed = (levels: Record<Area, Level>, t: { area: Area; level: Level }) => atLeast(levels[t.area], t.level);

/** Serves one MCP request for an authenticated staff member. */
export async function handleMcpRequest(req: Request, caller: McpCaller): Promise<Response> {
  const levels = await callerLevels(caller.user);
  const server = new McpServer({ name: 'beautyfind-ops', version: '2.0.0' }, { instructions: INSTRUCTIONS });
  const actor = { id: caller.user.id, opsRole: caller.user.opsRole ?? null };
  const run = async (name: string, input: Record<string, unknown>) => {
    const tool = MCP_TOOLS.find(t => t.name === name)!;
    const proposals: Proposal[] = [];
    let out: unknown;
    let error: string | null = null;
    try {
      out = await withActor(caller.user, () => tool.run(input, { proposals, source: SOURCE, actor }));
      if (out && typeof out === 'object' && ('error' in out) && (out as { ok?: boolean }).ok !== true) error = String((out as { error: unknown }).error);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      out = { error };
    }
    await db.auditLog.create({ data: { actorId: caller.user.id, action: 'mcp_call', subjectType: 'mcp', subjectId: caller.user.id, meta: { ref: name, tool: name, write: tool.write, clientId: caller.clientId, tokenKind: caller.kind, ...(proposals.length ? { proposals: proposals.map(p => p.ref) } : {}), ...(error ? { error } : {}) } } }).catch(() => undefined);
    return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 1).slice(0, 80_000) }], isError: !!error };
  };
  for (const t of MCP_TOOLS) {
    if (!toolAllowed(levels, t)) continue;
    const annotations = { readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write, openWorldHint: false };
    if (t.schema) server.registerTool(t.name, { description: t.description, inputSchema: t.schema.shape, annotations }, async args => run(t.name, args as Record<string, unknown>));
    else server.registerTool(t.name, { description: t.description, annotations }, async () => run(t.name, {}));
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    transport.close().catch(() => undefined);
  }
}

// ---------- data for /ops/ai, tab שרת MCP ----------

export async function mcpOverview(user: User) {
  const [levels, tokens, recent] = await Promise.all([
    callerLevels(user),
    db.mcpToken.findMany({ where: { userId: user.id, revokedAt: null, kind: { in: ['personal', 'access'] } }, include: { client: { select: { id: true, name: true, redirectUris: true } } }, orderBy: { createdAt: 'desc' } }),
    db.auditLog.findMany({ where: { action: 'mcp_call' }, orderBy: { createdAt: 'desc' }, take: 20, select: { actorId: true, createdAt: true, meta: true } }),
  ]);
  const actorIds = [...new Set(recent.map(r => r.actorId).filter((x): x is string => !!x))];
  const actors = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true, email: true } }) : [];
  const who = new Map(actors.map(a => [a.id, a.fullName || a.email || 'צוות']));
  const personal = tokens.filter(t => t.kind === 'personal').map(t => ({ id: t.id, name: t.name ?? '', createdAt: t.createdAt, lastUsedAt: t.lastUsedAt }));
  const apps = new Map<string, { id: string; name: string; host: string; since: Date; lastUsedAt: Date | null; tokens: number }>();
  for (const t of tokens) {
    if (!t.client) continue;
    const cur = apps.get(t.client.id);
    const host = t.client.redirectUris[0] ? new URL(t.client.redirectUris[0]).host : '';
    if (cur) { cur.tokens += 1; cur.since = t.createdAt < cur.since ? t.createdAt : cur.since; cur.lastUsedAt = !cur.lastUsedAt || (t.lastUsedAt && t.lastUsedAt > cur.lastUsedAt) ? t.lastUsedAt : cur.lastUsedAt; }
    else apps.set(t.client.id, { id: t.client.id, name: t.client.name, host, since: t.createdAt, lastUsedAt: t.lastUsedAt, tokens: 1 });
  }
  return {
    url: `${siteUrl()}/api/mcp`,
    tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description, area: t.area, level: t.level, write: t.write, allowed: toolAllowed(levels, t) })),
    personal,
    apps: [...apps.values()],
    recent: recent.map(r => ({ at: r.createdAt, who: (r.actorId && who.get(r.actorId)) || 'צוות', tool: String((r.meta as { tool?: string } | null)?.tool ?? ''), error: Boolean((r.meta as { error?: string } | null)?.error) })),
  };
}
