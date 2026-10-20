import 'server-only';
import { maskPhone } from '../vendors/messaggio';
import { TwilioError, isAccountSid, twilioAccount, twilioSend, type TwilioConfig } from '../vendors/twilio';
import { db } from './db';
import { platformSettings, type PlatformSettings } from './platformSettings';
import { open, seal } from './secure';
import { siteUrl } from './site';

// Twilio as the SMS provider for verification codes. Settings and credentials on /ops/messages. The Account SID
// and Auth Token are stored together, encrypted with DATA_KEY (platform_secrets); TWILIO_ACCOUNT_SID plus
// TWILIO_AUTH_TOKEN on Vercel win. Every send is a row in message_sends; Twilio's status callbacks
// (/api/twilio/status) fill in whether the phone actually received it.

const SECRET_KEY = 'twilio_credentials';
export type KeySource = 'env' | 'admin';
export interface TwilioCreds { accountSid: string; authToken: string; source: KeySource }

export async function twilioCreds(): Promise<TwilioCreds | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (sid && token) return { accountSid: sid, authToken: token, source: 'env' };
  const row = await db.platformSecret.findUnique({ where: { key: SECRET_KEY } }).catch(() => null);
  if (!row) return null;
  try {
    const v = open<{ accountSid: string; authToken: string }>(row.valueEnc);
    return v?.accountSid && v.authToken ? { ...v, source: 'admin' } : null;
  } catch {
    return null;
  }
}

/** Stores the Account SID and Auth Token encrypted. The SID is kept readable as the label (it is not a secret). */
export async function saveTwilioCreds(accountSid: string, authToken: string, actorId: string): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const sid = accountSid.trim();
  const token = authToken.trim();
  if (!isAccountSid(sid)) return { ok: false, error: 'Account SID לא תקין: מתחיל ב־AC ואחריו 32 תווים' };
  if (!/^[0-9a-f]{32}$/i.test(token)) return { ok: false, error: 'Auth Token לא תקין: 32 תווים (ספרות ו־a עד f)' };
  const valueEnc = seal({ accountSid: sid, authToken: token });
  await db.platformSecret.upsert({ where: { key: SECRET_KEY }, create: { key: SECRET_KEY, valueEnc, label: sid, updatedById: actorId }, update: { valueEnc, label: sid, updatedById: actorId } });
  return { ok: true, label: sid };
}

export async function removeTwilioCreds(): Promise<void> {
  await db.platformSecret.deleteMany({ where: { key: SECRET_KEY } });
}

/** Where Twilio reports delivery. Only on a public https address; a local or preview site gets no callback. */
export function twilioStatusUrl(): string | undefined {
  const base = siteUrl().replace(/\/+$/, '');
  return base.startsWith('https://') && !/localhost|127\.0\.0\.1/.test(base) ? `${base}/api/twilio/status` : undefined;
}

export const twilioConfig = (c: TwilioCreds, s: PlatformSettings['twilio']): TwilioConfig => ({
  accountSid: c.accountSid,
  authToken: c.authToken,
  from: s.from,
  messagingServiceSid: s.messagingServiceSid,
  statusCallback: twilioStatusUrl(),
  baseUrl: process.env.NODE_ENV !== 'production' ? process.env.TWILIO_TEST_BASE : undefined,
});

/** Twilio is used when it is on, has credentials and a sender. */
export async function twilioReady(force = false): Promise<TwilioConfig | null> {
  const [s, c] = await Promise.all([platformSettings(), twilioCreds()]);
  if (!c || (!s.twilio.enabled && !force)) return null;
  if (!s.twilio.from && !s.twilio.messagingServiceSid) return null;
  return twilioConfig(c, s.twilio);
}

/** One SMS through Twilio, logged. Throws TwilioError. */
export async function twilioAttempt(cfg: TwilioConfig, msg: { to: string; template: string }, text: string, extra: { fallbackFrom?: string; test?: boolean } = {}): Promise<{ id: string }> {
  try {
    const r = await twilioSend(cfg, msg.to, text);
    await db.messageSend.create({ data: { provider: 'twilio', channel: 'sms', template: msg.template, toMasked: maskPhone(msg.to), status: 'sent', providerId: r.id, deliveryStatus: r.status, fallbackFrom: extra.fallbackFrom ?? null, test: !!extra.test } }).catch(() => undefined);
    return { id: r.id };
  } catch (e) {
    await db.messageSend.create({ data: { provider: 'twilio', channel: 'sms', template: msg.template, toMasked: maskPhone(msg.to), status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 300), fallbackFrom: extra.fallbackFrom ?? null, test: !!extra.test } }).catch(() => undefined);
    throw e;
  }
}

/** Admin check: reads the account with the stored credentials. Sends nothing. */
export async function twilioCheck(): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const [s, c] = await Promise.all([platformSettings(), twilioCreds()]);
  if (!c) return { ok: false, error: 'לא הוזנו Account SID ו־Auth Token' };
  try {
    const a = await twilioAccount(twilioConfig(c, s.twilio));
    const trial = a.type.toLowerCase() === 'trial';
    return { ok: true, text: `החיבור תקין: ${a.name || c.accountSid} · ${a.status}${trial ? ' · חשבון ניסיון: אפשר לשלוח רק למספרים מאומתים ב־Twilio' : ''}` };
  } catch (e) {
    return { ok: false, error: e instanceof TwilioError && e.status === 401 ? 'Twilio דחה את הפרטים (401): בדקו את ה־Account SID וה־Auth Token' : e instanceof Error ? e.message : String(e) };
  }
}

/** Admin test: one real SMS to the phone entered, whatever the on switch says. */
export async function twilioTestSend(to: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const cfg = await twilioReady(true);
  if (!cfg) return { ok: false, error: 'חסרים פרטי חשבון או שולח (From / Messaging Service SID)' };
  try {
    const code = String(100000 + Math.floor(Math.random() * 900000));
    const r = await twilioAttempt(cfg, { to, template: 'twilio_test' }, `הודעת בדיקה מ-BeautyFind: החיבור ל-Twilio עובד. קוד לדוגמה: ${code}`, { test: true });
    return { ok: true, id: r.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Applies one status callback to its send. Unknown SIDs are ignored. */
export async function applyTwilioStatus(p: Record<string, string>): Promise<boolean> {
  const sid = p.MessageSid || p.SmsSid;
  const status = p.MessageStatus || p.SmsStatus;
  if (!sid || !status) return false;
  const err = p.ErrorCode ? `${p.ErrorCode}${p.ErrorMessage ? `: ${p.ErrorMessage}` : ''}` : null;
  const r = await db.messageSend.updateMany({
    where: { provider: 'twilio', providerId: sid },
    data: { deliveryStatus: status.slice(0, 20), ...(err ? { deliveryError: err.slice(0, 300) } : {}), ...(status === 'delivered' ? { deliveredAt: new Date() } : {}) },
  });
  return r.count > 0;
}

export interface TwilioStatus {
  configured: boolean;
  keySource: KeySource | null;
  accountSid: string | null;
  settings: PlatformSettings['twilio'];
  ready: boolean;
  callback: string | null;
  sent24h: number;
  failed24h: number;
  delivered24h: number;
  undelivered24h: number;
}

export async function twilioStatus(): Promise<TwilioStatus> {
  const since = new Date(Date.now() - 86_400_000);
  const w = (x: object) => db.messageSend.count({ where: { provider: 'twilio', test: false, createdAt: { gte: since }, ...x } });
  const [s, c, sent24h, failed24h, delivered24h, undelivered24h] = await Promise.all([
    platformSettings(), twilioCreds(), w({ status: 'sent' }), w({ status: 'failed' }), w({ deliveryStatus: 'delivered' }), w({ deliveryStatus: { in: ['undelivered', 'failed'] } }),
  ]);
  return {
    configured: !!c,
    keySource: c?.source ?? null,
    accountSid: c?.accountSid ?? null,
    settings: s.twilio,
    ready: !!c && s.twilio.enabled && !!(s.twilio.from || s.twilio.messagingServiceSid),
    callback: twilioStatusUrl() ?? null,
    sent24h, failed24h, delivered24h, undelivered24h,
  };
}
