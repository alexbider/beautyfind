import 'server-only';
import { db } from '@/lib/server/db';
import type { Channel, UnsubscribeTarget } from './token';

export const CHANNEL_NAME: Record<Channel, string> = { wa: 'וואטסאפ', sms: 'SMS', email: 'דוא״ל' };

const isEmail = (c: string) => c.includes('@');

/**
 * Which contact each channel goes to for this link. The link's own contact covers its channels
 * (a phone: WhatsApp and SMS; an email: email). If a client account holds that contact, its other
 * contact is offered too, without ever being displayed.
 */
export async function contactsFor(t: UnsubscribeTarget): Promise<{ contacts: Record<Channel, string | null>; userId: string | null }> {
  const email = isEmail(t.contact);
  const user = await db.user.findFirst({
    where: email ? { email: { equals: t.contact, mode: 'insensitive' } } : { phone: t.contact },
    select: { id: true, phone: true, email: true, kind: true },
  });
  const phone = email ? (user?.phone ?? null) : t.contact;
  const mail = email ? t.contact : (user?.email ?? null);
  return { contacts: { wa: phone, sms: phone, email: mail }, userId: user?.kind === 'client' ? user.id : null };
}

/** Sender shown on the page: the clinic's public name, or BeautyFind for "all". */
export async function senderName(scope: string): Promise<string> {
  if (scope === 'all') return 'BeautyFind';
  if (!/^[0-9a-f-]{36}$/i.test(scope)) return 'העסק';
  const b = await db.business.findUnique({
    where: { id: scope },
    select: { legalName: true, branches: { select: { name: true }, orderBy: { createdAt: 'asc' }, take: 2 } },
  });
  if (!b) return 'העסק';
  return (b.branches.length > 1 ? b.legalName : null) ?? b.branches[0]?.name ?? b.legalName ?? 'העסק';
}

/** 054-•••-2290 / sh•••@gmail.com */
export function maskContact(c: string): string {
  if (isEmail(c)) {
    const [u, d] = c.split('@');
    return `${u.slice(0, 2)}•••@${d}`;
  }
  const local = c.startsWith('+972') ? '0' + c.slice(4) : c;
  return `${local.slice(0, 3)}-•••-${local.slice(-4)}`;
}
