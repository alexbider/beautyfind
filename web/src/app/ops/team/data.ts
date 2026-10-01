import 'server-only';
import { db } from '@/lib/server/db';

// Staff accounts for /ops/team: every user with a staff role, the last time they signed in to the
// admin (from the audit log), and whether they have set a password yet (an invite that was not used).

export interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: string;
  lastLogin: Date | null;
  hasPassword: boolean;
  inviteExpires: Date | null; // the newest unspent invite, when there is one
  blockedAt: Date | null;
}

export async function staff(): Promise<StaffRow[]> {
  const users = await db.user.findMany({ where: { opsRole: { not: null } }, orderBy: { createdAt: 'asc' }, select: { id: true, fullName: true, email: true, opsRole: true, passwordHash: true, blockedAt: true } });
  const ids = users.map(u => u.id);
  const [logins, invites, setups] = await Promise.all([
    db.auditLog.groupBy({ by: ['actorId'], where: { action: 'staff_login', actorId: { in: ids } }, _max: { createdAt: true } }),
    db.auditLog.findMany({ where: { action: 'staff_invite', subjectType: 'user', subjectId: { in: ids } }, orderBy: { createdAt: 'desc' }, select: { subjectId: true, meta: true, createdAt: true } }),
    db.auditLog.findMany({ where: { action: 'staff_password_setup', subjectType: 'user', subjectId: { in: ids } }, select: { subjectId: true, meta: true } }),
  ]);
  const last = new Map(logins.map(l => [l.actorId, l._max.createdAt]));
  const spent = new Set(setups.map(s => `${s.subjectId}:${(s.meta as { tokenHash?: string } | null)?.tokenHash ?? ''}`));
  return users.map(u => {
    const inv = invites.find(i => i.subjectId === u.id && !spent.has(`${u.id}:${(i.meta as { tokenHash?: string } | null)?.tokenHash ?? ''}`));
    const exp = (inv?.meta as { expiresAt?: string } | null)?.expiresAt;
    return {
      id: u.id, name: u.fullName ?? u.email ?? '', email: u.email ?? '', role: u.opsRole ?? '',
      lastLogin: last.get(u.id) ?? null, hasPassword: !!u.passwordHash,
      inviteExpires: !u.passwordHash && exp && new Date(exp) > new Date() ? new Date(exp) : null,
      blockedAt: u.blockedAt,
    };
  });
}
