// Email through Resend and service notices through Twilio SMS (src/lib/vendors/resend.ts, src/lib/server/email.ts,
// src/lib/server/deliver.ts, src/lib/messages/render.ts), against a loopback mock of Resend's and Twilio's APIs.
// The DB part needs a local DATABASE_URL.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';

const URL_OK = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const skip = URL_OK ? false : 'needs a local DATABASE_URL';
const KEY = 're_test_' + 'k'.repeat(20);
const SID = 'AC' + 'a1'.repeat(16);
const TOKEN = 'b2'.repeat(16);

/** Every template id the code sends with, found in the source. */
function templatesInCode(): string[] {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f)) for (const m of readFileSync(p, 'utf8').matchAll(/(?:template: |wa\([^,]+, |notifyInviter\(inv, )'([A-Za-z0-9_]+)'/g)) out.add(m[1]);
    }
  };
  walk(join(__dirname, '../../src'));
  return [...out];
}

describe('messages: every template has an email and an SMS text', () => {
  it('renders each template the code sends', async () => {
    const { renderMessage, emailBody } = await import('../../src/lib/messages/render');
    const ids = templatesInCode();
    assert.ok(ids.length >= 20, `found ${ids.length}`);
    const vars = { name: 'דנה', business: 'סלון דוגמה', treatment: 'טיפול פנים', date: '12.11', time: '10:30', ref: 'BK-1', link: 'https://x.test/l', code: '123456', minutes: '10', amount: '300 ₪', buyer: 'רון', recipient: 'מאיה', email: 'a@b.co', reason: 'general', text: 'שלום', status: 'approved', refunded: '50', late: '0', inviter: 'אבי', role: 'מנהלת', expires: '1.12', practitioner: 'נועה', message: 'מזל טוב' };
    for (const id of ids) {
      const r = renderMessage(id, vars, 'https://beautyfind.co.il');
      assert.ok(r, `no text for ${id}`);
      assert.ok(r.subject && r.lines.length && r.sms, id);
      assert.ok(!/undefined|\{\w+\}/.test(r.subject + r.lines.join(' ') + r.sms), `placeholder left in ${id}`);
      assert.ok(r.sms.length <= 320, `${id} SMS is ${r.sms.length} characters`);
      const { html, text } = emailBody(r);
      assert.match(html, /dir="rtl"/);
      assert.ok(text.includes(r.lines[0]));
    }
  });

  it('escapes HTML and has no em dash in any text', async () => {
    const { renderMessage, emailBody } = await import('../../src/lib/messages/render');
    const r = renderMessage('M_profile_lead', { business: 'A', name: '<script>x</script>', message: 'a & b' }, 'https://beautyfind.co.il')!;
    const { html } = emailBody(r);
    assert.ok(!html.includes('<script>x'));
    assert.match(html, /&lt;script&gt;/);
    assert.ok(!readFileSync(join(__dirname, '../../src/lib/messages/render.ts'), 'utf8').includes('—'));
  });
});

interface Mock { url: string; emails: Array<{ auth: string | undefined; body: Record<string, unknown> }>; sms: Array<Record<string, string>>; domains: Array<{ name: string; status: string }>; failEmail: number | null; server: Server }

function startMock(): Promise<Mock> {
  const m: Mock = { url: '', emails: [], sms: [], domains: [{ name: 'beautyfind.co.il', status: 'verified' }], failEmail: null, server: null as unknown as Server };
  m.server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const send = (status: number, j: object) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.url === '/emails' && req.method === 'POST') {
        if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { statusCode: 401, name: 'validation_error', message: 'API key is invalid' });
        m.emails.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
        if (m.failEmail) return send(m.failEmail, { statusCode: m.failEmail, name: 'validation_error', message: 'The beautyfind.co.il domain is not verified' });
        return send(200, { id: `em-${m.emails.length}` });
      }
      if (req.url === '/domains') return send(200, { data: m.domains });
      if (req.method === 'POST' && req.url === `/2010-04-01/Accounts/${SID}/Messages.json`) {
        const f = Object.fromEntries(new URLSearchParams(raw));
        m.sms.push(f);
        return send(201, { sid: `SM${String(m.sms.length).padStart(32, '0')}`, status: 'queued' });
      }
      send(404, { message: 'not found' });
    });
  });
  return new Promise(resolve => m.server.listen(0, '127.0.0.1', () => {
    const a = m.server.address();
    m.url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
    resolve(m);
  }));
}

describe('email and notices through the providers', { skip }, () => {
  let db: PrismaClient;
  let mock: Mock;
  let settings: typeof import('../../src/lib/server/platformSettings');
  let email: typeof import('../../src/lib/server/email');
  let messaging: typeof import('../../src/lib/vendors/messaging')['messaging'];
  let userId: string;
  let saved: Record<string, unknown>;
  const stamp = String(Date.now()).slice(-6);
  const phone = (n: number) => `+97252${stamp}${n}`;

  before(async () => {
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient();
    mock = await startMock();
    process.env.RESEND_TEST_BASE = mock.url;
    process.env.TWILIO_TEST_BASE = mock.url;
    for (const k of ['RESEND_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'MESSAGGIO_LOGIN']) delete process.env[k];
    settings = await import('../../src/lib/server/platformSettings');
    email = await import('../../src/lib/server/email');
    messaging = (await import('../../src/lib/vendors/messaging')).messaging;
    const u = await db.user.create({ data: { email: `rs-${Date.now()}@example.test`, fullName: 'ריסנד', opsRole: 'ops' } });
    userId = u.id;
    const cur = await settings.platformSettings();
    saved = { email: cur.email, twilio: cur.twilio, messaggio: cur.messaggio };
    await settings.savePlatformSettings(userId, { email: { ...cur.email, enabled: false }, twilio: { ...cur.twilio, enabled: false }, messaggio: { ...cur.messaggio, enabled: false } });
    await db.platformSecret.deleteMany({ where: { key: { in: ['resend_api_key', 'twilio_credentials', 'messaggio_login'] } } });
    await db.messageSend.deleteMany({});
  });

  after(async () => {
    await settings.savePlatformSettings(userId, saved as Parameters<typeof settings.savePlatformSettings>[1]).catch(() => undefined);
    await db.platformSecret.deleteMany({ where: { key: { in: ['resend_api_key', 'twilio_credentials'] } } });
    await db.messageSend.deleteMany({});
    await db.otpCode.deleteMany({ where: { target: { contains: stamp } } });
    await db.auditLog.deleteMany({ where: { actorId: userId } });
    await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    delete process.env.RESEND_TEST_BASE;
    delete process.env.TWILIO_TEST_BASE;
    mock.server.close();
    await db.$disconnect();
  });

  it('without a key or with the switch off, email stays on the default adapter', async () => {
    await messaging().send({ channel: 'email', to: `x${stamp}@example.test`, template: 'M17_reset', vars: { link: 'https://x.test' }, kind: 'service' });
    assert.equal(mock.emails.length, 0);
    assert.equal((await email.saveResendKey('nope', userId)).ok, false);
    assert.deepEqual(await email.saveResendKey(KEY, userId), { ok: true, hint: `re_•••${KEY.slice(-4)}` });
    const row = await db.platformSecret.findUnique({ where: { key: 'resend_api_key' } });
    assert.ok(row && !row.valueEnc.includes(KEY));
    await messaging().send({ channel: 'email', to: `x${stamp}@example.test`, template: 'M17_reset', vars: { link: 'https://x.test' }, kind: 'service' });
    assert.equal(mock.emails.length, 0, 'switch off');
  });

  it('the domain check reads Resend domains', async () => {
    assert.equal((await email.emailDomainCheck()).ok, true);
    mock.domains = [{ name: 'beautyfind.co.il', status: 'pending' }];
    const pending = await email.emailDomainCheck();
    assert.equal(pending.ok, false);
    assert.match(pending.ok ? '' : pending.error, /עוד לא מאומת/);
    mock.domains = [];
    assert.match((await email.emailDomainCheck() as { error: string }).error, /לא נוסף ל־Resend/);
    mock.domains = [{ name: 'beautyfind.co.il', status: 'verified' }];
  });

  it('a password reset email goes to Resend in Hebrew, RTL, with the link; logged masked', async () => {
    const cur = (await settings.platformSettings()).email;
    await settings.savePlatformSettings(userId, { email: { ...cur, enabled: true, from: 'BeautyFind <noreply@beautyfind.co.il>', replyTo: 'hello@beautyfind.co.il' } });
    const to = `dana${stamp}@example.test`;
    const r = await messaging().send({ channel: 'email', to, template: 'M17_reset', vars: { name: 'דנה', link: 'https://beautyfind.co.il/login?view=reset&token=t', minutes: '30' }, kind: 'service' });
    assert.equal(r.channel, 'email');
    const e = mock.emails.at(-1)!.body as { from: string; to: string[]; subject: string; html: string; text: string; reply_to: string };
    assert.equal(e.from, 'BeautyFind <noreply@beautyfind.co.il>');
    assert.deepEqual(e.to, [to]);
    assert.equal(e.reply_to, 'hello@beautyfind.co.il');
    assert.match(e.subject, /איפוס הסיסמה/);
    assert.match(e.html, /dir="rtl"/);
    assert.match(e.html, /view=reset&amp;token=t/);
    assert.match(e.text, /שלום דנה,/);
    const row = await db.messageSend.findFirst({ where: { provider: 'resend' }, orderBy: { createdAt: 'desc' } });
    assert.equal(row?.status, 'sent');
    assert.equal(row?.channel, 'email');
    assert.ok(!row?.toMasked.includes(`dana${stamp}`));
  });

  it('email counts as a code channel, and a claim code by email goes through Resend', async () => {
    const { codeChannels } = await import('../../src/lib/server/verificationSend');
    assert.equal((await codeChannels({ anyAdapter: false })).email, true);
    const { sendOtp } = await import('../../src/lib/server/otp');
    const r = await sendOtp({ target: `owner${stamp}@example.test`, channel: 'email', purpose: 'claim' });
    assert.equal(r.ok && r.channel, 'email');
    assert.match(String((mock.emails.at(-1)!.body as { text: string }).text), /קוד האימות שלך: \d{6}/);
  });

  it('a failed notice email is logged and does not throw; a failed code email throws', async () => {
    mock.failEmail = 403;
    const r = await messaging().send({ channel: 'email', to: `a${stamp}@example.test`, template: 'M_contact_receipt', vars: { ref: 'C-1', reason: 'general' }, kind: 'service' });
    assert.equal(r.id, 'failed');
    const row = await db.messageSend.findFirst({ where: { provider: 'resend' }, orderBy: { createdAt: 'desc' } });
    assert.equal(row?.status, 'failed');
    assert.match(row?.error ?? '', /not verified/);
    const { sendOtp } = await import('../../src/lib/server/otp');
    await assert.rejects(sendOtp({ target: `b${stamp}@example.test`, channel: 'email', purpose: 'claim' }), /not verified/);
    mock.failEmail = null;
  });

  it('booking notices asked for WhatsApp go by Twilio SMS while Twilio is on, and stay on the log while it is off', async () => {
    const sms = mock.sms.length;
    await messaging().send({ channel: 'whatsapp', to: phone(1), template: 'M1_booking_confirmed', vars: { name: 'דנה', business: 'סלון', treatment: 'פנים', date: '12.11', time: '10:30', ref: 'BK-9', link: 'https://x.test/b' }, kind: 'service' });
    assert.equal(mock.sms.length, sms, 'Twilio off: not sent');
    const twilio = await import('../../src/lib/server/twilio');
    await twilio.saveTwilioCreds(SID, TOKEN, userId);
    const cur = (await settings.platformSettings()).twilio;
    await settings.savePlatformSettings(userId, { twilio: { ...cur, enabled: true, from: 'BeautyFind', messagingServiceSid: '' } });
    const r = await messaging().send({ channel: 'whatsapp', to: phone(2), template: 'M1_booking_confirmed', vars: { name: 'דנה', business: 'סלון', treatment: 'פנים', date: '12.11', time: '10:30', ref: 'BK-9', link: 'https://x.test/b' }, kind: 'service' });
    assert.equal(r.channel, 'sms');
    const f = mock.sms.at(-1)!;
    assert.equal(f.To, phone(2));
    assert.match(f.Body, /התור אושר. פנים בסלון, 12.11 בשעה 10:30. הזמנה BK-9/);
    const row = await db.messageSend.findFirst({ where: { provider: 'twilio' }, orderBy: { createdAt: 'desc' } });
    assert.equal(row?.template, 'M1_booking_confirmed');
    assert.equal(row?.fallbackFrom, 'whatsapp');
  });

  it('marketing messages are never sent by SMS or email automatically', async () => {
    const sms = mock.sms.length;
    const emails = mock.emails.length;
    await messaging().send({ channel: 'whatsapp', to: phone(3), template: 'M1_booking_confirmed', vars: {}, kind: 'marketing' });
    await messaging().send({ channel: 'email', to: `m${stamp}@example.test`, template: 'M17_reset', vars: {}, kind: 'marketing' });
    assert.equal(mock.sms.length, sms);
    assert.equal(mock.emails.length, emails);
  });

  it('the admin test email works with the switch off and is marked as a test', async () => {
    const cur = (await settings.platformSettings()).email;
    await settings.savePlatformSettings(userId, { email: { ...cur, enabled: false } });
    const r = await email.emailTestSend(`t${stamp}@example.test`);
    assert.equal(r.ok, true);
    const row = await db.messageSend.findFirst({ where: { provider: 'resend' }, orderBy: { createdAt: 'desc' } });
    assert.equal(row?.test, true);
    const st = await email.emailStatus();
    assert.equal(st.configured, true);
    assert.equal(st.ready, false);
  });
});
