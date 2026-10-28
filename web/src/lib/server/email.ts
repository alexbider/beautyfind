import 'server-only';
import { emailBody, renderMessage } from '../messages/render';
import { ResendError, emailDomain, fromAddress, isResendKey, maskEmail, resendDomains, resendSend, type ResendConfig } from '../vendors/resend';
import { db } from './db';
import { newReplyToken, replyAddress, resolveRecipient, type Recipient } from './emailRecipients';
import { platformSettings, type PlatformSettings } from './platformSettings';
import { open, seal } from './secure';
import { siteUrl } from './site';

// Email through Resend. Settings and the API key on /ops/messages; the key is stored encrypted with DATA_KEY
// (platform_secrets) or set as RESEND_API_KEY on Vercel, which wins. Every send is a row in message_sends with the
// address masked and who it went to (src/lib/server/emailRecipients.ts); the message body is never stored or logged.
// Opens, clicks and replies are tracked on /ops/emails (src/lib/server/emailTracking.ts).

const SECRET_KEY = 'resend_api_key';
export type KeySource = 'env' | 'admin';

export async function resendKey(): Promise<{ key: string; source: KeySource } | null> {
  const env = process.env.RESEND_API_KEY?.trim();
  if (env) return { key: env, source: 'env' };
  const row = await db.platformSecret.findUnique({ where: { key: SECRET_KEY } }).catch(() => null);
  if (!row) return null;
  try {
    const key = open<string>(row.valueEnc);
    return key ? { key, source: 'admin' } : null;
  } catch {
    return null;
  }
}

export async function saveResendKey(raw: string, actorId: string): Promise<{ ok: true; hint: string } | { ok: false; error: string }> {
  const key = raw.trim();
  if (!isResendKey(key)) return { ok: false, error: 'מפתח API לא תקין: מתחיל ב־re_' };
  const hint = `re_•••${key.slice(-4)}`;
  await db.platformSecret.upsert({ where: { key: SECRET_KEY }, create: { key: SECRET_KEY, valueEnc: seal(key), label: hint, updatedById: actorId }, update: { valueEnc: seal(key), label: hint, updatedById: actorId } });
  return { ok: true, hint };
}

export async function removeResendKey(): Promise<void> {
  await db.platformSecret.deleteMany({ where: { key: SECRET_KEY } });
}

const configOf = (key: string, s: PlatformSettings['email']): ResendConfig => ({
  apiKey: key, from: s.from, replyTo: s.replyTo, replyDomain: s.replyDomain || undefined,
  baseUrl: process.env.NODE_ENV !== 'production' ? process.env.RESEND_TEST_BASE : undefined,
});

/** Resend is used when it is on, has a key and a valid from address. */
export async function emailReady(force = false): Promise<ResendConfig | null> {
  const [s, k] = await Promise.all([platformSettings(), resendKey()]);
  if (!k || (!s.email.enabled && !force) || !fromAddress(s.email.from)) return null;
  return configOf(k.key, s.email);
}

/** The display name of the from address ("BeautyFind" in "BeautyFind <noreply@…>"). */
const senderName = (from: string) => from.match(/^\s*"?([^"<]{1,80}?)"?\s*</)?.[1]?.trim() || 'BeautyFind';
const tagValue = (v: string) => v.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) || 'none';

/** One email, logged with who it went to and, when reply tracking is on, its own reply address. Throws ResendError. */
export async function emailAttempt(cfg: ResendConfig, msg: { to: string; template: string }, mail: { subject: string; html: string; text: string }, extra: { test?: boolean } = {}): Promise<{ id: string }> {
  const token = cfg.replyDomain ? newReplyToken() : null;
  const who: Promise<Recipient | null> = resolveRecipient(msg.to).catch(() => null);
  const log = async (data: { status: string; providerId?: string; error?: string }) => {
    const r = await who;
    await db.messageSend.create({
      data: {
        provider: 'resend', channel: 'email', template: msg.template, toMasked: maskEmail(msg.to), status: data.status, providerId: data.providerId ?? null,
        error: data.error?.slice(0, 300) ?? null, test: !!extra.test, audience: r?.audience ?? null, userId: r?.userId ?? null, businessId: r?.businessId ?? null,
        replyToken: data.status === 'sent' ? token : null,
      },
    }).catch(() => undefined);
  };
  try {
    const r = await resendSend(cfg, msg.to, mail, {
      ...(token && cfg.replyDomain ? { replyTo: `${senderName(cfg.from)} <${replyAddress(token, cfg.replyDomain)}>` } : {}),
      tags: [{ name: 'template', value: tagValue(msg.template) }, ...(extra.test ? [{ name: 'test', value: '1' }] : [])],
    });
    await log({ status: 'sent', providerId: r.id });
    return r;
  } catch (e) {
    await log({ status: 'failed', error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** Renders a template and sends it. Null when the template has no email text. */
export async function sendTemplateEmail(cfg: ResendConfig, msg: { to: string; template: string; vars: Record<string, string> }, extra: { test?: boolean } = {}): Promise<{ id: string } | null> {
  const r = renderMessage(msg.template, msg.vars, siteUrl());
  if (!r) return null;
  return emailAttempt(cfg, msg, { subject: r.subject, ...emailBody(r) }, extra);
}

/** Admin test: one real email to the address entered, whatever the switch says. */
export async function emailTestSend(to: string, template = 'email_test'): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const cfg = await emailReady(true);
  if (!cfg) return { ok: false, error: 'חסר מפתח API של Resend או כתובת שולח תקינה' };
  try {
    if (template !== 'email_test') {
      // A real template with its sample data (src/lib/messages/samples.ts), subject marked as a sample.
      const { SAMPLES } = await import('../messages/samples');
      const sample = SAMPLES.find(x => x.id === template);
      if (!sample) return { ok: false, error: 'תבנית לא מוכרת' };
      const r = renderMessage(sample.id, sample.vars, siteUrl());
      if (!r) return { ok: false, error: 'no template' };
      const sent = await emailAttempt(cfg, { to, template: sample.id }, { ...emailBody(r), subject: `[דוגמה] ${r.subject}` }, { test: true });
      return { ok: true, id: sent.id };
    }
    const r = await sendTemplateEmail(cfg, { to, template: 'email_test', vars: {} }, { test: true });
    return r ? { ok: true, id: r.id } : { ok: false, error: 'no template' };
  } catch (e) {
    return { ok: false, error: e instanceof ResendError && e.status === 403 && /domain/i.test(e.message) ? `${e.message}. הדומיין של כתובת השולח לא מאומת ב־Resend` : e instanceof Error ? e.message : String(e) };
  }
}

/** Admin check: is the from address on a domain Resend has verified. Sends nothing. */
export async function emailDomainCheck(): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const [s, k] = await Promise.all([platformSettings(), resendKey()]);
  if (!k) return { ok: false, error: 'לא הוזן מפתח API של Resend' };
  const from = fromAddress(s.email.from);
  if (!from) return { ok: false, error: 'כתובת השולח לא תקינה' };
  const domain = emailDomain(from);
  try {
    const list = await resendDomains(configOf(k.key, s.email));
    const d = list.find(x => x.name === domain);
    if (!d) return { ok: false, error: `הדומיין ${domain} לא נוסף ל־Resend. הוסיפו אותו ב־Resend, Domains, והגדירו את רשומות ה־DNS שהוא מציג` };
    if (d.status !== 'verified') return { ok: false, error: `הדומיין ${domain} עוד לא מאומת ב־Resend (מצב: ${d.status}). בדקו את רשומות ה־DNS` };
    return { ok: true, text: `הדומיין ${domain} מאומת ב־Resend. אפשר לשלוח מ־${from}` };
  } catch (e) {
    if (e instanceof ResendError && (e.status === 401 || e.status === 403)) return { ok: false, error: e.status === 401 ? 'Resend דחה את המפתח (401)' : 'המפתח מוגבל לשליחה בלבד ולא יכול לקרוא דומיינים. שלחו מייל בדיקה כדי לוודא שהשליחה עובדת' };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface EmailStatus {
  configured: boolean;
  keySource: KeySource | null;
  keyHint: string | null;
  settings: PlatformSettings['email'];
  ready: boolean;
  sent24h: number;
  failed24h: number;
  delivered24h: number;
  bounced24h: number;
  hookConfigured: boolean;
  hookUrl: string | null;
}

export async function emailStatus(): Promise<EmailStatus> {
  const since = new Date(Date.now() - 86_400_000);
  const w = (x: object) => db.messageSend.count({ where: { provider: 'resend', test: false, createdAt: { gte: since }, ...x } });
  const [s, k, row, sent24h, failed24h, delivered24h, bounced24h, hook] = await Promise.all([
    platformSettings(), resendKey(), db.platformSecret.findUnique({ where: { key: SECRET_KEY }, select: { label: true } }).catch(() => null), w({ status: 'sent' }), w({ status: 'failed' }),
    w({ deliveryStatus: 'delivered' }), w({ deliveryStatus: { in: ['bounced', 'complained', 'failed'] } }), resendWebhookSecret(),
  ]);
  return {
    configured: !!k, keySource: k?.source ?? null, keyHint: k?.source === 'env' ? 'RESEND_API_KEY' : row?.label ?? null,
    settings: s.email, ready: !!k && s.email.enabled && !!fromAddress(s.email.from), sent24h, failed24h,
    delivered24h, bounced24h, hookConfigured: !!hook, hookUrl: resendWebhookUrl(),
  };
}

// ---------- Delivery tracking (Resend webhooks) ----------

const HOOK_KEY = 'resend_webhook_secret';

export async function resendWebhookSecret(): Promise<{ secret: string; source: KeySource } | null> {
  const env = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (env) return { secret: env, source: 'env' };
  const row = await db.platformSecret.findUnique({ where: { key: HOOK_KEY } }).catch(() => null);
  if (!row) return null;
  try {
    const secret = open<string>(row.valueEnc);
    return secret ? { secret, source: 'admin' } : null;
  } catch {
    return null;
  }
}

export async function saveResendWebhookSecret(raw: string, actorId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { isWebhookSecret } = await import('../vendors/resend');
  const secret = raw.trim();
  if (!isWebhookSecret(secret)) return { ok: false, error: 'Signing secret לא תקין: מתחיל ב־whsec_' };
  await db.platformSecret.upsert({ where: { key: HOOK_KEY }, create: { key: HOOK_KEY, valueEnc: seal(secret), label: 'whsec_•••', updatedById: actorId }, update: { valueEnc: seal(secret), updatedById: actorId } });
  return { ok: true };
}

/** The address Resend posts events to. Only a public https site can receive them. */
export function resendWebhookUrl(): string | null {
  const base = siteUrl().replace(/\/+$/, '');
  return base.startsWith('https://') && !/localhost|127\.0\.0\.1/.test(base) ? `${base}/api/resend/webhook` : null;
}

/** Applies one Resend event (delivery, open, click, received reply). Kept here for older callers. */
export async function applyResendEvent(e: { type?: unknown; data?: unknown; created_at?: unknown }, eventId?: string | null): Promise<boolean> {
  const { applyEmailEvent } = await import('./emailTracking');
  return applyEmailEvent(e, eventId ?? null);
}
