// Google indexing (src/lib/server/googleIndexing.ts): credentials parsing, inspection mapping, and a full run
// against a loopback mock of Google's token, URL Inspection and Indexing API endpoints. The mock checks the
// service-account JWT signature, so a wrong signing setup fails here. Needs a local DATABASE_URL for the run.

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';

const URL_OK = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const skip = URL_OK ? false : 'needs a local DATABASE_URL';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const KEY_JSON = JSON.stringify({ type: 'service_account', client_email: 'indexer@beautyfind-test.iam.gserviceaccount.com', private_key: privateKey });

describe('google indexing: credentials and inspection results', () => {
  it('reads the service account from raw or base64 JSON and rejects anything else', async () => {
    const g = await import('../../src/lib/server/googleIndexing');
    assert.equal(g.serviceAccount(KEY_JSON)?.clientEmail, 'indexer@beautyfind-test.iam.gserviceaccount.com');
    assert.equal(g.serviceAccount(Buffer.from(KEY_JSON).toString('base64'))?.clientEmail, 'indexer@beautyfind-test.iam.gserviceaccount.com');
    const escaped = JSON.stringify({ client_email: 'a@b.c', private_key: privateKey.replace(/\n/g, '\\n') }).replace(/\\\\n/g, '\\\\n');
    assert.ok(g.serviceAccount(escaped)?.privateKey.includes('\n'), 'escaped newlines in the key are restored');
    for (const bad of ['', '   ', 'not json', '{"client_email":"a@b.c"}', JSON.stringify({ client_email: 'a@b.c', private_key: 'nope' })]) assert.equal(g.serviceAccount(bad), null, bad);
    assert.equal(g.serviceAccount(undefined), null);
  });

  it('only a PASS verdict counts as indexed', async () => {
    const g = await import('../../src/lib/server/googleIndexing');
    const pass = g.inspectionState({ inspectionResult: { indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed', lastCrawlTime: '2026-10-01T10:00:00Z' } } });
    assert.deepEqual(pass, { indexed: true, verdict: 'PASS', coverageState: 'Submitted and indexed', lastCrawlAt: new Date('2026-10-01T10:00:00Z') });
    assert.equal(g.inspectionState({ inspectionResult: { indexStatusResult: { verdict: 'NEUTRAL', coverageState: 'URL is unknown to Google' } } }).indexed, false);
    assert.equal(g.inspectionState({}).indexed, false);
    assert.equal(g.inspectionState({ inspectionResult: { indexStatusResult: { verdict: 'PASS', lastCrawlTime: 'garbage' } } }).lastCrawlAt, null);
  });
});

interface Mock { url: string; published: string[]; inspected: string[]; tokens: number; quotaAfter: number | null; server: Server }

function startMock(indexedUrls: (u: string) => boolean): Promise<Mock> {
  const m: Mock = { url: '', published: [], inspected: [], tokens: 0, quotaAfter: null, server: null as unknown as Server };
  m.server = createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const send = (status: number, j: object) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.url === '/token') {
        const assertion = new URLSearchParams(body).get('assertion') ?? '';
        const [h, c, sig] = assertion.split('.');
        const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig ?? '', 'base64url'));
        const claims = JSON.parse(Buffer.from(c ?? '', 'base64url').toString() || '{}') as { scope?: string };
        if (!ok || !claims.scope?.includes('auth/indexing')) return send(400, { error: 'invalid_grant' });
        m.tokens++;
        return send(200, { access_token: 'tok-1', expires_in: 3600 });
      }
      if (req.headers.authorization !== 'Bearer tok-1') return send(401, { error: { message: 'unauthenticated' } });
      const j = JSON.parse(body || '{}') as { url?: string; inspectionUrl?: string; type?: string };
      if (req.url === '/v1/urlInspection/index:inspect') {
        m.inspected.push(j.inspectionUrl!);
        const yes = indexedUrls(j.inspectionUrl!);
        return send(200, { inspectionResult: { indexStatusResult: yes ? { verdict: 'PASS', coverageState: 'Submitted and indexed', lastCrawlTime: '2026-10-01T10:00:00Z' } : { verdict: 'NEUTRAL', coverageState: 'URL is unknown to Google' } } });
      }
      if (req.url === '/v3/urlNotifications:publish') {
        if (m.quotaAfter !== null && m.published.length >= m.quotaAfter) return send(429, { error: { message: 'Quota exceeded for quota metric' } });
        assert.equal(j.type, 'URL_UPDATED');
        m.published.push(j.url!);
        return send(200, { urlNotificationMetadata: { url: j.url } });
      }
      send(404, { error: { message: 'not found' } });
    });
  });
  return new Promise(resolve => m.server.listen(0, '127.0.0.1', () => {
    const a = m.server.address();
    m.url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
    resolve(m);
  }));
}

describe('google indexing: a run against a mock Google', { skip }, () => {
  let db: PrismaClient;
  let g: typeof import('../../src/lib/server/googleIndexing');
  let settings: typeof import('../../src/lib/server/platformSettings');
  let mock: Mock;
  let userId: string;
  let before0: Awaited<ReturnType<typeof import('../../src/lib/server/platformSettings')['platformSettings']>>['googleIndexing'];
  let home = '';

  before(async () => {
    const { createRequire } = await import('node:module');
    const { join } = await import('node:path');
    const cache = createRequire(join(process.cwd(), 'package.json'))('next/cache') as { revalidatePath: unknown };
    cache.revalidatePath = () => undefined;
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient();
    g = await import('../../src/lib/server/googleIndexing');
    settings = await import('../../src/lib/server/platformSettings');
    const { siteUrl } = await import('../../src/lib/server/site');
    home = `${siteUrl().replace(/\/+$/, '')}/`;
    mock = await startMock(u => u === home);
    process.env.GOOGLE_API_TEST_BASE = mock.url;
    process.env.GOOGLE_INDEXING_CREDENTIALS = Buffer.from(KEY_JSON).toString('base64');
    const u = await db.user.create({ data: { email: `idx-${Date.now()}@example.test`, fullName: 'אינדוקס', opsRole: 'ops' } });
    userId = u.id;
    before0 = (await settings.platformSettings()).googleIndexing;
    await db.indexingUrl.deleteMany({});
    await db.indexingRun.deleteMany({});
  });

  after(async () => {
    await settings.savePlatformSettings(userId, { googleIndexing: before0 }).catch(() => undefined);
    await db.indexingUrl.deleteMany({});
    await db.indexingRun.deleteMany({});
    await db.auditLog.deleteMany({ where: { actorId: userId } });
    await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    delete process.env.GOOGLE_API_TEST_BASE;
    delete process.env.GOOGLE_INDEXING_CREDENTIALS;
    mock.server.close();
    await db.$disconnect();
  });

  it('does nothing while switched off', async () => {
    await settings.savePlatformSettings(userId, { googleIndexing: { ...before0, enabled: false } });
    const r = await g.runGoogleIndexing({ trigger: 'manual' });
    assert.equal(r.skipped, 'disabled');
    assert.equal(await db.indexingUrl.count(), 0);
    assert.equal(mock.tokens, 0);
  });

  it('first run: syncs the sitemap as existing pages, inspects them and sends only not-indexed ones within the quota', async () => {
    await settings.savePlatformSettings(userId, { googleIndexing: { ...before0, enabled: true, submitNew: true, submitBacklog: true, inspect: true, dailySubmitLimit: 5, dailyInspectLimit: 2000, property: '' } });
    const r = await g.runGoogleIndexing({ trigger: 'manual', actorId: userId });
    assert.equal(r.ok, true, r.note ?? "run failed");
    const total = await db.indexingUrl.count();
    assert.ok(total > 10, `sitemap synced (${total})`);
    assert.equal(r.discovered, total);
    assert.equal(await db.indexingUrl.count({ where: { isNew: true } }), 0, 'the first sync marks nothing as new');
    assert.equal(r.inspected, total);
    assert.equal(r.submitted, 5);
    assert.equal(mock.published.length, 5);
    assert.ok(!mock.published.includes(home), 'an indexed page is never sent');
    const h = await db.indexingUrl.findUnique({ where: { url: home } });
    assert.equal(h?.indexed, true);
    assert.equal(h?.coverageState, 'Submitted and indexed');
    const run = await db.indexingRun.findUnique({ where: { id: r.runId! } });
    assert.equal(run?.submitted, 5);
    assert.ok(run?.finishedAt);
  });

  it('a page that appears later is new and goes first; nothing is inspected twice in a week', async () => {
    const victim = await db.indexingUrl.findFirst({ where: { indexed: false, submitCount: 0, url: { not: home } }, orderBy: { url: 'asc' } });
    assert.ok(victim);
    await db.indexingUrl.delete({ where: { id: victim.id } }); // as if the page had just been added to the sitemap
    const cur = (await settings.platformSettings()).googleIndexing;
    await settings.savePlatformSettings(userId, { googleIndexing: { ...cur, dailySubmitLimit: 6 } }); // one more today
    const inspectedBefore = mock.inspected.length;
    const r = await g.runGoogleIndexing({ trigger: 'cron' });
    assert.equal(r.discovered, 1);
    assert.equal(r.inspected, 1, 'only the new page is inspected');
    assert.equal(mock.inspected.length, inspectedBefore + 1);
    assert.equal(r.submitted, 1);
    assert.equal(mock.published.at(-1), victim.url, 'the new page takes the one free slot');
    const row = await db.indexingUrl.findUnique({ where: { url: victim.url } });
    assert.equal(row?.isNew, true);
    assert.equal(row?.submitCount, 1);
  });

  it('stops at the daily quota without sending more', async () => {
    const r = await g.runGoogleIndexing({ trigger: 'cron' });
    assert.equal(r.submitted, 0);
    assert.equal(mock.published.length, 6);
  });

  it('stops sending when Google answers 429 and records the error', async () => {
    const cur = (await settings.platformSettings()).googleIndexing;
    await settings.savePlatformSettings(userId, { googleIndexing: { ...cur, dailySubmitLimit: 50 } });
    mock.quotaAfter = 8;
    const r = await g.runGoogleIndexing({ trigger: 'cron' });
    assert.equal(r.submitted, 2);
    assert.equal(r.errors, 1);
    assert.match(r.note ?? '', /quota/);
    assert.equal(await db.indexingUrl.count({ where: { lastSubmitError: { contains: 'Quota' } } }), 1);
    mock.quotaAfter = null;
  });

  it('known not-indexed URLs are sent before inspection, even with no inspection quota left', async () => {
    const cur = (await settings.platformSettings()).googleIndexing;
    const sentToday = await db.indexingUrl.count({ where: { lastSubmittedAt: { gte: new Date(Date.now() - 86_400_000) } } });
    await settings.savePlatformSettings(userId, { googleIndexing: { ...cur, dailySubmitLimit: sentToday + 3, dailyInspectLimit: 0 } });
    const inspectedBefore = mock.inspected.length;
    const sent = mock.published.length;
    const r = await g.runGoogleIndexing({ trigger: 'cron' });
    assert.equal(r.inspected, 0);
    assert.equal(mock.inspected.length, inspectedBefore);
    assert.equal(r.submitted, 3, r.note ?? '');
    for (const u of mock.published.slice(sent)) assert.notEqual(u, home);
    await settings.savePlatformSettings(userId, { googleIndexing: { ...cur } });
  });

  it('a publish run is limited to the given paths', async () => {
    const pick = await db.indexingUrl.findFirst({ where: { indexed: false, submitCount: 0 }, orderBy: { url: 'desc' } });
    assert.ok(pick);
    const sent = mock.published.length;
    const r = await g.runGoogleIndexing({ trigger: 'publish', paths: [pick.path, '/no/such/page'] });
    assert.equal(r.inspected, 0, 'a publish run does not inspect');
    assert.equal(r.submitted, 1);
    assert.deepEqual(mock.published.slice(sent), [pick.url]);
  });

  it('pages that leave the sitemap are marked removed and never sent', async () => {
    const extra = await db.indexingUrl.create({ data: { url: 'https://example.test/gone', path: '/gone', type: 'content', isNew: true } });
    await g.runGoogleIndexing({ trigger: 'cron' });
    const row = await db.indexingUrl.findUnique({ where: { id: extra.id } });
    assert.ok(row?.removedAt);
    assert.ok(!mock.published.includes('https://example.test/gone'));
  });

  it('reports a missing key as not configured', async () => {
    const keep = process.env.GOOGLE_INDEXING_CREDENTIALS;
    delete process.env.GOOGLE_INDEXING_CREDENTIALS;
    const r = await g.runGoogleIndexing({ trigger: 'cron' });
    assert.equal(r.skipped, 'not_configured');
    assert.equal(r.ok, false);
    const st = await g.googleIndexingStatus();
    assert.equal(st.configured, false);
    process.env.GOOGLE_INDEXING_CREDENTIALS = keep;
    assert.equal((await g.googleIndexingStatus()).clientEmail, 'indexer@beautyfind-test.iam.gserviceaccount.com');
  });

  it('a key uploaded in the admin is stored encrypted, used for runs, and can be removed', async () => {
    const keep = process.env.GOOGLE_INDEXING_CREDENTIALS;
    delete process.env.GOOGLE_INDEXING_CREDENTIALS;
    try {
      for (const bad of ['', 'not json', JSON.stringify({ client_email: 'a@b.c', private_key: '-----BEGIN PRIVATE KEY-----\nbroken\n-----END PRIVATE KEY-----' })]) {
        assert.equal((await g.saveServiceAccountKey(bad, userId)).ok, false, bad);
      }
      const r = await g.saveServiceAccountKey(KEY_JSON, userId);
      assert.deepEqual(r, { ok: true, clientEmail: 'indexer@beautyfind-test.iam.gserviceaccount.com' });
      const row = await db.platformSecret.findUnique({ where: { key: 'google_indexing_credentials' } });
      assert.ok(row?.valueEnc.startsWith('v1.'), 'sealed with DATA_KEY');
      assert.ok(!row?.valueEnc.includes('PRIVATE KEY') && !row?.valueEnc.includes('indexer@'), 'nothing readable in the column');
      assert.equal(row?.label, 'indexer@beautyfind-test.iam.gserviceaccount.com');
      const st = await g.googleIndexingStatus();
      assert.equal(st.configured, true);
      assert.equal(st.keySource, 'admin');
      const tokens = mock.tokens;
      const run = await g.runGoogleIndexing({ trigger: 'manual' });
      assert.equal(run.skipped, undefined);
      assert.ok(mock.tokens >= tokens, 'the run authenticated with the stored key');
      process.env.GOOGLE_INDEXING_CREDENTIALS = keep;
      assert.equal((await g.googleIndexingStatus()).keySource, 'env', 'the Vercel variable wins when both exist');
      delete process.env.GOOGLE_INDEXING_CREDENTIALS;
      await g.removeServiceAccountKey();
      assert.equal((await g.googleIndexingStatus()).configured, false);
    } finally {
      process.env.GOOGLE_INDEXING_CREDENTIALS = keep;
      await db.platformSecret.deleteMany({ where: { key: 'google_indexing_credentials' } });
    }
  });
});
