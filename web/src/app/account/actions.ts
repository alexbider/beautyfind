'use server';

import { db } from '@/lib/server/db';
import { currentUser } from '@/lib/server/session';
import { pendingDeletion } from '@/components/account/data';
import { isChannel } from '@/components/unsubscribe/token';

// /account mutations. Each re-reads the session; nothing trusts ids from the browser beyond validation.

async function client() {
  const u = await currentUser();
  return u && u.kind === 'client' ? u : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActionResult = { ok: true } | { ok: false; error: 'signed_out' | 'invalid' | 'no_contact' };

/**
 * Marketing consent for one sender (business id, or "all") and channel. Writes MessageConsent for the
 * account's own phone (wa, sms) or email. Service messages never read this table.
 */
export async function setConsentAction(scope: string, channel: string, on: boolean): Promise<ActionResult> {
  const user = await client();
  if (!user) return { ok: false, error: 'signed_out' };
  if (!isChannel(channel) || typeof on !== 'boolean') return { ok: false, error: 'invalid' };
  if (scope !== 'all') {
    if (!UUID_RE.test(scope)) return { ok: false, error: 'invalid' };
    // Only senders the client actually has a relationship with (a booking, or an existing consent row).
    const known =
      (await db.booking.findFirst({ where: { clientUserId: user.id, branch: { businessId: scope } }, select: { id: true } })) ||
      (await db.messageConsent.findFirst({ where: { scope, contact: { in: [user.phone, user.email].filter((x): x is string => !!x) } }, select: { id: true } }));
    if (!known) return { ok: false, error: 'invalid' };
  }
  const contact = channel === 'email' ? user.email : user.phone;
  if (!contact) return { ok: false, error: 'no_contact' };
  await db.messageConsent.upsert({
    where: { contact_scope_channel: { contact, scope, channel } },
    create: { contact, scope, channel, marketing: on, source: 'account', userId: user.id },
    update: { marketing: on, source: 'account', userId: user.id },
  });
  return { ok: true };
}

/** Display name. Phone and email are verified identities and change only through re-verification. */
export async function updateNameAction(name: string): Promise<ActionResult> {
  const user = await client();
  if (!user) return { ok: false, error: 'signed_out' };
  const v = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  if (v.length < 2 || v.length > 80) return { ok: false, error: 'invalid' };
  await db.user.update({ where: { id: user.id }, data: { fullName: v } });
  return { ok: true };
}

/**
 * Account deletion request. Recorded as an append-only Decision (subjectType 'user', action
 * 'delete_request') for ops to carry out within 30 days, as the privacy policy says. Nothing is deleted here.
 */
export async function requestDeletionAction(reason: string): Promise<{ ok: true; requested: string } | { ok: false; error: 'signed_out' }> {
  const user = await client();
  if (!user) return { ok: false, error: 'signed_out' };
  const existing = await pendingDeletion(user.id);
  const d =
    existing ??
    (await db.decision.create({
      data: {
        actorId: user.id,
        actorRole: 'client',
        subjectType: 'user',
        subjectId: user.id,
        action: 'delete_request',
        reason: typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null,
      },
    }));
  return { ok: true, requested: d.createdAt.toISOString() };
}
