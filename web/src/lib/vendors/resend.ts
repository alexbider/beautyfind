import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Resend for every email the platform sends (codes, password reset, booking confirmations, receipts, invites).
// Send: POST {base}/emails with Authorization: Bearer <API key>, JSON { from, to: [..], subject, html, text, reply_to }.
// Answer: { id }. Errors: JSON { statusCode, name, message }.
// Domains: GET {base}/domains → { data: [{ id, name, status, region }] }; status "verified" means the DNS records are
// in place. A key limited to sending cannot list domains (401/403); the check then says it is unknown.

export const RESEND_BASE = 'https://api.resend.com';

export interface ResendConfig {
  apiKey: string;
  from: string; // "BeautyFind <noreply@beautyfind.co.il>"
  replyTo: string;
  /** Reply tracking subdomain (reply.beautyfind.co.il); empty sends replies to replyTo. */
  replyDomain?: string;
  baseUrl?: string; // tests only
}

export class ResendError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export const isResendKey = (v: string) => /^re_[A-Za-z0-9_]{10,200}$/.test(v);
/** "Name <a@b.c>" or "a@b.c". */
export function fromAddress(v: string): string | null {
  const m = v.trim().match(/^(?:[^<>@]{1,80}<\s*([^\s<>@]+@[^\s<>@]+\.[^\s<>@]{2,})\s*>|([^\s<>@]+@[^\s<>@]+\.[^\s<>@]{2,}))$/);
  return m ? (m[1] ?? m[2]).toLowerCase() : null;
}
export const emailDomain = (address: string) => address.split('@')[1]?.toLowerCase() ?? '';
/** a••@domain.co.il */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '••';
  return `${local.slice(0, local.length > 2 ? 2 : 1)}••@${domain}`;
}

const base = (c: ResendConfig) => (c.baseUrl ?? RESEND_BASE).replace(/\/+$/, '');

async function call(c: ResendConfig, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const r = await fetch(`${base(c)}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${c.apiKey}`, 'content-type': 'application/json', accept: 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  }).catch(e => { throw new ResendError(`network: ${e instanceof Error ? e.message : String(e)}`, 0); });
  const raw = await r.text();
  let j: Record<string, unknown> = {};
  try { j = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}; } catch { j = { message: raw.slice(0, 200) }; }
  if (!r.ok) throw new ResendError(`${typeof j.name === 'string' ? `${j.name}: ` : ''}${typeof j.message === 'string' ? j.message : `HTTP ${r.status}`}`.slice(0, 300), r.status);
  return j;
}

export interface SendOptions {
  /** Per-email reply address (the tracked r-<token>@reply domain); falls back to the configured reply-to. */
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
  /** Files Resend downloads from a URL when it sends (forwarded reply attachments). */
  attachments?: Array<{ filename: string; path: string }>;
  /** Overrides the configured from (forwarded replies show the sender's name). */
  from?: string;
}

export function resendBody(c: ResendConfig, to: string, mail: { subject: string; html: string; text: string }, o: SendOptions = {}) {
  const replyTo = o.replyTo || c.replyTo;
  return {
    from: o.from || c.from, to: [to], subject: mail.subject, html: mail.html, text: mail.text,
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(o.tags?.length ? { tags: o.tags } : {}),
    ...(o.attachments?.length ? { attachments: o.attachments } : {}),
  };
}

/** Sends one email. Returns Resend's id; throws ResendError. */
export async function resendSend(c: ResendConfig, to: string, mail: { subject: string; html: string; text: string }, o: SendOptions = {}): Promise<{ id: string }> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) throw new ResendError('invalid email address', 400);
  if (!fromAddress(o.from || c.from)) throw new ResendError('no sender address configured', 400);
  const j = await call(c, '/emails', { method: 'POST', body: JSON.stringify(resendBody(c, to, mail, o)) });
  return { id: typeof j.id === 'string' ? j.id : 'accepted' };
}

// ---------- Receiving (replies) ----------
// GET /emails/receiving/{id} → { id, from, to, subject, html, text, headers, message_id, attachments, ... }
// GET /emails/receiving/{id}/attachments → { data: [{ id, filename, size, content_type, download_url, expires_at }] }

export interface ReceivedEmail {
  id: string;
  from: string;
  to: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []);

export async function resendReceived(c: ResendConfig, id: string): Promise<ReceivedEmail> {
  const j = await call(c, `/emails/receiving/${encodeURIComponent(id)}`);
  const h = (j.headers && typeof j.headers === 'object' ? j.headers : {}) as Record<string, unknown>;
  const header = (name: string) => {
    const k = Object.keys(h).find(x => x.toLowerCase() === name);
    return k ? (strs(h[k])[0] ?? null) : null;
  };
  return {
    id, from: str(j.from) ?? '', to: strs(j.to), subject: str(j.subject), text: str(j.text), html: str(j.html),
    messageId: str(j.message_id), inReplyTo: header('in-reply-to'), references: header('references'),
  };
}

export async function resendReceivedAttachments(c: ResendConfig, id: string): Promise<Array<{ filename: string; size: number; contentType: string; url: string | null }>> {
  const j = await call(c, `/emails/receiving/${encodeURIComponent(id)}/attachments`);
  const list = Array.isArray(j.data) ? (j.data as Array<Record<string, unknown>>) : [];
  return list.map(a => ({ filename: str(a.filename) ?? 'attachment', size: Number(a.size) || 0, contentType: str(a.content_type) ?? '', url: str(a.download_url) }));
}

// ---------- Account setup: tracking, receiving domain, webhook ----------

export interface ResendDomain {
  id: string;
  name: string;
  status: string;
  openTracking: boolean;
  clickTracking: boolean;
  trackingSubdomain: string | null;
  sending: string;
  receiving: string;
  records: Array<{ record: string; name: string; type: string; value: string; priority?: number; status: string }>;
}

function domainOf(d: Record<string, unknown>): ResendDomain {
  const cap = (d.capabilities && typeof d.capabilities === 'object' ? d.capabilities : {}) as Record<string, unknown>;
  const recs = Array.isArray(d.records) ? (d.records as Array<Record<string, unknown>>) : [];
  return {
    id: String(d.id ?? ''), name: String(d.name ?? '').toLowerCase(), status: String(d.status ?? ''),
    openTracking: d.open_tracking === true, clickTracking: d.click_tracking === true, trackingSubdomain: str(d.tracking_subdomain),
    sending: String(cap.sending ?? 'enabled'), receiving: String(cap.receiving ?? 'disabled'),
    records: recs.map(r => ({ record: String(r.record ?? ''), name: String(r.name ?? ''), type: String(r.type ?? ''), value: String(r.value ?? ''), ...(r.priority != null ? { priority: Number(r.priority) } : {}), status: String(r.status ?? '') })),
  };
}

export async function resendDomain(c: ResendConfig, id: string): Promise<ResendDomain> {
  return domainOf(await call(c, `/domains/${encodeURIComponent(id)}`));
}

export async function resendUpdateDomain(c: ResendConfig, id: string, body: Record<string, unknown>): Promise<void> {
  await call(c, `/domains/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function resendCreateDomain(c: ResendConfig, body: Record<string, unknown>): Promise<ResendDomain> {
  return domainOf(await call(c, '/domains', { method: 'POST', body: JSON.stringify(body) }));
}

export async function resendVerifyDomain(c: ResendConfig, id: string): Promise<void> {
  await call(c, `/domains/${encodeURIComponent(id)}/verify`, { method: 'POST' });
}

export async function resendDomainList(c: ResendConfig): Promise<Array<{ id: string; name: string; status: string }>> {
  const j = await call(c, '/domains');
  const list = Array.isArray(j.data) ? (j.data as Array<Record<string, unknown>>) : [];
  return list.map(d => ({ id: String(d.id ?? ''), name: String(d.name ?? '').toLowerCase(), status: String(d.status ?? '') }));
}

export async function resendWebhooks(c: ResendConfig): Promise<Array<{ id: string; endpoint: string; events: string[]; status: string }>> {
  const j = await call(c, '/webhooks');
  const list = Array.isArray(j.data) ? (j.data as Array<Record<string, unknown>>) : [];
  return list.map(w => ({ id: String(w.id ?? ''), endpoint: String(w.endpoint ?? ''), events: strs(w.events), status: String(w.status ?? '') }));
}

export async function resendUpdateWebhook(c: ResendConfig, id: string, body: { endpoint?: string; events?: string[]; status?: string }): Promise<void> {
  await call(c, `/webhooks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function resendCreateWebhook(c: ResendConfig, body: { endpoint: string; events: string[] }): Promise<{ id: string; secret: string | null }> {
  const j = await call(c, '/webhooks', { method: 'POST', body: JSON.stringify(body) });
  return { id: String(j.id ?? ''), secret: str(j.signing_secret) };
}

/** The account's domains and their status. Sends nothing. */
export async function resendDomains(c: ResendConfig): Promise<Array<{ name: string; status: string }>> {
  const j = await call(c, '/domains');
  const list = Array.isArray(j.data) ? (j.data as Array<Record<string, unknown>>) : [];
  return list.map(d => ({ name: String(d.name ?? '').toLowerCase(), status: String(d.status ?? '') }));
}

/**
 * Resend webhooks are signed the Svix way: headers svix-id, svix-timestamp and svix-signature ("v1,<base64>",
 * space separated when there are several). The signed content is "{id}.{timestamp}.{raw body}", HMAC-SHA256 keyed
 * with the base64 part of the signing secret ("whsec_…"). Timestamps older or newer than five minutes are refused.
 */
export function svixSignature(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
}

export function validSvix(secret: string, h: { id: string | null; timestamp: string | null; signature: string | null }, body: string, now = Date.now()): boolean {
  if (!h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const want = Buffer.from(svixSignature(secret, h.id, h.timestamp, body));
  return h.signature.split(' ').some(part => {
    const [ver, sig] = part.split(',');
    if (ver !== 'v1' || !sig) return false;
    const got = Buffer.from(sig);
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

export const isWebhookSecret = (v: string) => /^whsec_[A-Za-z0-9+/=]{16,200}$/.test(v);
