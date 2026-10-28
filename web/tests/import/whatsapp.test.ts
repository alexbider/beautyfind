// WhatsApp through Twilio (src/lib/server/whatsapp.ts, src/lib/server/deliver.ts): templates made from the SMS texts,
// sending only what matches an approved template, SMS when WhatsApp refuses or cannot deliver, and the sealed SMS
// text wiped on the final status. Against a loopback mock of Twilio's Messages, Content and Senders APIs.
// Needs a local DATABASE_URL.

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';

const URL_OK = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const skip = URL_OK ? false : 'needs a local DATABASE_URL';
const SID = 'AC' + 'c3'.repeat(16);
const TOKEN = 'd4'.repeat(16);
const WA_FROM = '+972535550000';

interface Mock { url: string; server: Server; messages: Array<Record<string, string>>; contents: Array<Record<string, unknown>>; approvals: Record<string, string>; submitted: Array<{ sid: string; body: Record<string, unknown> }>; failWhatsApp: number | null }

function startMock(): Promise<Mock> {
  const m: Mock = { url: '', server: null as unknown as Server, messages: [], contents: [], approvals: {}, submitted: [], failWhatsApp: null };
  m.server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const url = req.url ?? '';
      const send = (status: number, j: object) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.method === 'POST' && url === `/2010-04-01/Accounts/${SID}/Messages.json`) {
        const f = Object.fromEntries(new URLSearchParams(raw));
        if (f.To?.startsWith('whatsapp:') && m.failWhatsApp) return send(400, { code: m.failWhatsApp, message: 'Twilio could not find a Channel with the specified From address', status: 400 });
        m.messages.push(f);
        return send(201, { sid: `${f.To?.startsWith('whatsapp:') ? 'MM' : 'SM'}${String(m.messages.length).padStart(32, '0')}`, status: 'queued' });
      }
      if (req.method === 'POST' && url === '/v1/Content') {
        const body = JSON.parse(raw);
        const sid = `HX${String(m.contents.length + 1).padStart(32, '0')}`;
        m.contents.push({ sid, ...body });
        return send(201, { sid });
      }
      let r = url.match(/^\/v1\/Content\/(HX\d+)\/ApprovalRequests\/whatsapp$/);
      if (r && req.method === 'POST') { m.submitted.push({ sid: r[1], body: JSON.parse(raw) }); m.approvals[r[1]] = 'received'; return send(201, { status: 'received' }); }
      r = url.match(/^\/v1\/Content\/(HX\d+)\/ApprovalRequests$/);
      if (r) return send(200, { whatsapp: { status: m.approvals[r[1]] ?? 'unsubmitted', rejection_reason: m.approvals[r[1]] === 'rejected' ? 'INVALID_FORMAT' : '' } });
      if (url.startsWith('/v2/Channels/Senders')) return send(200, { senders: [{ sid: 'XE1', sender_id: `whatsapp:${WA_FROM}`, status: 'ONLINE', profile: { name: 'BeautyFind' } }] });
      send(404, { message: 'not found' });
    });
  });
  return new Promise(resolve => m.server.listen(0, '127.0.0.1', () => {
    const a = m.server.address();
    m.url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
    resolve(m);
  }));
}

describe('WhatsApp through Twilio', { skip }, () => {
  let db: PrismaClient;
  let mock: Mock;
  let settings: typeof import('../../src/lib/server/platformSettings');
  let wa: typeof import('../../src/lib/server/whatsapp');
  let saved: unknown;
  let userId: string;
  const tag = String(Date.now()).slice(-6);
  const phone = (n: number) => `+97252${tag}${n}`;
  const keepSite = process.env.SITE_URL;
  const booking = { name: 'נועה', business: 'סטודיו אורה', treatment: 'טיפול פנים', date: '04/11/2026', time: '10:30', practitioner: 'מיכל', address: 'הרצל 12', ref: 'BF-1', link: 'https://beautyfind.co.il/b/x' };

  before(async () => {
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient();
    mock = await startMock();
    process.env.TWILIO_TEST_BASE = mock.url;
    process.env.SITE_URL = 'https://beautyfind.co.il';
    for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'MESSAGGIO_LOGIN']) delete process.env[k];
    settings = await import('../../src/lib/server/platformSettings');
    wa = await import('../../src/lib/server/whatsapp');
    const twilio = await import('../../src/lib/server/twilio');
    userId = (await db.user.create({ data: { email: `wa-${tag}@example.test`, fullName: 'וואטסאפ', opsRole: 'ops' } })).id;
    const cur = await settings.platformSettings();
    saved = { twilio: cur.twilio, messaggio: cur.messaggio };
    await twilio.saveTwilioCreds(SID, TOKEN, userId);
    await settings.savePlatformSettings(userId, {
      twilio: { ...cur.twilio, enabled: true, from: 'BeautyFind', messagingServiceSid: '', whatsappEnabled: false, whatsappFrom: '', whatsappForSms: true, whatsappTemplates: {} },
      messaggio: { ...cur.messaggio, enabled: false },
    });
  });

  after(async () => {
    await settings.savePlatformSettings(userId, saved as never).catch(() => undefined);
    await db.messageSend.deleteMany({ where: { toMasked: { contains: tag.slice(-3) } } });
    await db.platformSecret.deleteMany({ where: { key: 'twilio_credentials' } });
    await db.auditLog.deleteMany({ where: { actorId: userId } });
    await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    delete process.env.TWILIO_TEST_BASE;
    if (keepSite === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = keepSite;
    mock.server.close();
    await db.$disconnect();
  });

  it('a template is the SMS text with each plain var as {{n}}, closing with fixed text', () => {
    const sk = wa.skeletonOf('M1_booking_confirmed', booking)!;
    assert.match(sk.body, /\{\{1\}\}/);
    assert.ok(!/\{\{\d+\}\}\s*$/.test(sk.body), 'never ends with a variable');
    assert.ok(!/^\{\{/.test(sk.body), 'never starts with a variable');
    assert.ok(sk.vars.includes('link') && sk.vars.includes('ref'));
    assert.ok(!sk.body.includes('BF-1') && !sk.body.includes('סטודיו אורה'), 'no sample data in the template');
  });

  it('templates are created in Hebrew, submitted as Utility, and refreshed', async () => {
    const r = await wa.syncWhatsAppTemplates(userId);
    assert.ok(r.ok);
    assert.ok(r.ok && r.created >= 10, `created ${r.ok && r.created}`);
    const c = mock.contents.find(x => String(x.friendly_name) === 'bf_m1_booking_confirmed')!;
    assert.equal(c.language, 'he');
    assert.ok((c.types as Record<string, { body: string }>)['twilio/text'].body.includes('{{1}}'));
    assert.ok(Object.values(c.variables as Record<string, string>).includes('BF-1') || Object.values(c.variables as Record<string, string>).length > 0);
    assert.equal(mock.submitted.find(x => x.sid === c.sid)?.body.category, 'UTILITY');
    assert.ok(!mock.contents.some(x => String(x.friendly_name).startsWith('bf_m16_otp')), 'codes are not templated');
    // Meta approves the booking confirmation; a refresh picks it up and creates nothing new.
    mock.approvals[String(c.sid)] = 'approved';
    const again = await wa.syncWhatsAppTemplates(userId);
    assert.ok(again.ok && again.created === 0 && again.approved === 1);
  });

  it('with WhatsApp on, a matching notice goes by WhatsApp; others stay on SMS', async () => {
    const cur = await settings.platformSettings();
    await settings.savePlatformSettings(userId, { twilio: { ...cur.twilio, whatsappEnabled: true, whatsappFrom: WA_FROM } });
    const { messaging } = await import('../../src/lib/vendors/messaging');
    const before = mock.messages.length;
    const r = await messaging().send({ channel: 'whatsapp', to: phone(1), template: 'M1_booking_confirmed', vars: booking, kind: 'service' });
    assert.equal(r.channel, 'whatsapp');
    const m = mock.messages[before];
    assert.equal(m.To, `whatsapp:${phone(1)}`);
    assert.equal(m.From, `whatsapp:${WA_FROM}`);
    assert.match(m.ContentSid, /^HX/);
    const vars = JSON.parse(m.ContentVariables);
    assert.ok(Object.values(vars).includes('BF-1'));
    const row = await db.messageSend.findFirst({ where: { providerId: r.id } });
    assert.equal(row?.channel, 'whatsapp');
    assert.ok(row?.fallbackEnc && !row.fallbackEnc.includes(phone(1)), 'the SMS fallback is sealed');

    // An SMS notice goes by WhatsApp first too ("WhatsApp first" is on by default).
    const s2 = await messaging().send({ channel: 'sms', to: phone(2), template: 'M1_booking_confirmed', vars: booking, kind: 'service' });
    assert.equal(s2.channel, 'whatsapp');
    // A template that is not approved goes by SMS.
    const s3 = await messaging().send({ channel: 'whatsapp', to: phone(3), template: 'M2_reminder', vars: booking, kind: 'service' });
    assert.equal(s3.channel, 'sms');
    assert.equal(mock.messages.at(-1)!.To, phone(3));
    // Different wording (a missing line) does not match the template: SMS.
    const s4 = await messaging().send({ channel: 'whatsapp', to: phone(4), template: 'M1_booking_confirmed', vars: { ...booking, ref: '' }, kind: 'service' });
    assert.equal(s4.channel, 'sms');
  });

  it('a WhatsApp refusal goes by SMS right away; a failed delivery goes by SMS once from the status callback', async () => {
    const { messaging } = await import('../../src/lib/vendors/messaging');
    mock.failWhatsApp = 63007;
    const r = await messaging().send({ channel: 'whatsapp', to: phone(5), template: 'M1_booking_confirmed', vars: booking, kind: 'service' });
    assert.equal(r.channel, 'sms');
    assert.equal(mock.messages.at(-1)!.To, phone(5));
    mock.failWhatsApp = null;

    const ok = await messaging().send({ channel: 'whatsapp', to: phone(6), template: 'M1_booking_confirmed', vars: booking, kind: 'service' });
    assert.equal(ok.channel, 'whatsapp');
    const twilio = await import('../../src/lib/server/twilio');
    const count = mock.messages.length;
    await twilio.applyTwilioStatus({ MessageSid: ok.id, MessageStatus: 'undelivered', ErrorCode: '63024' });
    await twilio.applyTwilioStatus({ MessageSid: ok.id, MessageStatus: 'undelivered', ErrorCode: '63024' });
    assert.equal(mock.messages.length, count + 1, 'one SMS, even when Twilio reports twice');
    assert.equal(mock.messages.at(-1)!.To, phone(6));
    const row = await db.messageSend.findFirst({ where: { providerId: ok.id } });
    assert.equal(row?.fallbackEnc, null);

    const read = await messaging().send({ channel: 'whatsapp', to: phone(7), template: 'M1_booking_confirmed', vars: booking, kind: 'service' });
    await twilio.applyTwilioStatus({ MessageSid: read.id, MessageStatus: 'read' });
    const r7 = await db.messageSend.findFirst({ where: { providerId: read.id } });
    assert.equal(r7?.deliveryStatus, 'read');
    assert.equal(r7?.fallbackEnc, null, 'wiped once it was read');
  });

  it('lists the account senders and reports status', async () => {
    const s = await wa.whatsappSenders();
    assert.ok(s.ok && s.senders[0].phone === WA_FROM && s.senders[0].status === 'ONLINE');
    const st = await wa.whatsappStatusSummary();
    assert.equal(st.ready, true);
    assert.ok(st.sent24h >= 3);
  });
});
