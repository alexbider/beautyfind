import 'server-only';
import { randomInt } from 'node:crypto';
import { nisFromAgorot } from '../format';
import { messaging } from '../vendors/messaging';
import { db } from './db';
import { siteUrl } from './site';

// Gift cards (03-states.md): pending_payment → scheduled/active → partially_redeemed → redeemed.
// Validity ≥ 5 years; the open balance is the business's liability until redeemed.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const block = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/** NOA-7K4M-29QX style: a short business prefix + two random blocks. */
export function giftCode(prefix: string) {
  const p = prefix.replace(/[^A-Z]/gi, '').toUpperCase().slice(0, 4) || 'BF';
  return `${p}-${block()}-${block()}`;
}

export async function activatePaidGiftCard(giftCardId: string) {
  const g = await db.giftCard.findUnique({ where: { id: giftCardId }, include: { business: { include: { branches: { take: 1 } } } } });
  if (!g || g.status !== 'pending_payment') return;
  const due = g.sendAt.getTime() <= Date.now();
  await db.giftCard.update({ where: { id: g.id }, data: { status: due ? 'active' : 'scheduled' } });
  if (due) await deliverGiftCard(g.id);
}

/** M14: sends the card to the recipient (or the buyer for "self"). Also run by the scheduler for future send dates. */
export async function deliverGiftCard(giftCardId: string) {
  const g = await db.giftCard.findUnique({ where: { id: giftCardId }, include: { business: { include: { branches: { take: 1 } } } } });
  // A cancelled, refunded or unpaid card is never sent.
  if (!g || (g.status !== 'scheduled' && g.status !== 'active')) return;
  if (g.status === 'scheduled') await db.giftCard.update({ where: { id: g.id }, data: { status: 'active' } });
  const to = g.recipientChannel === 'self' ? g.buyerEmail ?? g.buyerPhone : g.recipientContact;
  if (!to) return;
  await messaging().send({
    channel: g.recipientChannel === 'wa' || (g.recipientChannel === 'self' && !g.buyerEmail) ? 'whatsapp' : 'email',
    to,
    template: 'M14_gift_card',
    vars: {
      recipient: g.recipientName, buyer: g.buyerName, business: g.business.branches[0]?.name ?? '', amount: nisFromAgorot(g.valueAgorot),
      code: g.code, message: g.message ?? '', link: `${siteUrl()}/gift/check?code=${encodeURIComponent(g.code)}`,
    },
    kind: 'service',
  });
}
