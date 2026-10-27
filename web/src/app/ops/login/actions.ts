'use server';

import { z } from 'zod';
import { staffHome } from '@/components/ops/guard';
import { hashPassword, verifyPassword } from '@/lib/server/crypto';
import { db } from '@/lib/server/db';
import { LIMITS, clientIp, hit } from '@/lib/server/rateLimit';
import { createSession } from '@/lib/server/session';

// Staff sign-in for the BeautyFind admin. Same accounts and password hashing as /login, but only
// accounts with a staff role get in, repeated failures lock the account for a while, and every
// attempt on a real account is written to the audit log.

const MAX_FAILS = 5;
const WINDOW_MIN = 15;

const Input = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).max(200),
  next: z.string().max(512).nullish(),
});

export type StaffSignin = { ok: true; redirectTo: string } | { ok: false; error: 'bad_credentials' | 'not_staff' | 'locked' };

let dummy: Promise<string> | null = null;

/** Only same-site /ops paths; anything else falls back to the role's home screen. */
const safeOpsNext = (n: string | null | undefined) => (n && /^\/ops(\/|$|\?)/.test(n) && !n.startsWith('//') && !n.startsWith('/ops/login') ? n : null);

export async function staffSignin(input: z.input<typeof Input>): Promise<StaffSignin> {
  const p = Input.safeParse(input);
  if (!p.success) return { ok: false, error: 'bad_credentials' };
  const ip = await clientIp();
  if (!(await hit(`staff:ip:${ip}`, LIMITS.staffIp)).ok) return { ok: false, error: 'locked' };
  const user = await db.user.findUnique({ where: { email: p.data.email } });
  if (!user?.passwordHash) {
    // Same work as a real check, so timing does not tell which emails exist.
    dummy ??= hashPassword('bf-staff-timing');
    await verifyPassword(p.data.password, await dummy);
    return { ok: false, error: 'bad_credentials' };
  }

  // The lock is per account AND network: wrong passwords from one place lock that place out, so a stranger
  // cannot lock a real admin out of their own account. A burst across many networks is still capped account-wide.
  const since = new Date(Date.now() - WINDOW_MIN * 60_000);
  const [fromHere, everywhere] = await Promise.all([
    db.auditLog.count({ where: { action: 'staff_login_failed', subjectType: 'user', subjectId: user.id, createdAt: { gte: since }, meta: { path: ['ip'], equals: ip } } }),
    db.auditLog.count({ where: { action: 'staff_login_failed', subjectType: 'user', subjectId: user.id, createdAt: { gte: since } } }),
  ]);
  if (fromHere >= MAX_FAILS || everywhere >= MAX_FAILS * 10) return { ok: false, error: 'locked' };

  if (!(await verifyPassword(p.data.password, user.passwordHash))) {
    await db.auditLog.create({ data: { action: 'staff_login_failed', subjectType: 'user', subjectId: user.id, meta: { ip } } });
    return { ok: false, error: fromHere + 1 >= MAX_FAILS ? 'locked' : 'bad_credentials' };
  }
  if (!user.opsRole) {
    await db.auditLog.create({ data: { actorId: user.id, action: 'staff_login_denied', subjectType: 'user', subjectId: user.id } });
    return { ok: false, error: 'not_staff' };
  }

  // Staff sessions last one day, never 30.
  await createSession(user.id, false);
  await db.auditLog.create({ data: { actorId: user.id, action: 'staff_login', subjectType: 'user', subjectId: user.id, meta: { role: user.opsRole } } });
  return { ok: true, redirectTo: safeOpsNext(p.data.next) ?? (await staffHome(user)) };
}
