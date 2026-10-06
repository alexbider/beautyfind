// MCP server: the pure OAuth helpers (metadata, redirect rules, PKCE, authorize query parsing) and, with
// a local database, client registration, the authorization code exchange, refresh rotation and bearer
// authentication. The HTTP routes are thin wrappers over these functions.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { authorizationServerMetadata, bearerChallenge, clientCredentials, parseAuthorizeQuery, pkceChallenge, pkceMatches, protectedResourceMetadata, redirectWith, tokenScopeFor, validRedirectUri } from '../../src/lib/mcp';

const URL_OK = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const skip = URL_OK ? false : 'needs a local DATABASE_URL';
const SITE = 'https://beautyfind.co.il';

describe('mcp: metadata and challenge', () => {
  it('points clients at the endpoints under the site origin', () => {
    const m = authorizationServerMetadata(SITE + '/');
    assert.equal(m.issuer, SITE);
    assert.equal(m.authorization_endpoint, `${SITE}/ops/mcp/authorize`);
    assert.equal(m.token_endpoint, `${SITE}/api/mcp/oauth/token`);
    assert.equal(m.registration_endpoint, `${SITE}/api/mcp/oauth/register`);
    assert.deepEqual(m.code_challenge_methods_supported, ['S256']);
    assert.ok(m.token_endpoint_auth_methods_supported.includes('none'), 'public clients (claude.ai) register without a secret');
    const r = protectedResourceMetadata(SITE);
    assert.equal(r.resource, `${SITE}/api/mcp`);
    assert.deepEqual(r.authorization_servers, [SITE]);
    assert.match(bearerChallenge(SITE), /^Bearer resource_metadata="https:\/\/beautyfind\.co\.il\/\.well-known\/oauth-protected-resource\/api\/mcp"$/);
    assert.match(bearerChallenge(SITE, 'invalid_token'), /error="invalid_token"$/);
  });
});

describe('mcp: redirect URIs and PKCE', () => {
  it('allows https and loopback http only, and matches registered URIs exactly', () => {
    assert.equal(validRedirectUri('https://claude.ai/api/mcp/auth_callback'), true);
    assert.equal(validRedirectUri('http://localhost:3334/callback'), true);
    assert.equal(validRedirectUri('http://127.0.0.1:8080/cb'), true);
    assert.equal(validRedirectUri('http://example.com/cb'), false);
    assert.equal(validRedirectUri('https://claude.ai/cb#frag'), false);
    assert.equal(validRedirectUri('javascript:alert(1)'), false);
    assert.equal(validRedirectUri('not a url'), false);
    const back = redirectWith('https://claude.ai/api/mcp/auth_callback?x=1', { code: 'abc', state: 's t' });
    assert.equal(back, 'https://claude.ai/api/mcp/auth_callback?x=1&code=abc&state=s+t');
  });

  it('verifies S256 challenges and rejects short or wrong verifiers', () => {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = pkceChallenge(verifier);
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(pkceMatches(verifier, challenge), true);
    assert.equal(pkceMatches(verifier + 'x', challenge), false);
    assert.equal(pkceMatches('short', pkceChallenge('short')), false, 'verifiers are at least 43 characters');
  });

  it('parses an authorization request and names the error otherwise', () => {
    const good = parseAuthorizeQuery({ response_type: 'code', client_id: 'c', redirect_uri: 'https://claude.ai/cb', code_challenge: pkceChallenge('a'.repeat(50)), code_challenge_method: 'S256', state: 'xyz', scope: 'mcp' });
    assert.ok(good.ok);
    assert.equal(good.params.state, 'xyz');
    assert.equal(parseAuthorizeQuery({ response_type: 'token', client_id: 'c', redirect_uri: 'https://claude.ai/cb', code_challenge: pkceChallenge('a'.repeat(50)) }).ok, false);
    const noPkce = parseAuthorizeQuery({ response_type: 'code', client_id: 'c', redirect_uri: 'https://claude.ai/cb' });
    assert.ok(!noPkce.ok && noPkce.error === 'invalid_request');
    const plain = parseAuthorizeQuery({ response_type: 'code', client_id: 'c', redirect_uri: 'https://claude.ai/cb', code_challenge: 'x', code_challenge_method: 'plain' });
    assert.ok(!plain.ok, 'plain PKCE is refused');
    const badScope = parseAuthorizeQuery({ response_type: 'code', client_id: 'c', redirect_uri: 'https://claude.ai/cb', code_challenge: pkceChallenge('a'.repeat(50)), scope: 'admin' });
    assert.ok(!badScope.ok && badScope.error === 'invalid_scope');
    const magazine = parseAuthorizeQuery({ response_type: 'code', client_id: 'c', redirect_uri: 'https://claude.ai/cb', code_challenge: pkceChallenge('a'.repeat(50)), scope: 'mcp:magazine' });
    assert.ok(magazine.ok, 'the magazine scope is accepted');
    assert.equal(tokenScopeFor('mcp:magazine'), 'magazine');
    assert.equal(tokenScopeFor('mcp mcp:magazine'), null, 'asking for the full scope too keeps the full scope');
    assert.equal(tokenScopeFor(undefined), null);
  });

  it('reads client credentials from Basic auth or the form', () => {
    const basic = `Basic ${Buffer.from('id-1:sec:ret').toString('base64')}`;
    assert.deepEqual(clientCredentials(basic, new URLSearchParams()), { clientId: 'id-1', secret: 'sec:ret' });
    assert.deepEqual(clientCredentials(null, new URLSearchParams({ client_id: 'id-2' })), { clientId: 'id-2', secret: null });
  });
});

describe('mcp: OAuth flow and bearer tokens', { skip }, () => {
  let db: PrismaClient;
  let mcp: typeof import('../../src/lib/server/mcp');
  const made = { users: [] as string[], clients: [] as string[] };

  before(async () => {
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient();
    mcp = await import('../../src/lib/server/mcp');
  });
  after(async () => {
    await db.mcpClient.deleteMany({ where: { id: { in: made.clients } } });
    await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: made.users } }, { subjectId: { in: made.clients } }] } });
    await db.user.deleteMany({ where: { id: { in: made.users } } });
    await db.$disconnect();
  });

  const staff = async (opsRole: 'ops' | 'support' | null = 'ops') => {
    const u = await db.user.create({ data: { email: `mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`, fullName: 'בדיקה', opsRole } });
    made.users.push(u.id);
    return u;
  };
  const req = (token?: string) => new Request('https://beautyfind.co.il/api/mcp', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} });

  it('registers a public client, exchanges a code with PKCE, rotates the refresh token, and authenticates the bearer', async () => {
    const reg = await mcp.registerClient({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
    assert.ok(reg.ok);
    const clientId = String(reg.response.client_id);
    made.clients.push(clientId);
    assert.equal(reg.response.token_endpoint_auth_method, 'none');
    assert.equal('client_secret' in reg.response, false);

    const user = await staff('ops');
    const client = (await mcp.getClient(clientId))!;
    const verifier = randomBytes(32).toString('base64url');
    const code = await mcp.createAuthCode(user, client, { clientId, redirectUri: 'https://claude.ai/api/mcp/auth_callback', codeChallenge: pkceChallenge(verifier) });

    const wrong = await mcp.tokenEndpoint(null, new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: 'b'.repeat(50), redirect_uri: 'https://claude.ai/api/mcp/auth_callback' }));
    assert.equal(wrong.status, 400, 'a wrong verifier is refused');

    const tok = await mcp.tokenEndpoint(null, new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: 'https://claude.ai/api/mcp/auth_callback' }));
    assert.equal(tok.status, 200, JSON.stringify(tok.body));
    const access = String(tok.body.access_token);
    const refresh = String(tok.body.refresh_token);
    assert.equal(tok.body.token_type, 'Bearer');

    const again = await mcp.tokenEndpoint(null, new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier }));
    assert.equal(again.status, 400, 'a code is one-time');

    const caller = await mcp.authenticateBearer(req(access));
    assert.ok(caller && caller.user.id === user.id && caller.kind === 'access' && caller.clientId === clientId);
    assert.equal(await mcp.authenticateBearer(req(refresh)), null, 'a refresh token is not a bearer token');
    assert.equal(await mcp.authenticateBearer(req('nope')), null);
    assert.equal(await mcp.authenticateBearer(req()), null);

    const rotated = await mcp.tokenEndpoint(null, new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refresh }));
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.body.access_token, access);
    const reuse = await mcp.tokenEndpoint(null, new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refresh }));
    assert.equal(reuse.status, 400, 'a used refresh token is dead');

    const n = await mcp.revokeClientForUser(user, clientId);
    assert.ok(n >= 1);
    assert.equal(await mcp.authenticateBearer(req(String(rotated.body.access_token))), null, 'disconnecting the app kills its tokens');
  });

  it('personal tokens carry the owner and die on revocation; a confidential client needs its secret', async () => {
    const user = await staff('support');
    const t = await mcp.createPersonalToken(user, 'Claude Code');
    assert.match(t.token, /^bfmcp_/);
    const caller = await mcp.authenticateBearer(req(t.token));
    assert.ok(caller && caller.kind === 'personal' && caller.user.id === user.id);
    const levels = await mcp.callerLevels(user);
    assert.equal(mcp.toolAllowed(levels, { area: 'overview', level: 'view' }), true);
    assert.equal(mcp.toolAllowed(levels, { area: 'accounting', level: 'view' }), false, 'support has no accounting access, so billing_overview is not offered');
    assert.equal(await mcp.revokeToken(user, t.id), true);
    assert.equal(await mcp.authenticateBearer(req(t.token)), null);

    const reg = await mcp.registerClient({ client_name: 'Server app', redirect_uris: ['https://app.example/cb'], token_endpoint_auth_method: 'client_secret_post' });
    assert.ok(reg.ok);
    made.clients.push(String(reg.response.client_id));
    assert.ok(typeof reg.response.client_secret === 'string');
    const r = await mcp.tokenEndpoint(null, new URLSearchParams({ grant_type: 'refresh_token', client_id: String(reg.response.client_id), refresh_token: 'x' }));
    assert.equal(r.status, 401, 'no secret, no token');
    const bad = await mcp.registerClient({ client_name: 'Bad', redirect_uris: ['http://evil.example/cb'] });
    assert.ok(!bad.ok && bad.error.error === 'invalid_redirect_uri');
  });
});

describe('mcp: the tool registry', () => {
  it('covers every admin area with unique names, valid schemas and a permission on each tool', async () => {
    const { MCP_TOOLS, toolsByArea } = await import('../../src/lib/server/mcpTools');
    const { AREAS } = await import('../../src/components/ops/roles');
    const { z } = await import('zod');
    const names = MCP_TOOLS.map(t => t.name);
    assert.equal(new Set(names).size, names.length, 'tool names are unique');
    assert.ok(MCP_TOOLS.length >= 35, `expected a broad registry, got ${MCP_TOOLS.length}`);
    for (const t of MCP_TOOLS) {
      assert.ok(AREAS.includes(t.area), `${t.name}: area ${t.area}`);
      assert.ok(['view', 'edit', 'full'].includes(t.level), `${t.name}: level`);
      assert.ok(!t.write || t.level !== 'view', `${t.name}: a write tool needs at least edit`);
      if (t.schema) { const js = z.toJSONSchema(t.schema); assert.equal(js.type, 'object', `${t.name}: schema is an object`); }
    }
    const areas = toolsByArea().map(g => g.area);
    for (const a of ['overview', 'businesses', 'content', 'magazine', 'moderation', 'disputes', 'sponsored', 'clients', 'ai', 'settings', 'accounting', 'audit']) assert.ok(areas.includes(a as never), `area ${a} has tools`);
    for (const n of ['get_branch', 'update_branch_details', 'set_branch_treatments', 'update_page_seo', 'set_indexing', 'set_business_status', 'moderate_review', 'update_platform_settings', 'create_article', 'publish_article', 'upload_media', 'get_sitemap_urls']) assert.ok(names.includes(n), n);
  });
});

describe('mcp: write tools act as the token owner', { skip }, () => {
  let db: PrismaClient;
  const made = { users: [] as string[] };
  before(async () => { const { PrismaClient } = await import('@prisma/client'); db = new PrismaClient(); });
  after(async () => {
    await db.pageSeo.deleteMany({ where: { path: '/listing-standards/sponsorship' } });
    await db.auditLog.deleteMany({ where: { actorId: { in: made.users } } });
    await db.user.deleteMany({ where: { id: { in: made.users } } });
    await db.$disconnect();
  });

  it('update_page_seo runs the admin action under the actor context and the audit names that person', async () => {
    // Outside a Next request there is no cache store, so page refreshes become no-ops for this test.
    const { createRequire } = await import('node:module');
    const { join } = await import('node:path');
    const cache = createRequire(join(process.cwd(), 'package.json'))('next/cache') as { revalidatePath: unknown };
    cache.revalidatePath = () => undefined;
    const { withActor } = await import('../../src/lib/server/actorContext');
    const { MCP_TOOLS } = await import('../../src/lib/server/mcpTools');
    const user = await db.user.create({ data: { email: `mcp-write-${Date.now()}@example.test`, fullName: 'כותב', opsRole: 'ops' } });
    made.users.push(user.id);
    const tool = MCP_TOOLS.find(t => t.name === 'update_page_seo')!;
    const ctx = { proposals: [], source: 'mcp:claude', actor: { id: user.id, opsRole: 'ops' } };
    const r = (await withActor(user, () => tool.run({ path: '/listing-standards/sponsorship', title: 'כותרת מבדיקה', noindex: true }, ctx))) as { ok: boolean };
    assert.equal(r.ok, true, JSON.stringify(r));
    const row = await db.pageSeo.findUnique({ where: { path: '/listing-standards/sponsorship' } });
    assert.equal(row?.title, 'כותרת מבדיקה');
    assert.equal(row?.noindex, true);
    assert.equal(row?.updatedById, user.id);
    const audit = await db.auditLog.findFirst({ where: { actorId: user.id, action: 'seo_update' } });
    assert.ok(audit, 'the same audit row a person leaves');
    // a second patch keeps the fields it does not mention
    const r2 = (await withActor(user, () => tool.run({ path: '/listing-standards/sponsorship', noindex: false }, ctx))) as { ok: boolean };
    assert.equal(r2.ok, true);
    const row2 = await db.pageSeo.findUnique({ where: { path: '/listing-standards/sponsorship' } });
    assert.equal(row2?.title, 'כותרת מבדיקה');
    assert.equal(row2?.noindex, false);
    // without the actor context the action sees no staff member and refuses
    let refused = false;
    try { refused = ((await tool.run({ path: '/listing-standards/sponsorship', noindex: true }, ctx)) as { ok: boolean }).ok === false; } catch { refused = true; }
    assert.ok(refused, 'no actor, no write');
  });
});
