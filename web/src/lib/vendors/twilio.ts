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
// Voice (the ownership claim's "שיחה קולית"): POST {base}/2010-04-01/Accounts/{AccountSid}/Calls.json with To, From
// (a Twilio phone number with voice), Twiml (what the call says) and StatusCallback. Answer: the Call resource (CA…).

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

export const isPhone = (v: string) => /^\+[1-9]\d{6,14}$/.test(v);

/** The digits read one by one, so a text-to-speech voice does not read "123456" as a number. */
export const spokenDigits = (code: string) => code.replace(/\D/g, '').split('').join(', ');

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** What the verification call says: the code twice, digit by digit, in Hebrew. */
export function voiceTwiml(code: string, voice: string): string {
  const say = (t: string) => `<Say voice="${xml(voice)}" language="he-IL">${xml(t)}</Say>`;
  const digits = spokenDigits(code);
  return `<Response><Pause length="1"/>${say(`שלום, זו שיחה מ-BeautyFind. קוד האימות שלך הוא: ${digits}.`)}<Pause length="1"/>${say(`שוב, הקוד הוא: ${digits}.`)}<Pause length="1"/>${say('תודה, להתראות.')}</Response>`;
}

/** The form body of one verification call. */
export function twilioCallForm(c: TwilioConfig & { voiceFrom: string }, to: string, twiml: string): URLSearchParams {
  const f = new URLSearchParams({ To: to, From: c.voiceFrom, Twiml: twiml });
  if (c.statusCallback) f.set('StatusCallback', c.statusCallback);
  return f;
}

/** Places one call that reads the code. Returns the call SID; throws TwilioError. */
export async function twilioCall(c: TwilioConfig & { voiceFrom: string }, to: string, twiml: string): Promise<{ id: string; status: string | null }> {
  if (!isPhone(to)) throw new TwilioError('invalid phone number', 400);
  if (!isPhone(c.voiceFrom)) throw new TwilioError('no voice number configured (a Twilio phone number)', 400);
  const r = await fetch(`${base(c)}/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}/Calls.json`, {
    method: 'POST',
    headers: { authorization: auth(c), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: twilioCallForm(c, to, twiml),
    signal: AbortSignal.timeout(15_000),
  }).catch(e => { throw new TwilioError(`network: ${e instanceof Error ? e.message : String(e)}`, 0); });
  const j = await parse(r);
  if (!r.ok) fail(r, j);
  return { id: typeof j.sid === 'string' ? j.sid : 'accepted', status: typeof j.status === 'string' ? j.status : null };
}

export interface TwilioNumber { phone: string; name: string; voice: boolean; sms: boolean }

/** The phone numbers the account owns, with what each can do. GET .../IncomingPhoneNumbers.json. Sends nothing. */
export async function twilioNumbers(c: TwilioConfig): Promise<TwilioNumber[]> {
  const r = await fetch(`${base(c)}/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}/IncomingPhoneNumbers.json?PageSize=100`, {
    headers: { authorization: auth(c), accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  }).catch(e => { throw new TwilioError(`network: ${e instanceof Error ? e.message : String(e)}`, 0); });
  const j = await parse(r);
  if (!r.ok) fail(r, j);
  const list = Array.isArray(j.incoming_phone_numbers) ? (j.incoming_phone_numbers as Array<Record<string, unknown>>) : [];
  return list.map(n => {
    const cap = (n.capabilities ?? {}) as Record<string, unknown>;
    return { phone: String(n.phone_number ?? ''), name: String(n.friendly_name ?? ''), voice: cap.voice === true, sms: cap.sms === true || cap.SMS === true };
  }).filter(n => isPhone(n.phone));
}

/**
 * Whether the account may call ordinary numbers in a country (Voice Geo permissions):
 * GET https://voice.twilio.com/v1/DialingPermissions/Countries/{ISO}, field low_risk_numbers_enabled. Null when unknown.
 */
export async function twilioVoiceCountry(c: TwilioConfig, iso: string): Promise<boolean | null> {
  const root = c.baseUrl ? base(c) : 'https://voice.twilio.com';
  const r = await fetch(`${root}/v1/DialingPermissions/Countries/${encodeURIComponent(iso)}`, {
    headers: { authorization: auth(c), accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = await parse(r);
  return typeof j.low_risk_numbers_enabled === 'boolean' ? j.low_risk_numbers_enabled : null;
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

// ---------- WhatsApp (same account) ----------
// Send: the Messages endpoint with From=whatsapp:+972…, To=whatsapp:+972…, ContentSid (an approved Content template,
// HX…) and ContentVariables (JSON {"1": "…"}). Delivery reports arrive on the same StatusCallback, with "read".
// Templates: Content API at content.twilio.com. POST /v1/Content creates one, POST /v1/Content/{sid}/ApprovalRequests/whatsapp
// submits it to Meta ({ name, category }), GET /v1/Content/{sid}/ApprovalRequests reads the result.
// Senders: GET messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp lists the account's WhatsApp numbers.

export const CONTENT_BASE = 'https://content.twilio.com';
export const MESSAGING_BASE = 'https://messaging.twilio.com';

async function twilioJson(c: TwilioConfig, url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const r = await fetch(url, {
    ...init,
    headers: { authorization: auth(c), accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  }).catch(e => { throw new TwilioError(`network: ${e instanceof Error ? e.message : String(e)}`, 0); });
  const j = await parse(r);
  if (!r.ok) fail(r, j);
  return j;
}

const contentBase = (c: TwilioConfig) => (c.baseUrl ?? CONTENT_BASE).replace(/\/+$/, '');
const messagingBase = (c: TwilioConfig) => (c.baseUrl ?? MESSAGING_BASE).replace(/\/+$/, '');

/** Sends one WhatsApp template message. Returns the message SID; throws TwilioError. */
export async function twilioSendWhatsApp(c: TwilioConfig, from: string, to: string, contentSid: string, variables: Record<string, string>): Promise<{ id: string; status: string | null }> {
  if (!isPhone(to)) throw new TwilioError('invalid phone number', 400);
  if (!isPhone(from)) throw new TwilioError('no WhatsApp sender configured', 400);
  const f = new URLSearchParams({ To: `whatsapp:${to}`, From: `whatsapp:${from}`, ContentSid: contentSid, ContentVariables: JSON.stringify(variables) });
  if (c.statusCallback) f.set('StatusCallback', c.statusCallback);
  const r = await fetch(`${base(c)}/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}/Messages.json`, {
    method: 'POST',
    headers: { authorization: auth(c), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: f,
    signal: AbortSignal.timeout(15_000),
  }).catch(e => { throw new TwilioError(`network: ${e instanceof Error ? e.message : String(e)}`, 0); });
  const j = await parse(r);
  if (!r.ok) fail(r, j);
  return { id: typeof j.sid === 'string' ? j.sid : 'accepted', status: typeof j.status === 'string' ? j.status : null };
}

/** Creates a twilio/text Content template ({{1}} style variables, with sample values). Returns its HX SID. */
export async function twilioCreateContent(c: TwilioConfig, t: { friendlyName: string; language: string; body: string; samples: Record<string, string> }): Promise<string> {
  const j = await twilioJson(c, `${contentBase(c)}/v1/Content`, {
    method: 'POST',
    body: JSON.stringify({ friendly_name: t.friendlyName, language: t.language, variables: t.samples, types: { 'twilio/text': { body: t.body } } }),
  });
  if (typeof j.sid !== 'string') throw new TwilioError('no content sid returned', 500);
  return j.sid;
}

/** Submits a Content template to Meta for WhatsApp approval. */
export async function twilioSubmitWhatsApp(c: TwilioConfig, sid: string, name: string, category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'): Promise<{ status: string }> {
  const j = await twilioJson(c, `${contentBase(c)}/v1/Content/${encodeURIComponent(sid)}/ApprovalRequests/whatsapp`, { method: 'POST', body: JSON.stringify({ name, category }) });
  return { status: typeof j.status === 'string' ? j.status : 'received' };
}

/** The WhatsApp approval state of a Content template: approved, pending, received, rejected, paused, disabled or unsubmitted. */
export async function twilioWhatsAppApproval(c: TwilioConfig, sid: string): Promise<{ status: string; reason: string | null }> {
  const j = await twilioJson(c, `${contentBase(c)}/v1/Content/${encodeURIComponent(sid)}/ApprovalRequests`);
  const w = (j.whatsapp && typeof j.whatsapp === 'object' ? j.whatsapp : j) as Record<string, unknown>;
  const reason = typeof w.rejection_reason === 'string' && w.rejection_reason ? w.rejection_reason : null;
  return { status: typeof w.status === 'string' && w.status ? w.status.toLowerCase() : 'unsubmitted', reason };
}

/** The account's WhatsApp senders (E.164 number and status, e.g. ONLINE). */
export async function twilioWhatsAppSenders(c: TwilioConfig): Promise<Array<{ phone: string; status: string; name: string | null }>> {
  const j = await twilioJson(c, `${messagingBase(c)}/v2/Channels/Senders?Channel=whatsapp&PageSize=50`);
  const list = Array.isArray(j.senders) ? (j.senders as Array<Record<string, unknown>>) : [];
  return list.map(s => {
    const profile = (s.profile && typeof s.profile === 'object' ? s.profile : {}) as Record<string, unknown>;
    return { phone: String(s.sender_id ?? '').replace(/^whatsapp:/, ''), status: String(s.status ?? ''), name: typeof profile.name === 'string' ? profile.name : null };
  }).filter(s => isPhone(s.phone));
}
