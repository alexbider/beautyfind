import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { sha256 } from '@/lib/server/crypto';
import { db } from '@/lib/server/db';

/**
 * The master admin email when the setup token is right and that exact token has not been used yet.
 * Each token works once: setting (or resetting) the password records its hash in the audit log, so a
 * forgotten password is reset by putting a new token's SHA-256 in OPS_SETUP_TOKEN_HASH and redeploying.
 */
export async function setupState(token: string): Promise<{ ok: true; email: string; tokenHash: string; reset: boolean } | { ok: false }> {
  const email = (process.env.OPS_BOOTSTRAP_EMAIL ?? '').trim().toLowerCase();
  const want = process.env.OPS_SETUP_TOKEN_HASH ?? '';
  if (!email || !/^[0-9a-f]{64}$/.test(want) || !token) return { ok: false };
  const got = Buffer.from(sha256(token), 'hex');
  if (!timingSafeEqual(got, Buffer.from(want, 'hex'))) return { ok: false };
  const user = await db.user.findUnique({ where: { email }, select: { id: true, passwordHash: true, opsRole: true } });
  if (!user || !user.opsRole) return { ok: false };
  const used = await db.auditLog.findFirst({ where: { action: 'staff_password_setup', subjectType: 'user', subjectId: user.id, meta: { path: ['tokenHash'], equals: want } }, select: { id: true } });
  if (used) return { ok: false };
  return { ok: true, email, tokenHash: want, reset: !!user.passwordHash };
}

