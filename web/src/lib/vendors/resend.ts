import 'server-only';

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

export function resendBody(c: ResendConfig, to: string, mail: { subject: string; html: string; text: string }) {
  return { from: c.from, to: [to], subject: mail.subject, html: mail.html, text: mail.text, ...(c.replyTo ? { reply_to: c.replyTo } : {}) };
}

/** Sends one email. Returns Resend's id; throws ResendError. */
export async function resendSend(c: ResendConfig, to: string, mail: { subject: string; html: string; text: string }): Promise<{ id: string }> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) throw new ResendError('invalid email address', 400);
  if (!fromAddress(c.from)) throw new ResendError('no sender address configured', 400);
  const j = await call(c, '/emails', { method: 'POST', body: JSON.stringify(resendBody(c, to, mail)) });
  return { id: typeof j.id === 'string' ? j.id : 'accepted' };
}

/** The account's domains and their status. Sends nothing. */
export async function resendDomains(c: ResendConfig): Promise<Array<{ name: string; status: string }>> {
  const j = await call(c, '/domains');
  const list = Array.isArray(j.data) ? (j.data as Array<Record<string, unknown>>) : [];
  return list.map(d => ({ name: String(d.name ?? '').toLowerCase(), status: String(d.status ?? '') }));
}
