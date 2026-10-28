// Email monitoring (/ops/emails): per-email reply addresses, recipient linking, opens, clicks, replies and their
// forwarding, the Resend setup, and the numbers, against a loopback mock of Resend. Needs a local DATABASE_URL.

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';

const URL_OK = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const skip = URL_OK ? false : 'needs a local DATABASE_URL';
const KEY = 're_test_' + 't'.repeat(20);
const HOOK = 'whsec_' + Buffer.from('tracking-secret-tracking-secret').toString('base64');

interface Mock {
  url: string;
  server: Server;
  emails: Array<Record<string, unknown>>;
  calls: Array<{ method: string; url: string; body: Record<string, unknown> }>;
  received: Record<string, Record<string, unknown>>;
  domains: Array<Record<string, unknown>>;
  webhooks: Array<Record<string, unknown>>;
}

function startMock(): Promise<Mock> {
  const m: Mock = { url: '', server: null as unknown as Server, emails: [], calls: [], received: {}, domains: [], webhooks: [] };
  m.server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const url = req.url ?? '';
      m.calls.push({ method: req.method ?? '', url, body });
      const send = (status: number, j: object) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { message: 'bad key' });
      if (url === '/emails' && req.method === 'POST') { m.emails.push(body); return send(200, { id: `em-${m.emails.length}-${Date.now()}` }); }
      let r = url.match(/^\/emails\/receiving\/([^/]+)\/attachments$/);
      if (r) return send(200, { data: [{ id: 'a1', filename: 'menu.pdf', size: 2048, content_type: 'application/pdf', download_url: 'https://files.resend.test/menu.pdf' }] });
      r = url.match(/^\/emails\/receiving\/([^/]+)$/);
      if (r) return m.received[r[1]] ? send(200, m.received[r[1]]) : send(404, { message: 'not found' });
      if (url === '/domains' && req.method === 'GET') return send(200, { data: m.domains.map(d => ({ id: d.id, name: d.name, status: d.status })) });
      if (url === '/domains' && req.method === 'POST') {
        const d = { id: `dom-${m.domains.length + 1}`, name: body.name, status: 'not_started', capabilities: body.capabilities, records: [{ record: 'Receiving', name: 'reply', type: 'MX', value: 'inbound.resend.test', priority: 10, status: 'not_started' }, { record: 'DKIM', name: 'resend._domainkey.reply', type: 'TXT', value: 'p=abc', status: 'not_started' }] };
        m.domains.push(d);
        return send(200, d);
      }
      r = url.match(/^\/domains\/([^/]+)(\/verify)?$/);
      if (r) {
        const d = m.domains.find(x => x.id === r![1]);
        if (!d) return send(404, { message: 'no domain' });
        if (req.method === 'PATCH') {
          Object.assign(d, body);
          if (body.tracking_subdomain) (d.records as unknown[]).push({ record: 'Tracking', name: `${body.tracking_subdomain}.${d.name}`, type: 'CNAME', value: 'links1.resend-dns.com', status: 'not_started' });
          if (body.capabilities) d.capabilities = { ...(d.capabilities as object), ...body.capabilities };
        }
        return send(200, d);
      }
      if (url === '/webhooks' && req.method === 'GET') return send(200, { data: m.webhooks });
      if (url === '/webhooks' && req.method === 'POST') { const w = { id: `wh-${m.webhooks.length + 1}`, ...body, status: 'enabled' }; m.webhooks.push(w); return send(200, { id: w.id, signing_secret: HOOK }); }
      r = url.match(/^\/webhooks\/([^/]+)$/);
      if (r && req.method === 'PATCH') { const w = m.webhooks.find(x => x.id === r![1]); if (w) Object.assign(w, body); return send(200, { id: r[1] }); }
      send(404, { message: 'not found' });
    });
  });
  return new Promise(resolve => m.server.listen(0, '127.0.0.1', () => {
    const a = m.server.address();
    m.url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
    resolve(m);
  }));
}

describe('email monitoring', { skip }, () => {
  let db: PrismaClient;
  let mock: Mock;
  let settings: typeof import('../../src/lib/server/platformSettings');
  let saved: unknown;
  let staffId: string;
  let ownerId: string;
  let businessId: string;
  const tag = String(Date.now()).slice(-7);
  const ownerEmail = `owner-${tag}@example.test`;
  const keepSite = process.env.SITE_URL;

  const req = async (body: object, id = `msg_${Math.random().toString(36).slice(2)}`) => {
    const { POST } = await import('../../src/app/api/resend/webhook/route');
    const { svixSignature } = await import('../../src/lib/vendors/resend');
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    return POST(new Request('https://beautyfind.example/api/resend/webhook', { method: 'POST', headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${svixSignature(HOOK, id, ts, raw)}` }, body: raw }));
  };

  before(async () => {
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient();
    mock = await startMock();
    process.env.RESEND_TEST_BASE = mock.url;
    process.env.SITE_URL = 'https://beautyfind.example';
    for (const k of ['RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET']) delete process.env[k];
    settings = await import('../../src/lib/server/platformSettings');
    const email = await import('../../src/lib/server/email');
    staffId = (await db.user.create({ data: { email: `ops-${tag}@example.test`, fullName: 'צוות', opsRole: 'ops' } })).id;
    ownerId = (await db.user.create({ data: { email: ownerEmail, fullName: 'בעלת עסק' } })).id;
    businessId = (await db.business.create({ data: { legalName: `סלון מעקב ${tag}`, ownerUserId: ownerId } })).id;
    const cur = await settings.platformSettings();
    saved = cur.email;
    await settings.savePlatformSettings(staffId, { email: { ...cur.email, enabled: true, from: 'BeautyFind <noreply@beautyfind.co.il>', replyTo: 'hello@beautyfind.co.il', replyDomain: 'reply.beautyfind.co.il', forwardTo: 'hello@beautyfind.co.il' } });
    assert.equal((await email.saveResendKey(KEY, staffId)).ok, true);
    assert.equal((await email.saveResendWebhookSecret(HOOK, staffId)).ok, true);
  });

  after(async () => {
    await settings.savePlatformSettings(staffId, { email: saved as never }).catch(() => undefined);
    await db.emailReply.deleteMany({ where: { OR: [{ businessId }, { fromEmail: { contains: tag } }] } });
    await db.messageSend.deleteMany({ where: { OR: [{ businessId }, { toMasked: { contains: 'example.test' } }] } });
    await db.platformSecret.deleteMany({ where: { key: { in: ['resend_api_key', 'resend_webhook_secret'] } } });
    await db.auditLog.deleteMany({ where: { actorId: staffId } });
    await db.business.delete({ where: { id: businessId } }).catch(() => undefined);
    await db.user.deleteMany({ where: { id: { in: [staffId, ownerId] } } });
    delete process.env.RESEND_TEST_BASE;
    if (keepSite === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = keepSite;
    mock.server.close();
    await db.$disconnect();
  });

  it('each email gets its own reply address and is linked to the business it went to', async () => {
    const { messaging } = await import('../../src/lib/vendors/messaging');
    const r = await messaging().send({ channel: 'email', to: ownerEmail, template: 'M19_verification_outcome', vars: { business: 'סלון', status: 'approved', link: 'https://x.test' }, kind: 'service' });
    const sent = mock.emails.at(-1)!;
    assert.match(String(sent.reply_to), /^BeautyFind <r-[a-z0-9]{16}@reply\.beautyfind\.co\.il>$/);
    assert.deepEqual((sent.tags as Array<{ name: string }>)[0], { name: 'template', value: 'M19_verification_outcome' });
    const row = await db.messageSend.findFirst({ where: { providerId: r.id } });
    assert.equal(row?.audience, 'business');
    assert.equal(row?.businessId, businessId);
    assert.equal(row?.userId, ownerId);
    assert.ok(row?.replyToken && String(sent.reply_to).includes(row.replyToken));
    assert.ok(!row?.toMasked.includes(ownerEmail.split('@')[0]), 'address stays masked');
  });

  it('opens and clicks roll up once per event; the click keeps no query string', async () => {
    const row = await db.messageSend.findFirstOrThrow({ where: { businessId }, orderBy: { createdAt: 'desc' } });
    const id = row.providerId!;
    assert.equal((await req({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: id, message_id: '<orig-1@resend.test>' } })).status, 204);
    assert.equal((await req({ type: 'email.opened', created_at: new Date().toISOString(), data: { email_id: id } }, 'msg_open_1')).status, 204);
    assert.equal((await req({ type: 'email.opened', created_at: new Date().toISOString(), data: { email_id: id } }, 'msg_open_1')).status, 204, 'a retry');
    await req({ type: 'email.opened', created_at: new Date().toISOString(), data: { email_id: id } });
    await req({ type: 'email.clicked', created_at: new Date().toISOString(), data: { email_id: id, click: { link: 'https://beautyfind.co.il/login?view=reset&token=SECRET' } } });
    const r = await db.messageSend.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(r.deliveryStatus, 'delivered');
    assert.equal(r.messageId, '<orig-1@resend.test>');
    assert.equal(r.openCount, 2);
    assert.ok(r.openedAt);
    assert.equal(r.clickCount, 1);
    assert.equal(r.lastClickUrl, 'https://beautyfind.co.il/login');
    const events = await db.emailEvent.findMany({ where: { sendId: row.id } });
    assert.equal(events.length, 4);
    assert.ok(!events.some(e => e.link?.includes('SECRET')));
  });

  it('a reply is matched by its token, stored as text, counted, and forwarded to the team with the sender as reply-to', async () => {
    const row = await db.messageSend.findFirstOrThrow({ where: { businessId }, orderBy: { createdAt: 'desc' } });
    const rid = `rcv-${tag}`;
    mock.received[rid] = { id: rid, from: `Dana Salon <${ownerEmail}>`, to: [`r-${row.replyToken}@reply.beautyfind.co.il`], subject: 'Re: האימות', text: 'תודה רבה, קיבלתי.\n\nOn Tue, BeautyFind wrote:\n> שלום', html: '<p>תודה רבה, קיבלתי.</p>', headers: {} };
    const before = mock.emails.length;
    assert.equal((await req({ type: 'email.received', created_at: new Date().toISOString(), data: { email_id: rid, from: ownerEmail, to: [`r-${row.replyToken}@reply.beautyfind.co.il`] } })).status, 204);
    const reply = await db.emailReply.findUniqueOrThrow({ where: { resendId: rid } });
    assert.equal(reply.sendId, row.id);
    assert.equal(reply.businessId, businessId);
    assert.equal(reply.fromName, 'Dana Salon');
    assert.match(reply.text ?? '', /תודה רבה/);
    assert.ok(reply.forwardedAt);
    const fwd = mock.emails[before];
    assert.deepEqual(fwd.to, ['hello@beautyfind.co.il']);
    assert.equal(fwd.reply_to, ownerEmail);
    assert.match(String(fwd.from), /Dana Salon דרך BeautyFind <noreply@beautyfind\.co\.il>/);
    assert.deepEqual(fwd.attachments, [{ filename: 'menu.pdf', path: 'https://files.resend.test/menu.pdf' }]);
    const r = await db.messageSend.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(r.replyCount, 1);
    assert.ok(r.repliedAt);

    // The same reply delivered again is ignored.
    await req({ type: 'email.received', data: { email_id: rid, to: [] } });
    assert.equal(await db.emailReply.count({ where: { resendId: rid } }), 1);
    assert.equal(mock.emails.length, before + 1);

    const { replyOnly } = await import('../../src/lib/server/emailRecipients');
    assert.equal(replyOnly(reply.text!), 'תודה רבה, קיבלתי.');
  });

  it('a reply without a token is matched by In-Reply-To', async () => {
    const row = await db.messageSend.findFirstOrThrow({ where: { businessId }, orderBy: { createdAt: 'desc' } });
    const rid = `rcv2-${tag}`;
    mock.received[rid] = { id: rid, from: ownerEmail, to: ['hello@reply.beautyfind.co.il'], subject: 'Re', text: 'עוד שאלה', headers: { 'In-Reply-To': '<orig-1@resend.test>' } };
    await req({ type: 'email.received', data: { email_id: rid, to: ['hello@reply.beautyfind.co.il'] } });
    const reply = await db.emailReply.findUniqueOrThrow({ where: { resendId: rid } });
    assert.equal(reply.sendId, row.id);
  });

  it('numbers: totals and per template', async () => {
    const t = await import('../../src/lib/server/emailTracking');
    const totals = await t.emailTotals(1, { businessId });
    assert.equal(totals.sent, 1);
    assert.equal(totals.delivered, 1);
    assert.equal(totals.opened, 1);
    assert.equal(totals.clicked, 1);
    assert.equal(totals.replied, 1);
    const by = await t.emailBy('template', 1);
    assert.ok(by.some(r => r.key === 'M19_verification_outcome' && r.replied >= 1));
    assert.equal(t.emailState({ status: 'sent', deliveryStatus: 'delivered', openedAt: new Date(), clickedAt: null, repliedAt: new Date() }).label, 'ענו');
  });

  it('setup turns on tracking, creates the reply domain and subscribes the webhook to every event', async () => {
    const t = await import('../../src/lib/server/emailTracking');
    mock.domains = [{ id: 'dom-main', name: 'beautyfind.co.il', status: 'verified', open_tracking: false, click_tracking: false, capabilities: { sending: 'enabled', receiving: 'disabled' }, records: [{ record: 'DKIM', name: 'resend._domainkey', type: 'TXT', value: 'p=x', status: 'verified' }] }];
    mock.webhooks = [{ id: 'wh-old', endpoint: 'https://beautyfind.example/api/resend/webhook', events: ['email.delivered', 'email.bounced'], status: 'enabled' }];
    const r = await t.setupEmailTracking(staffId);
    assert.ok(mock.calls.some(c => c.method === 'PATCH' && c.url === '/domains/dom-main' && c.body.open_tracking === true && c.body.click_tracking === true && c.body.tracking_subdomain === 'links'));
    const created = mock.calls.find(c => c.method === 'POST' && c.url === '/domains');
    assert.deepEqual(created?.body, { name: 'reply.beautyfind.co.il', capabilities: { sending: 'disabled', receiving: 'enabled' } });
    const hook = mock.webhooks[0];
    for (const e of t.WEBHOOK_EVENTS) assert.ok((hook.events as string[]).includes(e), e);
    assert.ok(r.dns.some(d => d.type === 'MX' && d.value === 'inbound.resend.test'));
    assert.ok(r.dns.some(d => d.type === 'CNAME' && d.value === 'links1.resend-dns.com'));
    assert.equal(r.ok, false, 'DNS not verified yet');

    // Once the records verify, the run is clean and nothing is created twice.
    for (const d of mock.domains) for (const rec of d.records as Array<{ status: string }>) rec.status = 'verified';
    const again = await t.setupEmailTracking(staffId);
    assert.equal(again.ok, true, JSON.stringify(again.steps));
    assert.equal(mock.calls.filter(c => c.method === 'POST' && c.url === '/domains').length, 1);
  });
});
