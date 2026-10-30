// Messaggio (src/lib/vendors/messaggio.ts, src/lib/server/messaggio.ts): request shape, phone handling, and the
// verification-code flow end to end through sendOtp against a loopback mock of Messaggio's send endpoint.
// The DB part needs a local DATABASE_URL.

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';

const URL_OK = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const skip = URL_OK ? false : 'needs a local DATABASE_URL';
const CFG = { login: 'test-login-123', baseUrl: 'https://msg.example.test/api/v1', smsSender: 'BeautyFind', whatsappSender: 'wa-sender-1', whatsappTemplate: '' };

describe('messaggio: request shape', () => {
  it('phones go as international digits; masks keep only the ends', async () => {
    const m = await import('../../src/lib/vendors/messaggio');
    assert.equal(m.messaggioPhone('+972 54-123-4567'), '972541234567');
    assert.equal(m.messaggioPhone('hello'), null);
    assert.equal(m.messaggioPhone('+12'), null);
    assert.equal(m.maskPhone('+972541234567'), '+97254•••4567');
  });

  it('builds the SMS and WhatsApp bodies', async () => {
    const m = await import('../../src/lib/vendors/messaggio');
    assert.deepEqual(m.messaggioBody(CFG, 'sms', '972541234567', 'hi'), { recipients: [{ phone: '972541234567' }], channels: ['sms'], sms: { from: 'BeautyFind', content: [{ type: 'text', text: 'hi' }] } });
    assert.deepEqual(m.messaggioBody(CFG, 'whatsapp', '972541234567', 'hi'), { recipients: [{ phone: '972541234567' }], channels: ['whatsapp'], whatsapp: { from: 'wa-sender-1', content: [{ type: 'text', text: 'hi' }] } });
    const t = m.messaggioBody({ ...CFG, whatsappTemplate: 'auth_code' }, 'whatsapp', '972541234567', 'hi', { code: '123456' }) as { whatsapp: { content: unknown[] } };
    assert.deepEqual(t.whatsapp.content, [{ type: 'template', template: { name: 'auth_code', params: ['123456'] } }]);
  });
});

interface Mock { url: string; calls: Array<{ login: string | undefined; body: { recipients: Array<{ phone: string }>; channels: string[]; sms?: { from: string; content: Array<{ text: string }> }; whatsapp?: unknown } }>; failWhatsapp: number | null; failAll: number | null; server: Server }

function startMock(): Promise<Mock> {
  const m: Mock = { url: '', calls: [], failWhatsapp: null, failAll: null, server: null as unknown as Server };
  m.server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const send = (status: number, j: object) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.method !== 'POST' || req.url !== '/api/v1/send') return send(404, { detail: 'not found' });
      const body = JSON.parse(raw || '{}') as Mock['calls'][number]['body'];
      m.calls.push({ login: req.headers['messaggio-login'] as string | undefined, body });
      if (m.failAll) return send(m.failAll, { detail: 'Invalid login' });
      if (m.failWhatsapp && body.channels[0] === 'whatsapp') return send(m.failWhatsapp, { detail: 'WhatsApp sender is not active' });
      send(200, { messages: [{ recipient: body.recipients[0], message_uid: `uid-${m.calls.length}` }] });
    });
  });
  return new Promise(resolve => m.server.listen(0, '127.0.0.1', () => {
    const a = m.server.address();
    m.url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
    resolve(m);
  }));
}

describe('messaggio: verification codes through sendOtp', { skip }, () => {
  let db: PrismaClient;
  let mock: Mock;
  let settings: typeof import('../../src/lib/server/platformSettings');
  let svc: typeof import('../../src/lib/server/messaggio');
  let otp: typeof import('../../src/lib/server/otp');
  let userId: string;
  let before0: Awaited<ReturnType<typeof import('../../src/lib/server/platformSettings')['platformSettings']>>['messaggio'];
  const stamp = String(Date.now()).slice(-7);
  const phone = (n: number) => `+97254${stamp.slice(-6)}${n}`;

  before(async () => {
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient();
    mock = await startMock();
    settings = await import('../../src/lib/server/platformSettings');
    svc = await import('../../src/lib/server/messaggio');
    otp = await import('../../src/lib/server/otp');
    const u = await db.user.create({ data: { email: `mg-${Date.now()}@example.test`, fullName: 'מסג׳יו', opsRole: 'ops' } });
    userId = u.id;
    before0 = (await settings.platformSettings()).messaggio;
    delete process.env.MESSAGGIO_LOGIN;
    await db.messageSend.deleteMany({});
  });

  after(async () => {
    await settings.savePlatformSettings(userId, { messaggio: before0 }).catch(() => undefined);
    await db.platformSecret.deleteMany({ where: { key: 'messaggio_login' } });
    await db.messageSend.deleteMany({});
    await db.otpCode.deleteMany({ where: { target: { startsWith: `+97254${stamp.slice(-6)}` } } });
    await db.auditLog.deleteMany({ where: { actorId: userId } });
    await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    mock.server.close();
    await db.$disconnect();
  });

  it('while off or without a key, codes go to the default adapter and Messaggio is not called', async () => {
    await settings.savePlatformSettings(userId, { messaggio: { ...before0, enabled: true, baseUrl: `${mock.url}/api/v1` } });
    const r = await otp.sendOtp({ target: phone(1), channel: 'sms', purpose: 'login' });
    assert.equal(r.ok, true);
    assert.equal(mock.calls.length, 0, 'no key: not called');
    const saved = await svc.saveMessaggioLogin('test-login-123', userId);
    assert.deepEqual(saved, { ok: true, hint: '•••-123' });
    await settings.savePlatformSettings(userId, { messaggio: { ...before0, enabled: false, baseUrl: `${mock.url}/api/v1` } });
    await otp.sendOtp({ target: phone(2), channel: 'sms', purpose: 'login' });
    assert.equal(mock.calls.length, 0, 'switched off: not called');
  });

  it('the key is stored encrypted; a bad key is refused', async () => {
    assert.equal((await svc.saveMessaggioLogin('short', userId)).ok, false);
    assert.equal((await svc.saveMessaggioLogin('has space inside', userId)).ok, false);
    const row = await db.platformSecret.findUnique({ where: { key: 'messaggio_login' } });
    assert.ok(row?.valueEnc.startsWith('v2.'));
    assert.ok(!row?.valueEnc.includes('test-login-123'));
    assert.equal((await svc.messaggioLogin())?.login, 'test-login-123');
  });

  it('a login code by SMS goes to Messaggio with the key, the sender and the code, and is logged masked', async () => {
    await settings.savePlatformSettings(userId, { messaggio: { ...before0, enabled: true, sms: true, whatsapp: true, smsSender: 'BeautyFind', whatsappSender: 'wa-sender-1', fallbackToSms: true, baseUrl: `${mock.url}/api/v1` } });
    const r = await otp.sendOtp({ target: phone(3), channel: 'sms', purpose: 'login' });
    assert.equal(r.ok, true);
    assert.equal(mock.calls.length, 1);
    const c = mock.calls[0];
    assert.equal(c.login, 'test-login-123');
    assert.deepEqual(c.body.channels, ['sms']);
    assert.equal(c.body.recipients[0].phone, phone(3).slice(1));
    assert.equal(c.body.sms?.from, 'BeautyFind');
    const text = c.body.sms?.content[0].text ?? '';
    assert.match(text, /קוד האימות שלך ב-BeautyFind: \d{6}\./);
    const row = await db.messageSend.findFirst({ orderBy: { createdAt: 'desc' } });
    assert.equal(row?.status, 'sent');
    assert.equal(row?.providerId, 'uid-1');
    assert.ok(!row?.toMasked.includes(phone(3).slice(6, 9)), 'the middle digits are hidden');
    assert.ok(!JSON.stringify(row).includes(text.match(/\d{6}/)![0]), 'the code is not stored');
  });

  it('a refused WhatsApp send falls back to SMS once', async () => {
    mock.failWhatsapp = 400;
    const r = await otp.sendOtp({ target: phone(4), channel: 'whatsapp', purpose: 'login' });
    assert.equal(r.ok, true);
    assert.deepEqual(mock.calls.slice(-2).map(c => c.body.channels[0]), ['whatsapp', 'sms']);
    const rows = await db.messageSend.findMany({ orderBy: { createdAt: 'desc' }, take: 2 });
    assert.equal(rows[1].status, 'failed');
    assert.match(rows[1].error ?? '', /WhatsApp sender is not active/);
    assert.equal(rows[0].status, 'sent');
    assert.equal(rows[0].fallbackFrom, 'whatsapp');
    mock.failWhatsapp = null;
  });

  it('a rejected key fails the send, is not retried on SMS, and the code is dropped so the person can ask again', async () => {
    mock.failAll = 401;
    const calls = mock.calls.length;
    await assert.rejects(otp.sendOtp({ target: phone(5), channel: 'whatsapp', purpose: 'login' }), /HTTP 401: Invalid login/);
    assert.equal(mock.calls.length, calls + 1, 'no SMS retry after 401');
    assert.equal(await db.otpCode.count({ where: { target: phone(5) } }), 0);
    mock.failAll = null;
    const again = await otp.sendOtp({ target: phone(5), channel: 'whatsapp', purpose: 'login' });
    assert.equal(again.ok, true, 'no cooldown after a failed send');
  });

  it('other messages keep the default adapter', async () => {
    const { messaging } = await import('../../src/lib/vendors/messaging');
    const calls = mock.calls.length;
    await messaging().send({ channel: 'whatsapp', to: phone(6), template: 'M1_booking_confirmed', vars: {}, kind: 'service' });
    assert.equal(mock.calls.length, calls);
  });

  it('the admin test send works even with the switches off, and is marked as a test', async () => {
    await settings.savePlatformSettings(userId, { messaggio: { ...before0, enabled: false, baseUrl: `${mock.url}/api/v1`, whatsappSender: 'wa-sender-1' } });
    const r = await svc.messaggioTestSend(phone(7), 'sms');
    assert.equal(r.ok, true);
    assert.match(mock.calls.at(-1)!.body.sms!.content[0].text, /הודעת בדיקה/);
    const row = await db.messageSend.findFirst({ orderBy: { createdAt: 'desc' } });
    assert.equal(row?.test, true);
    const st = await svc.messaggioStatus();
    assert.equal(st.configured, true);
    assert.equal(st.keySource, 'admin');
    assert.ok(st.sent24h >= 3);
  });
});
