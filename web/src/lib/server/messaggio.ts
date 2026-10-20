import 'server-only';
import { MessaggioError, maskPhone, messaggioSend, type MessaggioChannel, type MessaggioConfig } from '../vendors/messaggio';
import type { OutgoingMessage } from '../vendors/messaging';
import { db } from './db';
import { platformSettings, type PlatformSettings } from './platformSettings';
import { open, seal } from './secure';

// Messaggio as the provider for verification codes by SMS and WhatsApp (the vendor client is
// src/lib/vendors/messaggio.ts). Settings on /ops/messages; the API key is entered there and stored
// encrypted with DATA_KEY (platform_secrets), or set as MESSAGGIO_LOGIN on Vercel, which wins. Every send is a
// row in message_sends with the recipient masked; codes and message text are never stored or logged.

const SECRET_KEY = 'messaggio_login';

export type KeySource = 'env' | 'admin';

export async function messaggioLogin(): Promise<{ login: string; source: KeySource } | null> {
  const env = process.env.MESSAGGIO_LOGIN?.trim();
  if (env) return { login: env, source: 'env' };
  const row = await db.platformSecret.findUnique({ where: { key: SECRET_KEY } }).catch(() => null);
  if (!row) return null;
  try {
    const login = open<string>(row.valueEnc);
    return login ? { login, source: 'admin' } : null;
  } catch {
    return null; // DATA_KEY changed or missing: treated as not configured
  }
}

/** Stores the API key encrypted. Only its last four characters are kept readable, as a hint. */
export async function saveMessaggioLogin(raw: string, actorId: string): Promise<{ ok: true; hint: string } | { ok: false; error: string }> {
  const login = raw.trim();
  if (login.length < 8 || login.length > 500 || /\s/.test(login)) return { ok: false, error: 'מפתח API לא תקין' };
  const hint = `•••${login.slice(-4)}`;
  await db.platformSecret.upsert({ where: { key: SECRET_KEY }, create: { key: SECRET_KEY, valueEnc: seal(login), label: hint, updatedById: actorId }, update: { valueEnc: seal(login), label: hint, updatedById: actorId } });
  return { ok: true, hint };
}

export async function removeMessaggioLogin(): Promise<void> {
  await db.platformSecret.deleteMany({ where: { key: SECRET_KEY } });
}

const configOf = (login: string, s: PlatformSettings['messaggio']): MessaggioConfig => ({ login, baseUrl: s.baseUrl, smsSender: s.smsSender, whatsappSender: s.whatsappSender, whatsappTemplate: s.whatsappTemplate });

/** The verification text. Hebrew, short enough for one SMS part. */
export function verificationText(template: string, vars: Record<string, string>): string {
  if (template === 'M16_otp') return `קוד האימות שלך ב-BeautyFind: ${vars.code}. בתוקף ${vars.minutes ?? '10'} דקות. אין למסור את הקוד לאיש.`;
  return `הודעת בדיקה מ-BeautyFind: החיבור ל-Messaggio עובד. קוד לדוגמה: ${vars.code ?? '123456'}`;
}

async function log(row: { channel: string; template: string; to: string; status: 'sent' | 'failed'; providerId?: string; error?: string; fallbackFrom?: string; test?: boolean }) {
  await db.messageSend.create({ data: { provider: 'messaggio', channel: row.channel, template: row.template, toMasked: maskPhone(row.to), status: row.status, providerId: row.providerId ?? null, error: row.error?.slice(0, 300) ?? null, fallbackFrom: row.fallbackFrom ?? null, test: !!row.test } }).catch(() => undefined);
}

/** What Messaggio can send right now. Null when it is off or has no key (force: ignore the on switches). */
export async function messaggioReady(force = false): Promise<{ cfg: MessaggioConfig; whatsapp: boolean; sms: boolean; fallbackToSms: boolean } | null> {
  const [s, key] = await Promise.all([platformSettings(), messaggioLogin()]);
  if (!key || (!s.messaggio.enabled && !force)) return null;
  const m = s.messaggio;
  return { cfg: configOf(key.login, m), whatsapp: (m.whatsapp || force) && !!m.whatsappSender, sms: m.sms || force, fallbackToSms: m.fallbackToSms };
}

/** One message on one channel through Messaggio, logged. Throws MessaggioError. */
export async function messaggioAttempt(cfg: MessaggioConfig, channel: MessaggioChannel, msg: Pick<OutgoingMessage, 'to' | 'template' | 'vars'>, text: string, extra: { fallbackFrom?: string; test?: boolean } = {}): Promise<{ id: string }> {
  try {
    const r = await messaggioSend(cfg, channel, msg.to, text, msg.vars);
    await log({ channel, template: msg.template, to: msg.to, status: 'sent', providerId: r.id, ...extra });
    return r;
  } catch (e) {
    await log({ channel, template: msg.template, to: msg.to, status: 'failed', error: e instanceof Error ? e.message : String(e), ...extra });
    throw e;
  }
}

/** Kept for callers of the Messaggio-only path; verification codes go through sendVerification (verificationSend.ts). */
export async function sendViaMessaggio(msg: OutgoingMessage, opts: { test?: boolean; force?: boolean } = {}): Promise<{ id: string } | null> {
  if (msg.channel !== 'sms' && msg.channel !== 'whatsapp') return null;
  const mg = await messaggioReady(opts.force);
  if (!mg) return null;
  if (msg.channel === 'whatsapp' && !mg.whatsapp) throw new MessaggioError('no WhatsApp sender configured', 400);
  return messaggioAttempt(mg.cfg, msg.channel, msg, verificationText(msg.template, msg.vars), { test: opts.test });
}

/** Admin test: one real message to a phone the staff member enters, whatever the switches say. */
export async function messaggioTestSend(to: string, channel: MessaggioChannel): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!(await messaggioLogin())) return { ok: false, error: 'לא הוזן מפתח API של Messaggio' };
  try {
    const r = await sendViaMessaggio({ channel, to, template: 'messaggio_test', vars: { code: String(100000 + Math.floor(Math.random() * 900000)) }, kind: 'service' }, { test: true, force: true });
    return r ? { ok: true, id: r.id } : { ok: false, error: 'הערוץ כבוי' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface MessaggioStatus {
  configured: boolean;
  keySource: KeySource | null;
  keyHint: string | null;
  settings: PlatformSettings['messaggio'];
  sent24h: number;
  failed24h: number;
  lastSentAt: Date | null;
}

export async function messaggioStatus(): Promise<MessaggioStatus> {
  const since = new Date(Date.now() - 86_400_000);
  const [s, key, row, sent24h, failed24h, last] = await Promise.all([
    platformSettings(),
    messaggioLogin(),
    db.platformSecret.findUnique({ where: { key: SECRET_KEY }, select: { label: true } }).catch(() => null),
    db.messageSend.count({ where: { provider: 'messaggio', status: 'sent', createdAt: { gte: since } } }),
    db.messageSend.count({ where: { provider: 'messaggio', status: 'failed', createdAt: { gte: since } } }),
    db.messageSend.findFirst({ where: { provider: 'messaggio', status: 'sent' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);
  return {
    configured: !!key,
    keySource: key?.source ?? null,
    keyHint: key?.source === 'env' ? 'MESSAGGIO_LOGIN' : row?.label ?? null,
    settings: s.messaggio,
    sent24h,
    failed24h,
    lastSentAt: last?.createdAt ?? null,
  };
}
