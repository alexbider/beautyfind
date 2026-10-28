import 'server-only';
import { Prisma } from '@prisma/client';
import {
  ResendError, emailDomain, fromAddress, resendCreateDomain, resendCreateWebhook, resendDomain, resendDomainList, resendReceived,
  resendReceivedAttachments, resendSend, resendUpdateDomain, resendUpdateWebhook, resendVerifyDomain, resendWebhooks, type ResendDomain,
} from '../vendors/resend';
import { db } from './db';
import { emailReady, resendWebhookUrl, saveResendWebhookSecret } from './email';
import { displayName, htmlToText, resolveRecipient, safeLink, tokenOf } from './emailRecipients';
import { platformSettings, savePlatformSettings } from './platformSettings';
import { siteUrl } from './site';

// Email monitoring for /ops/emails. Resend posts every event of every email to /api/resend/webhook; each event is
// stored once in email_events (keyed by the Svix message id, so retries never count twice) and rolled up onto its
// message_sends row: delivery state, opens, clicks, replies. Replies arrive at r-<token>@<reply domain>, a subdomain
// whose MX points to Resend; the token (or the In-Reply-To header) finds the email they answer. The reply is kept as
// plain text and forwarded to the team mailbox with the sender as reply-to, so answering it reaches the business.

const FINAL = ['delivered', 'bounced', 'complained', 'failed', 'suppressed'];
const DELIVERY: Record<string, string> = {
  'email.sent': 'sent', 'email.delivered': 'delivered', 'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed', 'email.suppressed': 'suppressed',
};
/** Every event the webhook should send. */
export const WEBHOOK_EVENTS = [
  'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed',
  'email.suppressed', 'email.opened', 'email.clicked', 'email.received',
];

const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const when = (v: unknown) => {
  const d = typeof v === 'string' ? new Date(v.replace(' ', 'T')) : null;
  return d && !Number.isNaN(d.getTime()) ? d : new Date();
};

/** Stores the event once. False when this event id was already stored (a webhook retry). */
async function recordEvent(row: { id: string; sendId: string | null; providerId: string | null; type: string; at: Date; link?: string | null; detail?: string | null }): Promise<boolean> {
  try {
    await db.emailEvent.create({ data: { ...row, link: row.link ?? null, detail: row.detail?.slice(0, 300) ?? null } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false;
    throw e;
  }
}

/** Applies one Resend webhook event. Returns true when it changed something. */
export async function applyEmailEvent(e: { type?: unknown; data?: unknown; created_at?: unknown }, eventId: string | null): Promise<boolean> {
  const type = str(e.type);
  if (!type) return false;
  const d = obj(e.data);
  if (type === 'email.received') return handleReceived(d, eventId);
  const providerId = str(d.email_id);
  if (!providerId) return false;
  const at = when(e.created_at ?? d.created_at);
  const send = await db.messageSend.findFirst({ where: { provider: 'resend', providerId }, select: { id: true, messageId: true } });
  const click = obj(d.click);
  const link = type === 'email.clicked' ? safeLink(str(click.link) ?? '') : null;
  const bounce = obj(d.bounce);
  const failed = obj(d.failed);
  const reason = str(bounce.message) ?? str(failed.reason);
  const fresh = await recordEvent({ id: eventId ?? `${type}:${providerId}:${at.toISOString()}`, sendId: send?.id ?? null, providerId, type, at, link, detail: reason });
  if (!fresh || !send) return false;

  const messageId = str(d.message_id);
  if (messageId && !send.messageId) await db.messageSend.update({ where: { id: send.id }, data: { messageId: messageId.slice(0, 300) } });

  if (type === 'email.opened') {
    await db.messageSend.updateMany({ where: { id: send.id, openedAt: null }, data: { openedAt: at } });
    await db.messageSend.update({ where: { id: send.id }, data: { openCount: { increment: 1 }, lastOpenedAt: at } });
    return true;
  }
  if (type === 'email.clicked') {
    await db.messageSend.updateMany({ where: { id: send.id, clickedAt: null }, data: { clickedAt: at } });
    // A click means it was opened, even when the open pixel was blocked.
    await db.messageSend.updateMany({ where: { id: send.id, openedAt: null }, data: { openedAt: at } });
    await db.messageSend.update({ where: { id: send.id }, data: { clickCount: { increment: 1 }, lastClickedAt: at, ...(link ? { lastClickUrl: link } : {}) } });
    return true;
  }
  const status = DELIVERY[type];
  if (!status) return false;
  const r = await db.messageSend.updateMany({
    where: { id: send.id, ...(FINAL.includes(status) ? {} : { OR: [{ deliveryStatus: null }, { deliveryStatus: { notIn: FINAL } }] }) },
    data: { deliveryStatus: status, ...(reason ? { deliveryError: reason.slice(0, 300) } : {}), ...(status === 'delivered' ? { deliveredAt: at } : {}) },
  });
  return r.count > 0;
}

// ---------- Replies ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function handleReceived(d: Record<string, unknown>, eventId: string | null): Promise<boolean> {
  const resendId = str(d.email_id);
  if (!resendId) return false;
  if (await db.emailReply.findUnique({ where: { resendId }, select: { id: true } })) return false;
  const [s, cfg] = await Promise.all([platformSettings(), emailReady(true)]);
  const domain = s.email.replyDomain;
  const addresses = [...(Array.isArray(d.to) ? d.to : []), ...(Array.isArray(d.received_for) ? d.received_for : [])].filter((x): x is string => typeof x === 'string');
  const token = domain ? addresses.map(a => tokenOf(a, domain)).find(Boolean) ?? null : null;

  // The webhook carries only metadata; the body comes from the Received emails API.
  let full: Awaited<ReturnType<typeof resendReceived>> | null = null;
  let files: Awaited<ReturnType<typeof resendReceivedAttachments>> = [];
  if (cfg) {
    full = await resendReceived(cfg, resendId).catch(() => null);
    files = await resendReceivedAttachments(cfg, resendId).catch(() => []);
  }
  const fromRaw = full?.from || str(d.from) || '';
  const fromEmail = fromAddress(fromRaw) ?? fromRaw.toLowerCase().slice(0, 200);
  const subject = (full?.subject ?? str(d.subject))?.slice(0, 300) ?? null;
  const text = (full?.text?.trim() ? full.text : full?.html ? htmlToText(full.html) : '').slice(0, 20_000) || null;

  // Which email it answers: the reply token, else the Message-ID it quotes.
  let send = token ? await db.messageSend.findUnique({ where: { replyToken: token }, select: { id: true, businessId: true, userId: true, template: true } }) : null;
  if (!send) {
    const ids = `${full?.inReplyTo ?? ''} ${full?.references ?? ''}`.match(/<[^<>\s]+>/g) ?? [];
    if (ids.length) send = await db.messageSend.findFirst({ where: { provider: 'resend', messageId: { in: ids } }, select: { id: true, businessId: true, userId: true, template: true } });
  }
  const who = send?.businessId || send?.userId ? null : await resolveRecipient(fromEmail).catch(() => null);
  const receivedAt = when(d.created_at);

  let reply;
  try {
    reply = await db.emailReply.create({
      data: {
        resendId, sendId: send?.id ?? null, businessId: send?.businessId ?? who?.businessId ?? null, userId: send?.userId ?? who?.userId ?? null,
        fromEmail, fromName: displayName(fromRaw), toAddress: (addresses[0] ?? '').slice(0, 200), subject, text,
        attachments: files.map(f => ({ filename: f.filename, contentType: f.contentType, size: f.size })), receivedAt,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false;
    throw e;
  }
  if (send) await db.messageSend.update({ where: { id: send.id }, data: { replyCount: { increment: 1 }, repliedAt: receivedAt } });
  await recordEvent({ id: eventId ?? `email.received:${resendId}`, sendId: send?.id ?? null, providerId: resendId, type: 'email.received', at: receivedAt, detail: fromEmail });

  // Forward to the team mailbox. Never to an address on the reply domain itself (it would loop).
  const forwardTo = fromAddress(s.email.forwardTo);
  if (cfg && forwardTo && emailDomain(forwardTo) !== domain) {
    const name = reply.fromName || fromEmail;
    const opsLink = `${siteUrl().replace(/\/+$/, '')}/ops/emails/replies/${reply.id}`;
    const head = `תשובה מ־${name} (${fromEmail})${send ? ` למייל ${send.template}` : ', לא שויכה למייל שנשלח'}. לתשובה, השיבו למייל הזה. במערכת: ${opsLink}`;
    const bodyHtml = full?.html ?? `<pre style="white-space:pre-wrap;font-family:inherit">${esc(text ?? '')}</pre>`;
    const sender = fromAddress(cfg.from);
    try {
      await resendSend(cfg, forwardTo, {
        subject: subject ? `[תשובה] ${subject}` : '[תשובה] ללא נושא',
        text: `${head}\n\n${text ?? ''}`,
        html: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:13px;color:#555;border-bottom:1px solid #ddd;padding-bottom:8px;margin-bottom:12px">${esc(head).replace(esc(opsLink), `<a href="${esc(opsLink)}">${esc(opsLink)}</a>`)}</div>${bodyHtml}`,
      }, {
        from: `${name.replace(/[<>"]/g, '').slice(0, 60)} דרך BeautyFind <${sender}>`,
        replyTo: fromEmail,
        tags: [{ name: 'template', value: 'reply_forward' }],
        attachments: files.filter(f => f.url).slice(0, 10).map(f => ({ filename: f.filename, path: f.url! })),
      });
      await db.emailReply.update({ where: { id: reply.id }, data: { forwardedAt: new Date() } });
    } catch (e) {
      await db.emailReply.update({ where: { id: reply.id }, data: { forwardError: (e instanceof Error ? e.message : String(e)).slice(0, 300) } });
    }
  }
  return true;
}

// ---------- Setup: tracking, receiving domain, webhook ----------

export interface SetupStep { key: string; label: string; ok: boolean; note?: string }
/** A DNS record Resend asks for. `name` is as Resend gives it (relative to `domain` or already full). */
export interface DnsRecord { type: string; name: string; domain: string; value: string; priority?: number; status: string; purpose: string }
export interface SetupResult { ok: boolean; error?: string; steps: SetupStep[]; dns: DnsRecord[] }

/**
 * Turns on everything Resend can track, idempotently:
 * 1. open and click tracking on the sending domain, with the tracking subdomain links.<domain>;
 * 2. a receive-only domain reply.<domain> for reply tracking (MX to Resend; the root domain's mailbox is untouched);
 * 3. the webhook at /api/resend/webhook subscribed to every event (created, with its secret stored, when missing).
 * Returns the DNS records that still need to be in place.
 */
export async function setupEmailTracking(actorId: string): Promise<SetupResult> {
  const cfg = await emailReady(true);
  if (!cfg) return { ok: false, error: 'חסר מפתח API של Resend או כתובת שולח תקינה', steps: [], dns: [] };
  const sender = fromAddress(cfg.from)!;
  const zone = emailDomain(sender);
  const replyZone = `reply.${zone}`;
  const steps: SetupStep[] = [];
  const dns: DnsRecord[] = [];
  const fail = (e: unknown) => (e instanceof ResendError && (e.status === 401 || e.status === 403) ? 'המפתח של Resend מוגבל לשליחה. צריך מפתח עם Full access כדי להגדיר מעקב' : e instanceof Error ? e.message : String(e));
  try {
    const list = await resendDomainList(cfg);
    // 1. Tracking on the sending domain.
    const main = list.find(d => d.name === zone);
    if (!main) return { ok: false, error: `הדומיין ${zone} לא נמצא ב־Resend`, steps, dns };
    let md = await resendDomain(cfg, main.id);
    if (!md.openTracking || !md.clickTracking || !md.trackingSubdomain) {
      await resendUpdateDomain(cfg, main.id, { open_tracking: true, click_tracking: true, ...(md.trackingSubdomain ? {} : { tracking_subdomain: 'links' }) });
      md = await resendDomain(cfg, main.id);
    }
    const trackRecs = md.records.filter(r => /track/i.test(r.record) || /^links\b/.test(r.name));
    steps.push({ key: 'tracking', label: `מעקב פתיחות והקלקות ב־${zone}`, ok: md.openTracking && md.clickTracking && trackRecs.every(r => r.status === 'verified'), note: trackRecs.some(r => r.status !== 'verified') ? 'מחכה לרשומת ה־CNAME של תת־הדומיין למעקב' : undefined });
    for (const r of trackRecs) dns.push({ type: r.type, name: r.name, domain: zone, value: r.value, status: r.status, purpose: 'מעקב פתיחות והקלקות' });

    // 2. Receiving domain for replies.
    const existing = list.find(d => d.name === replyZone);
    let rd: ResendDomain = existing ? await resendDomain(cfg, existing.id) : await resendCreateDomain(cfg, { name: replyZone, capabilities: { sending: 'disabled', receiving: 'enabled' } });
    if (rd.receiving !== 'enabled') {
      await resendUpdateDomain(cfg, rd.id, { capabilities: { receiving: 'enabled' } });
      rd = await resendDomain(cfg, rd.id);
    }
    if (rd.records.some(r => r.status !== 'verified')) await resendVerifyDomain(cfg, rd.id).catch(() => undefined);
    const recvOk = rd.records.length > 0 && rd.records.every(r => r.status === 'verified');
    steps.push({ key: 'receiving', label: `קבלת תשובות ב־${replyZone}`, ok: recvOk, note: recvOk ? undefined : 'מחכה לרשומות ה־DNS של תת־הדומיין לתשובות' });
    for (const r of rd.records) dns.push({ type: r.type, name: r.name, domain: rd.name, value: r.value, priority: r.priority, status: r.status, purpose: r.type === 'MX' ? 'קבלת תשובות' : 'אימות תת־הדומיין לתשובות' });
    if (md.records.some(r => r.status !== 'verified')) await resendVerifyDomain(cfg, main.id).catch(() => undefined);

    // 3. Webhook with every event.
    const url = resendWebhookUrl();
    if (!url) {
      steps.push({ key: 'webhook', label: 'Webhook', ok: false, note: 'כתובת האתר אינה https ציבורית' });
    } else {
      const hooks = await resendWebhooks(cfg);
      const norm = (e: string) => e.replace(/\/+$/, '');
      // Other webhooks for this site (www, an old host): they would double-count every open. Their secret is not the
      // stored one either, so their requests are refused anyway.
      const ours = (e: string) => { try { const u = new URL(e); return u.pathname.replace(/\/+$/, '') === '/api/resend/webhook' && (u.hostname === zone || u.hostname.endsWith(`.${zone}`)); } catch { return false; } };
      let hook = hooks.find(h => norm(h.endpoint) === url);
      let note: string | undefined;
      if (!hook) {
        // An existing webhook on another host of ours: move it here and keep its secret.
        const variant = hooks.find(h => ours(h.endpoint) && h.status === 'enabled');
        if (variant) {
          await resendUpdateWebhook(cfg, variant.id, { endpoint: url, events: [...new Set([...variant.events, ...WEBHOOK_EVENTS])], status: 'enabled' });
          hook = { ...variant, endpoint: url, events: WEBHOOK_EVENTS, status: 'enabled' };
          note = `הכתובת עודכנה ל־${url}`;
        }
      }
      if (hook) {
        const missing = WEBHOOK_EVENTS.filter(x => !hook!.events.includes(x));
        if (missing.length || hook.status !== 'enabled') await resendUpdateWebhook(cfg, hook.id, { endpoint: hook.endpoint, events: [...new Set([...hook.events, ...WEBHOOK_EVENTS])], status: 'enabled' });
        if (missing.length) note = `נוספו: ${missing.join(', ')}`;
      } else {
        const created = await resendCreateWebhook(cfg, { endpoint: url, events: WEBHOOK_EVENTS });
        if (created.secret) await saveResendWebhookSecret(created.secret, actorId);
        hook = { id: created.id, endpoint: url, events: WEBHOOK_EVENTS, status: 'enabled' };
        note = created.secret ? 'נוצר והסוד נשמר' : 'נוצר, אבל Resend לא החזיר סוד. העתיקו אותו מ־Resend';
      }
      const dupes = hooks.filter(h => h.id !== hook!.id && ours(h.endpoint) && h.status === 'enabled');
      for (const d of dupes) await resendUpdateWebhook(cfg, d.id, { endpoint: d.endpoint, events: d.events, status: 'disabled' });
      if (dupes.length) note = `${note ? `${note}. ` : ''}הושבתו ${dupes.length} webhooks כפולים (${dupes.map(d => d.endpoint).join(', ')})`;
      steps.push({ key: 'webhook', label: 'Webhook לכל האירועים', ok: true, note });
    }

    // 4. Use the reply domain for new emails once Resend can receive on it.
    const s = await platformSettings();
    if (recvOk && s.email.replyDomain !== replyZone) await savePlatformSettings(actorId, { email: { ...s.email, replyDomain: replyZone } });
    steps.push({ key: 'reply', label: 'כתובת תשובה ייחודית לכל מייל', ok: recvOk, note: recvOk ? `התשובות מועברות ל־${s.email.forwardTo}` : 'יופעל אוטומטית אחרי שהרשומות יאומתו (הריצו שוב)' });
    return { ok: steps.every(x => x.ok), steps, dns };
  } catch (e) {
    return { ok: false, error: fail(e), steps, dns };
  }
}

// ---------- Numbers for /ops/emails ----------

export interface RateRow { key: string; sent: number; delivered: number; opened: number; clicked: number; replied: number; bounced: number; failed: number }

export function rate(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

const RANGE_SQL = (days: number) => Prisma.sql`provider = 'resend' AND test = false AND created_at >= now() - (${days} * interval '1 day')`;

const COUNTS = Prisma.sql`
  count(*) FILTER (WHERE status = 'sent')::int AS sent,
  count(*) FILTER (WHERE delivery_status = 'delivered')::int AS delivered,
  count(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened,
  count(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked,
  count(*) FILTER (WHERE replied_at IS NOT NULL)::int AS replied,
  count(*) FILTER (WHERE delivery_status IN ('bounced', 'complained', 'suppressed'))::int AS bounced,
  count(*) FILTER (WHERE status = 'failed' OR delivery_status = 'failed')::int AS failed`;

export async function emailTotals(days: number, where: { audience?: string; businessId?: string } = {}): Promise<RateRow> {
  const extra = Prisma.sql`${where.audience ? Prisma.sql` AND audience = ${where.audience}` : Prisma.empty}${where.businessId ? Prisma.sql` AND business_id = ${where.businessId}::uuid` : Prisma.empty}`;
  const rows = await db.$queryRaw<RateRow[]>`SELECT 'all' AS key, ${COUNTS} FROM message_sends WHERE ${RANGE_SQL(days)}${extra}`;
  return rows[0] ?? { key: 'all', sent: 0, delivered: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, failed: 0 };
}

export async function emailBy(field: 'template' | 'audience' | 'business', days: number, where: { audience?: string } = {}, limit = 50): Promise<RateRow[]> {
  const col = field === 'template' ? Prisma.raw('template') : field === 'audience' ? Prisma.raw(`coalesce(audience, 'other')`) : Prisma.raw('business_id::text');
  const extra = Prisma.sql`${where.audience ? Prisma.sql` AND audience = ${where.audience}` : Prisma.empty}${field === 'business' ? Prisma.sql` AND business_id IS NOT NULL` : Prisma.empty}`;
  return db.$queryRaw<RateRow[]>`SELECT ${col} AS key, ${COUNTS} FROM message_sends WHERE ${RANGE_SQL(days)}${extra} GROUP BY 1 ORDER BY sent DESC LIMIT ${limit}`;
}

export async function emailDaily(days: number): Promise<Array<{ day: Date; sent: number; opened: number; replied: number }>> {
  return db.$queryRaw`SELECT date_trunc('day', created_at AT TIME ZONE 'Asia/Jerusalem') AS day,
    count(*) FILTER (WHERE status = 'sent')::int AS sent,
    count(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened,
    count(*) FILTER (WHERE replied_at IS NOT NULL)::int AS replied
    FROM message_sends WHERE ${RANGE_SQL(days)} GROUP BY 1 ORDER BY 1`;
}

/** Status of one email as a single word for the lists, strongest signal first. */
export function emailState(m: { status: string; deliveryStatus: string | null; openedAt: Date | null; clickedAt: Date | null; repliedAt: Date | null }): { key: string; label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'navy' | 'neutral' } {
  if (m.status === 'failed' || m.deliveryStatus === 'failed') return { key: 'failed', label: 'נכשל', tone: 'bad' };
  if (m.deliveryStatus === 'bounced') return { key: 'bounced', label: 'חזר', tone: 'bad' };
  if (m.deliveryStatus === 'complained') return { key: 'complained', label: 'סומן כספאם', tone: 'bad' };
  if (m.deliveryStatus === 'suppressed') return { key: 'suppressed', label: 'חסום ב־Resend', tone: 'bad' };
  if (m.repliedAt) return { key: 'replied', label: 'ענו', tone: 'navy' };
  if (m.clickedAt) return { key: 'clicked', label: 'הקליקו', tone: 'ok' };
  if (m.openedAt) return { key: 'opened', label: 'נפתח', tone: 'ok' };
  if (m.deliveryStatus === 'delivered') return { key: 'delivered', label: 'נמסר', tone: 'info' };
  if (m.deliveryStatus === 'delayed') return { key: 'delayed', label: 'מתעכב', tone: 'warn' };
  return { key: 'sent', label: 'נשלח', tone: 'neutral' };
}

export const EVENT_LABEL: Record<string, string> = {
  'email.sent': 'נשלח ל־Resend', 'email.delivered': 'נמסר לתיבה', 'email.delivery_delayed': 'המסירה מתעכבת', 'email.bounced': 'חזר',
  'email.complained': 'סומן כספאם', 'email.failed': 'נכשל', 'email.suppressed': 'נחסם (כתובת ברשימת חסימה)', 'email.opened': 'נפתח',
  'email.clicked': 'הקלקה על קישור', 'email.received': 'התקבלה תשובה',
};
