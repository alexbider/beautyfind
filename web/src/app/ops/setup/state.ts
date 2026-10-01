import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { sha256 } from '@/lib/server/crypto';
import { db } from '@/lib/server/db';

/**
 * Who a setup link belongs to, when it is valid and unspent. Two kinds of link:
 * - the master admin's bootstrap link (OPS_BOOTSTRAP_EMAIL + OPS_SETUP_TOKEN_HASH): each token works
 *   once; setting the password records its hash in the audit log, and a forgotten password is reset by
 *   putting a new token's SHA-256 in OPS_SETUP_TOKEN_HASH and redeploying;
 * - a staff invite from /ops/team: the token's hash and expiry are in the `staff_invite` audit row of
 *   that account, and the same `staff_password_setup` row marks it spent.
 */
export async function setupState(token: string): Promise<{ ok: true; email: string; tokenHash: string; reset: boolean } | { ok: false }> {
  if (!token) return { ok: false };
  const got = sha256(token);
  const email = (process.env.OPS_BOOTSTRAP_EMAIL ?? '').trim().toLowerCase();
  const want = process.env.OPS_SETUP_TOKEN_HASH ?? '';
  if (email && /^[0-9a-f]{64}$/.test(want) && timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(want, 'hex'))) {
    const user = await db.user.findUnique({ where: { email }, select: { id: true, passwordHash: true, opsRole: true } });
    if (!user || !user.opsRole) return { ok: false };
    if (await spent(user.id, want)) return { ok: false };
    return { ok: true, email, tokenHash: want, reset: !!user.passwordHash };
  }
  // A staff invite: the hash is stored, so an equality lookup is enough (nothing to compare in constant time).
  const invite = await db.auditLog.findFirst({ where: { action: 'staff_invite', subjectType: 'user', meta: { path: ['tokenHash'], equals: got } }, orderBy: { createdAt: 'desc' }, select: { subjectId: true, meta: true } });
  if (!invite) return { ok: false };
  const meta = (invite.meta ?? {}) as { expiresAt?: string };
  if (!meta.expiresAt || new Date(meta.expiresAt) < new Date()) return { ok: false };
  const user = await db.user.findUnique({ where: { id: invite.subjectId }, select: { id: true, email: true, passwordHash: true, opsRole: true } });
  if (!user?.email || !user.opsRole) return { ok: false };
  if (await spent(user.id, got)) return { ok: false };
  return { ok: true, email: user.email, tokenHash: got, reset: !!user.passwordHash };
}

async function spent(userId: string, tokenHash: string): Promise<boolean> {
  const used = await db.auditLog.findFirst({ where: { action: 'staff_password_setup', subjectType: 'user', subjectId: userId, meta: { path: ['tokenHash'], equals: tokenHash } }, select: { id: true } });
  return !!used;
}
