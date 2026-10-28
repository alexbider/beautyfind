import 'server-only';
import { randomBytes } from 'node:crypto';
import { db } from './db';

// Who an email goes to, for /ops/emails. Resolved once at send time from the address, so the log keeps only the
// masked address plus the links: a business (its owner or staff, a branch's public email, or a marketing order
// contact), a client account, BeautyFind staff, or other (a guest booking, an import invite to an unlinked address).

export type Audience = 'business' | 'client' | 'staff' | 'other';
export interface Recipient { audience: Audience; userId: string | null; businessId: string | null }

export const AUDIENCE_LABEL: Record<Audience, string> = { business: 'עסק', client: 'לקוח/ה', staff: 'צוות BeautyFind', other: 'אחר' };

export async function resolveRecipient(address: string): Promise<Recipient> {
  const email = address.trim().toLowerCase();
  if (!email.includes('@')) return { audience: 'other', userId: null, businessId: null };
  const user = await db.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, opsRole: true, ownedBusinesses: { select: { id: true }, take: 1 }, staff: { select: { businessId: true }, take: 1 } },
  });
  if (user) {
    const businessId = user.ownedBusinesses[0]?.id ?? user.staff[0]?.businessId ?? null;
    if (businessId) return { audience: 'business', userId: user.id, businessId };
    if (user.opsRole) return { audience: 'staff', userId: user.id, businessId: null };
  }
  const [branch, order, billing] = await Promise.all([
    db.branch.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { businessId: true } }),
    db.marketingOrder.findFirst({ where: { contactEmail: email, businessId: { not: null } }, select: { businessId: true }, orderBy: { createdAt: 'desc' } }),
    db.business.findFirst({ where: { OR: [{ invoiceEmail: { equals: email, mode: 'insensitive' } }, { accountantEmail: { equals: email, mode: 'insensitive' } }] }, select: { id: true } }),
  ]);
  const businessId = branch?.businessId ?? order?.businessId ?? billing?.id ?? null;
  if (businessId) return { audience: 'business', userId: user?.id ?? null, businessId };
  if (user) return { audience: 'client', userId: user.id, businessId: null };
  const marketingGuest = await db.marketingOrder.findFirst({ where: { contactEmail: email }, select: { id: true } });
  return { audience: marketingGuest ? 'business' : 'other', userId: null, businessId: null };
}

/** 16 lowercase base32 characters: the secret part of a per-email reply address. */
export function newReplyToken(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(randomBytes(16), b => alphabet[b % alphabet.length]).join('');
}

export const replyAddress = (token: string, domain: string) => `r-${token}@${domain}`;

/** The token in an address on the reply domain, or null. */
export function tokenOf(address: string, domain: string): string | null {
  const m = address.trim().toLowerCase().match(/<?r-([a-z0-9]{8,40})@([^>\s]+)>?$/);
  return m && m[2] === domain.toLowerCase() ? m[1] : null;
}

/** "Name <a@b.c>" → its display name, or null. */
export function displayName(v: string): string | null {
  const m = v.match(/^\s*"?([^"<]{1,80}?)"?\s*</);
  return m ? m[1].trim() || null : null;
}

/** Origin and path of a link; the query and hash are dropped because reset and invite links carry secrets. */
export function safeLink(href: string): string | null {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    return null;
  }
}

/** The new part of a reply: everything above the quoted original ("On … wrote:", "> " lines, Gmail and Outlook headers). */
export function replyOnly(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cut = lines.findIndex(l =>
    /^\s*(On\s.+wrote:|בתאריך\s.+(כתב|כתבה|נכתב).*:|-{2,}\s*Original Message\s*-{2,}|-{2,}\s*Forwarded message\s*-{2,}|From:\s.+|מאת:\s.+|_{8,})\s*$/i.test(l) ||
    (/^>/.test(l) && lines.slice(lines.indexOf(l)).every(x => /^>|^\s*$/.test(x))));
  const kept = (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim();
  return kept || text.trim();
}

/** Plain text of an HTML body, for replies that arrive without a text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
