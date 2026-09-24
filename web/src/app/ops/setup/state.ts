import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { sha256 } from '@/lib/server/crypto';
import { db } from '@/lib/server/db';

/** The master admin email when the setup token is right and that account has no password yet. */
export async function setupState(token: string): Promise<{ ok: true; email: string } | { ok: false }> {
  const email = (process.env.OPS_BOOTSTRAP_EMAIL ?? '').trim().toLowerCase();
  const want = process.env.OPS_SETUP_TOKEN_HASH ?? '';
  if (!email || !/^[0-9a-f]{64}$/.test(want) || !token) return { ok: false };
  const got = Buffer.from(sha256(token), 'hex');
  if (!timingSafeEqual(got, Buffer.from(want, 'hex'))) return { ok: false };
  const user = await db.user.findUnique({ where: { email }, select: { passwordHash: true, opsRole: true } });
  if (!user || user.passwordHash || !user.opsRole) return { ok: false };
  return { ok: true, email };
}

