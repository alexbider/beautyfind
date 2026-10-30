// Consultation replies (src/lib/server/consultReply.ts), the day-before reminder (src/lib/server/reminders.ts)
// and Resend delivery tracking (src/app/api/resend/webhook), against a loopback mock of Resend and Twilio.
// Paid plans only for replies and reminders. Needs a local DATABASE_URL.

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';

const URL_OK = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const skip = URL_OK ? false : 'needs a local DATABASE_URL';
const KEY = 're_test_' + 'n'.repeat(20);
const SID = 'AC' + 'c3'.repeat(16);
const TOKEN = 'd4'.repeat(16);
const HOOK = 'whsec_' + Buffer.from('notices-test-secret-0123456789').toString('base64');

describe('svix signatures', () => {
  it('matches the Svix documentation example and refuses a changed body or an old timestamp', async () => {
    const r = await import('../../src/lib/vendors/resend');
    const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
    const id = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
    const ts = '1614265330';
    const body = '{"test": 2432232314}';
    assert.equal(r.svixSignature(secret, id, ts, body), 'g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=');
    const h = { id, timestamp: ts, signature: 'v1,bad v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=' };
    assert.equal(r.validSvix(secret, h, body, 1614265330_000), true);
    assert.equal(r.validSvix(secret, h, body + ' ', 1614265330_000), false);
    assert.equal(r.validSvix(secret, h, body, 1614265330_000 + 10 * 60_000), false, 'ten minutes late');
  });
});

interface Mock { url: string; emails: Array<{ to: string[]; subject: string; text: string; reply_to?: string }>; sms: Array<Record<string, string>>; server: Server }
function startMock(): Promise<Mock> {
  const m: Mock = { url: '', emails: [], sms: [], server: null as unknown as Server };
  m.server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const send = (status: number, j: object) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.url === '/emails') { m.emails.push(JSON.parse(raw)); return send(200, { id: `em-${m.emails.length}-${Date.now()}` }); }
      if (req.url === `/2010-04-01/Accounts/${SID}/Messages.json`) { m.sms.push(Object.fromEntries(new URLSearchParams(raw))); return send(201, { sid: `SM${Date.now()}${m.sms.length}`.padEnd(34, '0'), status: 'queued' }); }
      send(404, {});
    });
  });
  return new Promise(resolve => m.server.listen(0, '127.0.0.1', () => {
    const a = m.server.address();
    m.url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
    resolve(m);
  }));
}

describe('replies, reminders and delivery tracking', { skip }, () => {
  let db: PrismaClient;
  let mock: Mock;
  let settings: typeof import('../../src/lib/server/platformSettings');
  let userId: string;
  let saved: Record<string, unknown>;
  const tag = `nt${Date.now()}`;
  const made = { businesses: [] as string[], users: [] as string[] };
  const keepSite = process.env.SITE_URL;

  async function clinic(paid: boolean) {
    const owner = await db.user.create({ data: { email: `${tag}-${made.businesses.length}@example.test`, fullName: 'בעלים' } });
    made.users.push(owner.id);
    const biz = await db.business.create({ data: { status: 'live', type: 'salon', ownerUserId: owner.id } });
    made.businesses.push(biz.id);
    if (paid) await db.subscription.create({ data: { businessId: biz.id, plan: 'basic', pricePerBranchAgorot: 19900, status: 'active' } });
    const branch = await db.branch.create({ data: { businessId: biz.id, name: paid ? 'קליניקה בתשלום' : 'קליניקה חינם', slug: `${tag}-${made.businesses.length}`, regionSlug: 'north', cityName: 'חיפה', address: 'רחוב 1, חיפה', lat: 32.8, lng: 34.99, status: 'live', phone: '+97248123456', email: paid ? `clinic-${tag}@example.test` : null } });
    return { biz, branch, owner };
  }

  before(async () => {
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient();
    mock = await startMock();
    process.env.RESEND_TEST_BASE = mock.url;
    process.env.TWILIO_TEST_BASE = mock.url;
    process.env.SITE_URL = 'https://beautyfind.example';
    for (const k of ['RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']) delete process.env[k];
    settings = await import('../../src/lib/server/platformSettings');
    const u = await db.user.create({ data: { email: `${tag}-ops@example.test`, fullName: 'צוות', opsRole: 'ops' } });
    userId = u.id;
    made.users.push(u.id);
    const cur = await settings.platformSettings();
    saved = { email: cur.email, twilio: cur.twilio, messaggio: cur.messaggio };
    const email = await import('../../src/lib/server/email');
    const twilio = await import('../../src/lib/server/twilio');
    await email.saveResendKey(KEY, userId);
    await twilio.saveTwilioCreds(SID, TOKEN, userId);
    await settings.savePlatformSettings(userId, {
      email: { enabled: true, from: 'BeautyFind <noreply@beautyfind.co.il>', replyTo: '', replyDomain: '', forwardTo: 'hello@beautyfind.co.il' },
      twilio: { ...cur.twilio, enabled: true, from: 'BeautyFind', messagingServiceSid: '' },
      messaggio: { ...cur.messaggio, enabled: false },
    });
  });

  after(async () => {
    await settings.savePlatformSettings(userId, saved as Parameters<typeof settings.savePlatformSettings>[1]).catch(() => undefined);
    await db.platformSecret.deleteMany({ where: { key: { in: ['resend_api_key', 'twilio_credentials', 'resend_webhook_secret'] } } });
    await db.messageSend.deleteMany({});
    for (const id of made.businesses) {
      const branches = await db.branch.findMany({ where: { businessId: id }, select: { id: true } });
      const bIds = branches.map(b => b.id);
      await db.booking.deleteMany({ where: { branchId: { in: bIds } } });
      await db.consultRequest.deleteMany({ where: { branchId: { in: bIds } } });
      await db.branch.deleteMany({ where: { businessId: id } });
      await db.subscription.deleteMany({ where: { businessId: id } });
      await db.business.delete({ where: { id } }).catch(() => undefined);
    }
    await db.auditLog.deleteMany({ where: { actorId: { in: made.users } } });
    await db.user.deleteMany({ where: { id: { in: made.users } } });
    for (const k of ['RESEND_TEST_BASE', 'TWILIO_TEST_BASE']) delete process.env[k];
    if (keepSite === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = keepSite;
    mock.server.close();
    await db.$disconnect();
  });

  it('consultation: a paid clinic SMS carries a reply link; the reply is stored, emailed to the clinic, and the link is refused once tampered', async () => {
    const { branch } = await clinic(true);
    const req = await db.consultRequest.create({ data: { branchId: branch.id, ref: `R-${tag.slice(-6)}`, clientName: 'דנה כהן', clientPhone: '+972521112233', areas: ['face'], goal: 'x', priorInjections: 'never', format: 'clinic', preferredTimes: ['morning'], status: 'awaiting_client', proposedSlot: new Date('2026-11-12T08:30:00Z') } });
    const cr = await import('../../src/lib/server/consultReply');
    const vars = await cr.replyVars({ id: req.id, branch: { businessId: branch.businessId, phone: branch.phone } });
    assert.equal(vars.reply_link, `https://beautyfind.example/r/${cr.replyToken(req.id)}`);
    const { messaging } = await import('../../src/lib/vendors/messaging');
    await messaging().send({ channel: 'whatsapp', to: req.clientPhone, template: 'M9_consult_proposal', vars: { ...vars, business: branch.name, text: 'היי דנה, נשמח לקבוע ייעוץ. לאשר?' }, kind: 'service' });
    assert.match(mock.sms.at(-1)!.Body, /לתשובה לעסק: https:\/\/beautyfind\.example\/r\//);

    assert.equal(cr.parseReplyToken(cr.replyToken(req.id) + 'x'), null);
    assert.equal(cr.parseReplyToken(cr.replyToken(req.id).replace(/.$/, c => (c === 'a' ? 'b' : 'a'))), null);
    const view = await cr.loadReplyView(cr.replyToken(req.id));
    assert.equal(view?.paid, true);
    assert.equal(view?.open, true);
    assert.match(view?.proposed ?? '', /בשעה 10:30/);

    assert.deepEqual(await cr.submitReply(cr.replyToken(req.id), 'other_time', ''), { ok: false, error: 'invalid' });
    const r = await cr.submitReply(cr.replyToken(req.id), 'other_time', 'עדיף יום שלישי בבוקר');
    assert.deepEqual(r, { ok: true, emailed: true });
    const mail = mock.emails.at(-1)!;
    assert.deepEqual(mail.to, [`clinic-${tag}@example.test`]);
    assert.match(mail.subject, /תשובה מדנה כהן לבקשת הייעוץ/);
    assert.match(mail.text, /מבקש\/ת מועד אחר/);
    assert.match(mail.text, /עדיף יום שלישי בבוקר/);
    const rows = await db.consultReply.findMany({ where: { consultRequestId: req.id } });
    assert.equal(rows.length, 1);
    assert.ok(rows[0].emailedAt);
    assert.deepEqual(await cr.submitReply(cr.replyToken(req.id), 'message', 'שוב'), { ok: false, error: 'too_fast' });
  });

  it('consultation: a clinic without a paid plan gets no reply link; the SMS says to call, and replies are refused', async () => {
    const { branch } = await clinic(false);
    const req = await db.consultRequest.create({ data: { branchId: branch.id, ref: `R-${tag.slice(-5)}f`, clientName: 'נועה', clientPhone: '+972521112244', areas: ['face'], goal: 'x', priorInjections: 'never', format: 'clinic', preferredTimes: ['morning'], status: 'awaiting_client' } });
    const cr = await import('../../src/lib/server/consultReply');
    const vars = await cr.replyVars({ id: req.id, branch: { businessId: branch.businessId, phone: branch.phone } });
    assert.equal(vars.reply_link, undefined);
    const { messaging } = await import('../../src/lib/vendors/messaging');
    await messaging().send({ channel: 'whatsapp', to: req.clientPhone, template: 'M8_consult_details', vars: { ...vars, name: 'נועה', business: branch.name, ref: req.ref }, kind: 'service' });
    assert.match(mock.sms.at(-1)!.Body, /לתשובה התקשרו לעסק: 04-812-3456/);
    assert.deepEqual(await cr.submitReply(cr.replyToken(req.id), 'message', 'שלום'), { ok: false, error: 'not_paid' });
  });

  it('reminders: tomorrow\'s confirmed bookings at paid clinics with an email get one reminder; others are skipped', async () => {
    const paid = await clinic(true);
    const free = await clinic(false);
    const { ilDateKey, addDays, ilToUtc } = await import('../../src/lib/time');
    const now = new Date();
    const tomorrow = ilToUtc(addDays(ilDateKey(now), 1), '11:00');
    const later = ilToUtc(addDays(ilDateKey(now), 3), '11:00');
    const mk = (branchId: string, n: number, extra: object) => db.booking.create({ data: { ref: `BF-${tag.slice(-5)}${n}`, branchId, clientName: 'מיכל', clientPhone: '+972521112255', durationMin: 60, status: 'confirmed', policyShown: {}, startsAt: tomorrow, ...extra } });
    const due = await mk(paid.branch.id, 1, { clientEmail: `michal-${tag}@example.test` });
    const noEmail = await mk(paid.branch.id, 2, {});
    const freeBk = await mk(free.branch.id, 3, { clientEmail: `free-${tag}@example.test` });
    const notTomorrow = await mk(paid.branch.id, 4, { clientEmail: `later-${tag}@example.test`, startsAt: later });
    const cancelled = await mk(paid.branch.id, 5, { clientEmail: `c-${tag}@example.test`, status: 'cancelled_client' });

    const { runReminders } = await import('../../src/lib/server/reminders');
    const emails = mock.emails.length;
    const run = await runReminders(now);
    assert.equal(run.emailOn, true);
    const mine = mock.emails.slice(emails).filter(e => e.to[0].includes(tag));
    assert.deepEqual(mine.map(e => e.to[0]), [`michal-${tag}@example.test`]);
    assert.match(mine[0].subject, /תזכורת: התור שלך בקליניקה בתשלום מחר/);
    assert.match(mine[0].text, /בשעה 11:00/);
    assert.match(mine[0].text, /כתובת: רחוב 1, חיפה/);
    // A client with no email gets the reminder by SMS (automations.reminderSms, on by default).
    assert.ok(mock.sms.some(s => s.To === noEmail.clientPhone && /תזכורת/.test(s.Body)), 'the client without an email got an SMS');
    assert.equal(run.sentSms, 1);
    const rows = await db.booking.findMany({ where: { id: { in: [due.id, noEmail.id, freeBk.id, notTomorrow.id, cancelled.id] } }, select: { id: true, remindedAt: true } });
    assert.deepEqual(rows.filter(r => r.remindedAt).map(r => r.id).sort(), [due.id, noEmail.id].sort());
    await runReminders(now);
    assert.equal(mock.emails.slice(emails).filter(e => e.to[0].includes(tag)).length, 1, 'never twice');
  });

  it('reminders do nothing while email is off', async () => {
    const cur = (await settings.platformSettings()).email;
    await settings.savePlatformSettings(userId, { email: { ...cur, enabled: false } });
    const { runReminders } = await import('../../src/lib/server/reminders');
    const run = await runReminders();
    assert.equal(run.emailOn, false);
    assert.equal(run.sent, 0);
    await settings.savePlatformSettings(userId, { email: { ...cur, enabled: true } });
  });

  it('delivery tracking: signed Resend events update the send; a bounce keeps its reason; a late "sent" does not undo "delivered"', async () => {
    const { POST } = await import('../../src/app/api/resend/webhook/route');
    const { svixSignature } = await import('../../src/lib/vendors/resend');
    const email = await import('../../src/lib/server/email');
    const req = (body: object, secret = HOOK) => {
      const raw = JSON.stringify(body);
      const id = `msg_${Math.random().toString(36).slice(2)}`;
      const ts = String(Math.floor(Date.now() / 1000));
      return new Request('https://beautyfind.example/api/resend/webhook', { method: 'POST', headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${svixSignature(secret, id, ts, raw)}` }, body: raw });
    };
    assert.equal((await POST(req({}))).status, 503, 'no secret yet');
    assert.equal((await email.saveResendWebhookSecret('nope', userId)).ok, false);
    assert.equal((await email.saveResendWebhookSecret(HOOK, userId)).ok, true);

    const { messaging } = await import('../../src/lib/vendors/messaging');
    const a = await messaging().send({ channel: 'email', to: `track-${tag}@example.test`, template: 'M_contact_receipt', vars: { ref: 'C-1', reason: 'general' }, kind: 'service' });
    const b = await messaging().send({ channel: 'email', to: `bounce-${tag}@example.test`, template: 'M_contact_receipt', vars: { ref: 'C-2', reason: 'general' }, kind: 'service' });

    assert.equal((await POST(req({ type: 'email.delivered', data: { email_id: a.id } }, 'whsec_' + Buffer.from('wrong-secret-wrong-secret').toString('base64')))).status, 403);
    assert.equal((await POST(req({ type: 'email.delivered', data: { email_id: a.id } }))).status, 204);
    assert.equal((await POST(req({ type: 'email.sent', data: { email_id: a.id } }))).status, 204);
    assert.equal((await POST(req({ type: 'email.bounced', data: { email_id: b.id, bounce: { message: 'Mailbox does not exist' } } }))).status, 204);
    assert.equal((await POST(req({ type: 'email.opened', data: { email_id: b.id } }))).status, 204);

    const ra = await db.messageSend.findFirst({ where: { provider: 'resend', providerId: a.id } });
    assert.equal(ra?.deliveryStatus, 'delivered');
    assert.ok(ra?.deliveredAt);
    const rb = await db.messageSend.findFirst({ where: { provider: 'resend', providerId: b.id } });
    assert.equal(rb?.deliveryStatus, 'bounced');
    assert.equal(rb?.deliveryError, 'Mailbox does not exist');
    const st = await email.emailStatus();
    assert.equal(st.hookConfigured, true);
    assert.equal(st.hookUrl, 'https://beautyfind.example/api/resend/webhook');
    assert.ok(st.delivered24h >= 1 && st.bounced24h >= 1);
  });
});
