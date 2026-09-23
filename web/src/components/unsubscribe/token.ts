import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { hmac } from '@/lib/server/crypto';
import { siteUrl } from '@/lib/server/site';

// Unsubscribe links (05-messages.md, Communications Law §30A). Every marketing message (M24, M25)
// carries one. The token is an HMAC-signed { contact, scope, channel } so it works without login and
// cannot be edited to opt out (or in) someone else.

export type Channel = 'wa' | 'email' | 'sms';
export const CHANNELS: readonly Channel[] = ['wa', 'sms', 'email'];
export const isChannel = (v: unknown): v is Channel => v === 'wa' || v === 'email' || v === 'sms';

export interface UnsubscribeTarget {
  contact: string; // E.164 phone or lowercase email, as stored in MessageConsent.contact
  scope: string; // business id, or "all" (BeautyFind magazine / every sender)
  channel: Channel;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');
const sig = (payload: string) => hmac('unsub:' + payload).slice(0, 32);

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Signs a target. Non-expiring: an unsubscribe link must keep working for as long as the message exists. */
export function unsubscribeToken(t: UnsubscribeTarget): string {
  const payload = b64(JSON.stringify({ c: t.contact, s: t.scope, ch: t.channel }));
  return `${payload}.${sig(payload)}`;
}

/** Absolute link for message templates: `${siteUrl()}/unsubscribe/<token>`. */
export const unsubscribeUrl = (t: UnsubscribeTarget) => `${siteUrl()}/unsubscribe/${unsubscribeToken(t)}`;

/** Verifies and decodes a token; null when it was tampered with or malformed. */
export function parseUnsubscribeToken(token: string): UnsubscribeTarget | null {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const m = /^([A-Za-z0-9_-]+)\.([0-9a-f]{32})$/.exec(token);
  if (!m || !safeEqual(sig(m[1]), m[2])) return null;
  try {
    const o = JSON.parse(unb64(m[1])) as Record<string, unknown>;
    if (typeof o.c !== 'string' || !o.c || typeof o.s !== 'string' || !o.s || !isChannel(o.ch)) return null;
    return { contact: o.c, scope: o.s, channel: o.ch };
  } catch {
    return null;
  }
}

/** Short signature over arbitrary JSON, for the "undo" payload the unsubscribe page hands back. */
export function signJson(v: unknown): string {
  const payload = b64(JSON.stringify(v));
  return `${payload}.${hmac('unsub-undo:' + payload).slice(0, 32)}`;
}

export function openJson<T>(token: string): T | null {
  if (typeof token !== 'string' || token.length > 8192) return null;
  const m = /^([A-Za-z0-9_-]+)\.([0-9a-f]{32})$/.exec(token);
  if (!m || !safeEqual(hmac('unsub-undo:' + m[1]).slice(0, 32), m[2])) return null;
  try {
    return JSON.parse(unb64(m[1])) as T;
  } catch {
    return null;
  }
}

/**
 * Whether a marketing message may go to `contact` from `businessId` on `channel` (for senders to call).
 * Needs an explicit opt-in for that business and channel, and no "all" stop on the channel.
 * Service messages never consult this.
 */
export function marketingAllowed(
  rows: Array<{ contact: string; scope: string; channel: string; marketing: boolean }>,
  contact: string,
  businessId: string,
  channel: Channel,
): boolean {
  const all = rows.find(r => r.contact === contact && r.scope === 'all' && r.channel === channel);
  if (all && !all.marketing) return false;
  return !!rows.find(r => r.contact === contact && r.scope === businessId && r.channel === channel)?.marketing;
}
