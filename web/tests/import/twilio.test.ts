// Twilio SMS for verification codes (src/lib/vendors/twilio.ts, src/lib/server/twilio.ts, verificationSend.ts):
// request shape, webhook signatures, and the code flow end to end through sendOtp against a loopback mock of
// Twilio's Messages and Account endpoints (and Messaggio's send, for the WhatsApp fallback). Needs a local DB.

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';

const URL_OK = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const skip = URL_OK ? false : 'needs a local DATABASE_URL';
const SID = 'AC' + 'a1'.repeat(16);
const TOKEN = 'b2'.repeat(16);

describe('twilio: request shape and signatures', () => {
  it('validates SIDs and senders', async () => {
    const t = await import('../../src/lib/vendors/twilio');
    assert.equal(t.isAccountSid(SID), true);
    assert.equal(t.isAccountSid('AC123'), false);
    assert.equal(t.isServiceSid('MG' + '0'.repeat(32)), true);
    for (const ok of ['+972541234567', 'BeautyFind', 'Beauty Find']) assert.equal(t.isSender(ok), true, ok);
    for (const bad of ['0541234567', '12345678901', 'BeautyFindIL1', 'בי']) assert.equal(t.isSender(bad), false, bad);
  });

  it('builds the form: From, or a Messaging Service that wins over it, and the status callback', async () => {
    const t = await import('../../src/lib/vendors/twilio');
    const c = { accountSid: SID, authToken: TOKEN, from: 'BeautyFind', messagingServiceSid: '', statusCallback: 'https://beautyfind.co.il/api/twilio/status' };
    assert.deepEqual(Object.fromEntries(t.twilioForm(c, '+972541234567', 'hi')), { To: '+972541234567', Body: 'hi', From: 'BeautyFind', StatusCallback: 'https://beautyfind.co.il/api/twilio/status' });
    const mg = Object.fromEntries(t.twilioForm({ ...c, messagingServiceSid: 'MG' + '0'.repeat(32), statusCallback: undefined }, '+972541234567', 'hi'));
    assert.equal(mg.MessagingServiceSid, 'MG' + '0'.repeat(32));
    assert.equal(mg.From, undefined);
  });

  it('builds the voice call: the code digit by digit, twice, in Hebrew, with XML escaped', async () => {
    const t = await import('../../src/lib/vendors/twilio');
    assert.equal(t.spokenDigits('482915'), '4, 8, 2, 9, 1, 5');
    const x = t.voiceTwiml('482915', 'Google.he-IL-Standard-A');
    assert.match(x, /^<Response>.*<\/Response>$/);
    assert.equal(x.match(/4, 8, 2, 9, 1, 5/g)?.length, 2);
    assert.match(x, /<Say voice="Google.he-IL-Standard-A" language="he-IL">/);
    assert.ok(!t.voiceTwiml('1', 'a"b<c').includes('a"b<c'), 'the voice name is escaped');
    const c = { accountSid: SID, authToken: TOKEN, from: 'BeautyFind', messagingServiceSid: '', voiceFrom: '+97233721234', statusCallback: 'https://beautyfind.co.il/api/twilio/status' };
    assert.deepEqual(Object.fromEntries(t.twilioCallForm(c, '+972541234567', x)), { To: '+972541234567', From: '+97233721234', Twiml: x, StatusCallback: 'https://beautyfind.co.il/api/twilio/status' });
  });

  it('computes the webhook signature as Twilio documents it', async () => {
    const t = await import('../../src/lib/vendors/twilio');
    // The worked example from Twilio's webhook security documentation.
    const params = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    assert.equal(t.twilioSignature('12345', url, params), '0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
    assert.equal(t.validTwilioSignature('12345', url, params, '0/KCTR6DLpKmkAf8muzZqo1nDgQ='), true);
    assert.equal(t.validTwilioSignature('12345', url, { ...params, Digits: '9' }, '0/KCTR6DLpKmkAf8muzZqo1nDgQ='), false);
    assert.equal(t.validTwilioSignature('12345', url, params, null), false);
  });
});

interface Sent { auth: string | undefined; form: Record<string, string> }
interface Mock { url: string; sms: Sent[]; calls: Sent[]; mg: Array<{ channels: string[] }>; twilioFail: { status: number; code: number; message: string } | null; mgFailWhatsapp: boolean; server: Server }

function startMock(): Promise<Mock> {
  const m: Mock = { url: '', sms: [], calls: [], mg: [], twilioFail: null, mgFailWhatsapp: false, server: null as unknown as Server };
  const basic = `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`;
  m.server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const send = (status: number, j: object) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.url === '/api/v1/send') {
        const b = JSON.parse(raw) as { channels: string[] };
        m.mg.push(b);
        if (m.mgFailWhatsapp && b.channels[0] === 'whatsapp') return send(400, { detail: 'WhatsApp sender is not active' });
        return send(200, { messages: [{ message_uid: `mg-${m.mg.length}` }] });
      }
      if (req.headers.authorization !== basic) return send(401, { code: 20003, message: 'Authenticate', status: 401 });
      if (req.method === 'GET' && req.url === `/2010-04-01/Accounts/${SID}.json`) return send(200, { sid: SID, friendly_name: 'BeautyFind', status: 'active', type: 'Full' });
      if (req.method === 'POST' && req.url === `/2010-04-01/Accounts/${SID}/Messages.json`) {
        assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
        const form = Object.fromEntries(new URLSearchParams(raw));
        m.sms.push({ auth: req.headers.authorization, form });
        if (m.twilioFail) return send(m.twilioFail.status, { code: m.twilioFail.code, message: m.twilioFail.message, status: m.twilioFail.status });
        return send(201, { sid: `SM${String(m.sms.length).padStart(32, '0')}`, status: 'queued', to: form.To });
      }
      if (req.method === 'GET' && req.url?.startsWith(`/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json`)) {
        return send(200, { incoming_phone_numbers: [
          { phone_number: '+97233721234', friendly_name: 'Tel Aviv', capabilities: { voice: true, sms: true, mms: false } },
          { phone_number: '+12025550100', friendly_name: 'US SMS', capabilities: { voice: false, sms: true } },
        ] });
      }
      if (req.method === 'GET' && req.url === '/v1/DialingPermissions/Countries/IL') return send(200, { iso_code: 'IL', name: 'Israel', low_risk_numbers_enabled: true });
      if (req.method === 'POST' && req.url === `/2010-04-01/Accounts/${SID}/Calls.json`) {
        const form = Object.fromEntries(new URLSearchParams(raw));
        m.calls.push({ auth: req.headers.authorization, form });
        return send(201, { sid: `CA${String(m.calls.length).padStart(32, '0')}`, status: 'queued', to: form.To });
      }
      send(404, { code: 20404, message: 'The requested resource was not found' });
    });
  });
  return new Promise(resolve => m.server.listen(0, '127.0.0.1', () => {
    const a = m.server.address();
    m.url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
    resolve(m);
  }));
}

describe('twilio: verification codes through sendOtp', { skip }, () => {
  let db: PrismaClient;
  let mock: Mock;
  let settings: typeof import('../../src/lib/server/platformSettings');
  let tw: typeof import('../../src/lib/server/twilio');
  let mgSvc: typeof import('../../src/lib/server/messaggio');
  let otp: typeof import('../../src/lib/server/otp');
  let userId: string;
  let saved: { twilio: unknown; messaggio: unknown };
  const stamp = String(Date.now()).slice(-6);
  const phone = (n: number) => `+97253${stamp}${n}`;
  const keepSite = process.env.SITE_URL;

  before(async () => {
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient();
    mock = await startMock();
    process.env.TWILIO_TEST_BASE = mock.url;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.MESSAGGIO_LOGIN;
    settings = await import('../../src/lib/server/platformSettings');
    tw = await import('../../src/lib/server/twilio');
    mgSvc = await import('../../src/lib/server/messaggio');
    otp = await import('../../src/lib/server/otp');
    const u = await db.user.create({ data: { email: `tw-${Date.now()}@example.test`, fullName: 'טוויליו', opsRole: 'ops' } });
    userId = u.id;
    const cur = await settings.platformSettings();
    saved = { twilio: cur.twilio, messaggio: cur.messaggio };
    await settings.savePlatformSettings(userId, { messaggio: { ...cur.messaggio, enabled: false }, twilio: { enabled: false, from: '', messagingServiceSid: '', voiceFrom: '', voice: 'Google.he-IL-Standard-A', whatsappEnabled: false, whatsappFrom: '', whatsappForSms: true, whatsappTemplates: {} } });
    await db.platformSecret.deleteMany({ where: { key: { in: ['twilio_credentials', 'messaggio_login'] } } });
    await db.messageSend.deleteMany({});
  });

  after(async () => {
    await settings.savePlatformSettings(userId, saved as Parameters<typeof settings.savePlatformSettings>[1]).catch(() => undefined);
    await db.platformSecret.deleteMany({ where: { key: { in: ['twilio_credentials', 'messaggio_login'] } } });
    await db.messageSend.deleteMany({});
    await db.otpCode.deleteMany({ where: { target: { startsWith: `+97253${stamp}` } } });
    await db.auditLog.deleteMany({ where: { actorId: userId } });
    await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    delete process.env.TWILIO_TEST_BASE;
    if (keepSite === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = keepSite;
    mock.server.close();
    await db.$disconnect();
  });

  it('credentials are checked, stored encrypted and verified against the account', async () => {
    assert.equal((await tw.saveTwilioCreds('AC123', TOKEN, userId)).ok, false);
    assert.equal((await tw.saveTwilioCreds(SID, 'short', userId)).ok, false);
    assert.equal((await tw.twilioCheck()).ok, false, 'nothing stored yet');
    assert.deepEqual(await tw.saveTwilioCreds(SID, TOKEN, userId), { ok: true, label: SID });
    const row = await db.platformSecret.findUnique({ where: { key: 'twilio_credentials' } });
    assert.ok(row?.valueEnc.startsWith('v2.') && !row.valueEnc.includes(TOKEN));
    const check = await tw.twilioCheck();
    assert.equal(check.ok, true);
    assert.match(check.ok ? check.text : '', /החיבור תקין: BeautyFind · active/);
  });

  it('while Twilio is off, an SMS code stays on the default adapter', async () => {
    await otp.sendOtp({ target: phone(1), channel: 'sms', purpose: 'login' });
    assert.equal(mock.sms.length, 0);
  });

  it('an SMS code goes to Twilio with basic auth, the sender, the code and the status callback; logged masked', async () => {
    process.env.SITE_URL = 'https://beautyfind.example';
    await settings.savePlatformSettings(userId, { twilio: { enabled: true, from: 'BeautyFind', messagingServiceSid: '', voiceFrom: '', voice: 'Google.he-IL-Standard-A', whatsappEnabled: false, whatsappFrom: '', whatsappForSms: true, whatsappTemplates: {} } });
    const r = await otp.sendOtp({ target: phone(2), channel: 'sms', purpose: 'signup' });
    assert.equal(r.ok, true);
    assert.equal(mock.sms.length, 1);
    const f = mock.sms[0].form;
    assert.equal(f.To, phone(2));
    assert.equal(f.From, 'BeautyFind');
    assert.equal(f.StatusCallback, 'https://beautyfind.example/api/twilio/status');
    assert.match(f.Body, /קוד האימות שלך ב-BeautyFind: \d{6}\./);
    const row = await db.messageSend.findFirst({ where: { provider: 'twilio' }, orderBy: { createdAt: 'desc' } });
    assert.equal(row?.status, 'sent');
    assert.equal(row?.deliveryStatus, 'queued');
    assert.match(row?.providerId ?? '', /^SM\d{32}$/);
    assert.ok(!JSON.stringify(row).includes(f.Body.match(/\d{6}/)![0]));
  });

  it('a WhatsApp code with no WhatsApp provider goes by Twilio SMS', async () => {
    const r = await otp.sendOtp({ target: phone(3), channel: 'whatsapp', purpose: 'login' });
    assert.equal(r.ok && r.channel, 'sms', 'the result says it went by SMS, so the screen can say so');
    assert.equal((await db.otpCode.findFirst({ where: { target: phone(3) } }))?.channel, 'sms');
    assert.equal(mock.sms.at(-1)?.form.To, phone(3));
    const row = await db.messageSend.findFirst({ where: { provider: 'twilio' }, orderBy: { createdAt: 'desc' } });
    assert.equal(row?.fallbackFrom, 'whatsapp');
  });

  it('the channels a code can reach: SMS by Twilio; no WhatsApp, voice or email without a provider', async () => {
    const { codeChannels } = await import('../../src/lib/server/verificationSend');
    assert.deepEqual(await codeChannels({ anyAdapter: false }), { whatsapp: false, sms: true, voice: false, email: false });
    assert.deepEqual(await codeChannels({ anyAdapter: true }), { whatsapp: true, sms: true, voice: true, email: true });
  });

  it('a voice code: no call while the only sender is a name; with a Twilio number, a call that reads the code', async () => {
    const calls = mock.calls.length;
    await otp.sendOtp({ target: phone(9), channel: 'voice', purpose: 'claim' });
    assert.equal(mock.calls.length, calls, 'an alphanumeric sender cannot call');
    const cur = (await settings.platformSettings()).twilio;
    await settings.savePlatformSettings(userId, { twilio: { ...cur, voiceFrom: '+97233721234' } });
    const { codeChannels } = await import('../../src/lib/server/verificationSend');
    assert.equal((await codeChannels({ anyAdapter: false })).voice, true);
    const r = await otp.sendOtp({ target: phone(10), channel: 'voice', purpose: 'claim' });
    assert.equal(r.ok && r.channel, 'voice');
    assert.equal(mock.calls.length, calls + 1);
    const f = mock.calls.at(-1)!.form;
    assert.equal(f.To, phone(10));
    assert.equal(f.From, '+97233721234');
    assert.equal(f.StatusCallback, 'https://beautyfind.example/api/twilio/status');
    const digits = f.Twiml.match(/(\d, ){5}\d/)?.[0];
    assert.ok(digits, 'the code is read digit by digit');
    const row = await db.messageSend.findFirst({ where: { provider: 'twilio', channel: 'voice' }, orderBy: { createdAt: 'desc' } });
    assert.equal(row?.status, 'sent');
    assert.match(row?.providerId ?? '', /^CA\d{32}$/);
    assert.ok(!JSON.stringify(row).includes(digits!.replace(/, /g, '')), 'the code is not logged');
    // The call's status callback: completed marks it answered.
    const { POST } = await import('../../src/app/api/twilio/status/route');
    const { twilioSignature } = await import('../../src/lib/vendors/twilio');
    const url = 'https://beautyfind.example/api/twilio/status';
    const params = { AccountSid: SID, CallSid: row!.providerId!, CallStatus: 'completed' };
    const res = await POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignature(TOKEN, url, params) }, body: new URLSearchParams(params) }));
    assert.equal(res.status, 204);
    const done = await db.messageSend.findUnique({ where: { id: row!.id } });
    assert.equal(done?.deliveryStatus, 'completed');
    assert.ok(done?.deliveredAt);
    // The admin test call works with the switch off.
    await settings.savePlatformSettings(userId, { twilio: { ...cur, voiceFrom: '+97233721234', enabled: false } });
    assert.equal((await tw.twilioTestCall(phone(11))).ok, true);
    await settings.savePlatformSettings(userId, { twilio: { ...cur, voiceFrom: '' } });
  });

  it('with Messaggio on for WhatsApp, WhatsApp goes there, and a refused WhatsApp falls back to Twilio SMS', async () => {
    await mgSvc.saveMessaggioLogin('test-login-123', userId);
    const cur = (await settings.platformSettings()).messaggio;
    await settings.savePlatformSettings(userId, { messaggio: { ...cur, enabled: true, whatsapp: true, sms: true, whatsappSender: 'wa-1', fallbackToSms: true, baseUrl: `${mock.url}/api/v1` } });
    const smsBefore = mock.sms.length;
    const wa = await otp.sendOtp({ target: phone(4), channel: 'whatsapp', purpose: 'login' });
    assert.equal(wa.ok && wa.channel, 'whatsapp');
    assert.deepEqual(mock.mg.at(-1)?.channels, ['whatsapp']);
    assert.equal(mock.sms.length, smsBefore, 'WhatsApp worked: no SMS');
    mock.mgFailWhatsapp = true;
    const fb = await otp.sendOtp({ target: phone(5), channel: 'whatsapp', purpose: 'login' });
    assert.equal(fb.ok && fb.channel, 'sms');
    assert.equal(mock.sms.length, smsBefore + 1, 'fell back to Twilio, not Messaggio SMS');
    assert.equal(mock.sms.at(-1)?.form.To, phone(5));
    mock.mgFailWhatsapp = false;
    const smsCode = mock.mg.length;
    await otp.sendOtp({ target: phone(6), channel: 'sms', purpose: 'login' });
    assert.equal(mock.mg.length, smsCode, 'SMS codes skip Messaggio while Twilio is on');
    await settings.savePlatformSettings(userId, { messaggio: { ...cur, enabled: false } });
  });

  it('a Twilio refusal fails the send with Twilio\'s code, and the code is dropped', async () => {
    mock.twilioFail = { status: 400, code: 21211, message: "The 'To' number is not a valid phone number." };
    await assert.rejects(otp.sendOtp({ target: phone(7), channel: 'sms', purpose: 'login' }), /21211: The 'To' number/);
    assert.equal(await db.otpCode.count({ where: { target: phone(7) } }), 0);
    const row = await db.messageSend.findFirst({ where: { provider: 'twilio' }, orderBy: { createdAt: 'desc' } });
    assert.equal(row?.status, 'failed');
    mock.twilioFail = null;
  });

  it('delivery reports: a signed callback updates the send; an unsigned or wrongly signed one is refused', async () => {
    const { POST } = await import('../../src/app/api/twilio/status/route');
    const { twilioSignature } = await import('../../src/lib/vendors/twilio');
    const row = await db.messageSend.findFirst({ where: { provider: 'twilio', status: 'sent' }, orderBy: { createdAt: 'desc' } });
    assert.ok(row?.providerId);
    const params = { AccountSid: SID, MessageSid: row.providerId, MessageStatus: 'delivered', To: phone(6) };
    const url = 'https://beautyfind.example/api/twilio/status';
    const req = (sig: string | null, p = params) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(sig ? { 'x-twilio-signature': sig } : {}) }, body: new URLSearchParams(p) });
    assert.equal((await POST(req(null))).status, 403);
    assert.equal((await POST(req(twilioSignature('0'.repeat(32), url, params)))).status, 403);
    assert.equal((await POST(req(twilioSignature(TOKEN, url, params)))).status, 204);
    const after1 = await db.messageSend.findUnique({ where: { id: row.id } });
    assert.equal(after1?.deliveryStatus, 'delivered');
    assert.ok(after1?.deliveredAt);
    const bad = { ...params, MessageStatus: 'undelivered', ErrorCode: '30006', ErrorMessage: 'Landline or unreachable carrier' };
    assert.equal((await POST(req(twilioSignature(TOKEN, url, bad), bad))).status, 204);
    const after2 = await db.messageSend.findUnique({ where: { id: row.id } });
    assert.equal(after2?.deliveryStatus, 'undelivered');
    assert.equal(after2?.deliveryError, '30006: Landline or unreachable carrier');
  });

  it('the setup check reads the account, its numbers and Israel call permission, and sends nothing', async () => {
    const sms = mock.sms.length;
    const calls = mock.calls.length;
    const r = await tw.twilioSetup();
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.setup.numbers.map(n => [n.phone, n.voice, n.sms]), [['+97233721234', true, true], ['+12025550100', false, true]]);
    const text = r.setup.checks.map(c => `${c.ok}:${c.text}`).join('\n');
    assert.match(text, /true:חשבון בתשלום/);
    assert.match(text, /true:1 מספרים בחשבון יכולים להתקשר/);
    assert.match(text, /false:לא נבחר מספר לשיחות/);
    assert.match(text, /true:שיחות לישראל מותרות/);
    assert.equal(mock.sms.length, sms);
    assert.equal(mock.calls.length, calls);
  });

  it('the admin test SMS works with the switch off; a rejected token is reported', async () => {
    await settings.savePlatformSettings(userId, { twilio: { enabled: false, from: 'BeautyFind', messagingServiceSid: '', voiceFrom: '', voice: 'Google.he-IL-Standard-A', whatsappEnabled: false, whatsappFrom: '', whatsappForSms: true, whatsappTemplates: {} } });
    const r = await tw.twilioTestSend(phone(8));
    assert.equal(r.ok, true);
    assert.match(mock.sms.at(-1)!.form.Body, /הודעת בדיקה/);
    await tw.saveTwilioCreds(SID, 'c3'.repeat(16), userId);
    const check = await tw.twilioCheck();
    assert.equal(check.ok, false);
    assert.match(check.ok ? '' : check.error, /401/);
    const st = await tw.twilioStatus();
    assert.equal(st.configured, true);
    assert.equal(st.ready, false);
  });
});
