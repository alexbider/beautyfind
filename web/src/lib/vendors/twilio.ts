import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Twilio Programmable Messaging for SMS verification codes. The site keeps generating and checking its own codes
// (src/lib/server/otp.ts); Twilio only delivers the text.
//
// Send: POST {base}/2010-04-01/Accounts/{AccountSid}/Messages.json, HTTP Basic auth (Account SID : Auth Token),
// form fields To, Body, and either From (a Twilio number or an approved alphanumeric sender ID) or
// MessagingServiceSid (MG…), plus StatusCallback for delivery reports. Answer: the Message resource, whose `sid`
// (SM…) identifies it. Errors: JSON { code, message, more_info, status }.
// Credentials check: GET {base}/2010-04-01/Accounts/{AccountSid}.json (sends nothing, costs nothing).

export const TWILIO_BASE = 'https://api.twilio.com';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  from: string; // E.164 number or alphanumeric sender ID; empty when messagingServiceSid is set
  messagingServiceSid: string;
  statusCallback?: string;
  baseUrl?: string; // tests only
}

export class TwilioError extends Error {
  constructor(message: string, readonly status: number, readonly code: number | null = null) { super(message); }
}

export const isAccountSid = (v: string) => /^AC[0-9a-f]{32}$/i.test(v);
export const isServiceSid = (v: string) => /^MG[0-9a-f]{32}$/i.test(v);
/** A Twilio sender: an E.164 number, or an alphanumeric sender ID (1 to 11 characters, at least one letter). */
export const isSender = (v: string) => /^\+[1-9]\d{6,14}$/.test(v) || (/^[A-Za-z0-9 ]{1,11}$/.test(v) && /[A-Za-z]/.test(v));

const auth = (c: TwilioConfig) => `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64')}`;
const base = (c: TwilioConfig) => (c.baseUrl ?? TWILIO_BASE).replace(/\/+$/, '');

async function parse(r: Response): Promise<Record<string, unknown>> {
  const raw = await r.text();
  try { return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}; } catch { return { message: raw.slice(0, 200) }; }
}

function fail(r: Response, j: Record<string, unknown>): never {
  const code = typeof j.code === 'number' ? j.code : null;
  const msg = typeof j.message === 'string' ? j.message : `HTTP ${r.status}`;
  throw new TwilioError(`${code ? `${code}: ` : ''}${msg}`.slice(0, 300), r.status, code);
}

/** The form body of one SMS. */
export function twilioForm(c: TwilioConfig, to: string, body: string): URLSearchParams {
  const f = new URLSearchParams({ To: to, Body: body });
  if (c.messagingServiceSid) f.set('MessagingServiceSid', c.messagingServiceSid);
  else f.set('From', c.from);
  if (c.statusCallback) f.set('StatusCallback', c.statusCallback);
  return f;
}

/** Sends one SMS. Returns the message SID; throws TwilioError with Twilio's code and message. */
export async function twilioSend(c: TwilioConfig, to: string, body: string): Promise<{ id: string; status: string | null }> {
  if (!/^\+[1-9]\d{6,14}$/.test(to)) throw new TwilioError('invalid phone number', 400);
  if (!c.messagingServiceSid && !c.from) throw new TwilioError('no sender configured (From or Messaging Service SID)', 400);
  const r = await fetch(`${base(c)}/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}/Messages.json`, {
    method: 'POST',
    headers: { authorization: auth(c), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: twilioForm(c, to, body),
    signal: AbortSignal.timeout(15_000),
  }).catch(e => { throw new TwilioError(`network: ${e instanceof Error ? e.message : String(e)}`, 0); });
  const j = await parse(r);
  if (!r.ok) fail(r, j);
  return { id: typeof j.sid === 'string' ? j.sid : 'accepted', status: typeof j.status === 'string' ? j.status : null };
}

/** Checks the credentials by reading the account. Sends nothing. */
export async function twilioAccount(c: TwilioConfig): Promise<{ name: string; status: string; type: string }> {
  const r = await fetch(`${base(c)}/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}.json`, {
    headers: { authorization: auth(c), accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  }).catch(e => { throw new TwilioError(`network: ${e instanceof Error ? e.message : String(e)}`, 0); });
  const j = await parse(r);
  if (!r.ok) fail(r, j);
  return { name: String(j.friendly_name ?? ''), status: String(j.status ?? ''), type: String(j.type ?? '') };
}

/**
 * Twilio's webhook signature: base64 HMAC-SHA1, keyed with the Auth Token, of the full URL followed by every POST
 * parameter name and value, sorted by name. Compared in constant time.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

export function validTwilioSignature(authToken: string, url: string, params: Record<string, string>, given: string | null): boolean {
  if (!given) return false;
  const want = Buffer.from(twilioSignature(authToken, url, params));
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got);
}
