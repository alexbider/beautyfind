import 'server-only';
import { cookies } from 'next/headers';
import { db } from './db';
import { randomToken, sha256 } from './crypto';

const COOKIE = 'bf_session';
const DAYS_REMEMBER = 30;

/** Creates a DB-backed session and sets an httpOnly cookie. Only the token hash is stored. */
export async function createSession(userId: string, remember = true) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + (remember ? DAYS_REMEMBER : 1) * 86_400_000);
  await db.session.create({ data: { userId, tokenHash: sha256(token), expiresAt } });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...(remember ? { expires: expiresAt } : {}),
  });
}

export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(COOKIE);
}
