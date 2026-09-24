'use server';

import { z } from 'zod';
import { hashPassword } from '@/lib/server/crypto';
import { db } from '@/lib/server/db';
import { createSession } from '@/lib/server/session';
import { setupState } from './state';

// One-time password setup for the master admin (OPS_BOOTSTRAP_EMAIL). The link carries a token whose
// SHA-256 is in OPS_SETUP_TOKEN_HASH. It works only while that account has no password, so it
// is single use: once a password is set, the same link is refused.

const Input = z.object({ token: z.string().max(200), password: z.string().min(12).max(200), confirm: z.string() });

export async function completeSetup(input: z.input<typeof Input>): Promise<{ ok: true } | { ok: false; error: 'invalid_link' | 'weak' | 'mismatch' }> {
  const p = Input.safeParse(input);
  if (!p.success) return { ok: false, error: 'weak' };
  if (p.data.password !== p.data.confirm) return { ok: false, error: 'mismatch' };
  const s = await setupState(p.data.token);
  if (!s.ok) return { ok: false, error: 'invalid_link' };
  const hash = await hashPassword(p.data.password);
  // Only if still unset: two tabs racing cannot both set it.
  const r = await db.user.updateMany({ where: { email: s.email, passwordHash: null }, data: { passwordHash: hash } });
  if (!r.count) return { ok: false, error: 'invalid_link' };
  const user = await db.user.findUniqueOrThrow({ where: { email: s.email }, select: { id: true } });
  await db.auditLog.create({ data: { actorId: user.id, action: 'staff_password_setup', subjectType: 'user', subjectId: user.id } });
  await createSession(user.id, false);
  return { ok: true };
}
