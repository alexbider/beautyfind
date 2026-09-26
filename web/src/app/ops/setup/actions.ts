'use server';

import { z } from 'zod';
import { hashPassword } from '@/lib/server/crypto';
import { db } from '@/lib/server/db';
import { createSession } from '@/lib/server/session';
import { setupState } from './state';

// Password setup and reset for the master admin (OPS_BOOTSTRAP_EMAIL). The link carries a token whose
// SHA-256 is in OPS_SETUP_TOKEN_HASH. Each token works once: after it sets the password its hash is
// written to the audit log and the same link is refused. A new token (new hash on Vercel) resets.

const Input = z.object({ token: z.string().max(200), password: z.string().min(12).max(200), confirm: z.string() });

export async function completeSetup(input: z.input<typeof Input>): Promise<{ ok: true } | { ok: false; error: 'invalid_link' | 'weak' | 'mismatch' }> {
  const p = Input.safeParse(input);
  if (!p.success) return { ok: false, error: 'weak' };
  if (p.data.password !== p.data.confirm) return { ok: false, error: 'mismatch' };
  const s = await setupState(p.data.token);
  if (!s.ok) return { ok: false, error: 'invalid_link' };
  const hash = await hashPassword(p.data.password);
  const user = await db.user.findUniqueOrThrow({ where: { email: s.email }, select: { id: true } });
  // The token is spent inside the same transaction as the password, so two tabs cannot both use it.
  const ok = await db.$transaction(async tx => {
    const again = await tx.auditLog.findFirst({ where: { action: 'staff_password_setup', subjectType: 'user', subjectId: user.id, meta: { path: ['tokenHash'], equals: s.tokenHash } }, select: { id: true } });
    if (again) return false;
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'staff_password_setup', subjectType: 'user', subjectId: user.id, meta: { tokenHash: s.tokenHash, reset: s.reset } } });
    return true;
  });
  if (!ok) return { ok: false, error: 'invalid_link' };
  // Any older sessions of that account end with the reset.
  if (s.reset) await db.session.deleteMany({ where: { userId: user.id } }).catch(() => {});
  await createSession(user.id, false);
  return { ok: true };
}
