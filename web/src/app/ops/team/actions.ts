'use server';

import type { OpsRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/guard';
import { AREAS, LEVELS, OPS_ROLES, type Area, type Level, type OpsRoleKey } from '@/components/ops/roles';
import { randomToken, sha256 } from '@/lib/server/crypto';
import { db } from '@/lib/server/db';
import { platformSettings, savePlatformSettings } from '@/lib/server/platformSettings';
import { siteUrl } from '@/lib/server/site';

// Team management. Everything here needs the full level in the team area (the ops role). Invites
// create the account with its role and a one-time setup link (7 days); the link is shown to the
// inviter because the platform has no messaging provider by default. Roles cannot be changed on
// one's own account, so an admin can never lock the admin out.

const INVITE_DAYS = 7;
const Role = z.enum(OPS_ROLES as [OpsRoleKey, ...OpsRoleKey[]]);

type Err = { ok: false; error: string };

export async function inviteStaffAction(input: { email: string; fullName: string; role: string }): Promise<{ ok: true; link: string; expires: string; existing: boolean } | Err> {
  const user = await areaUserOrNull('team', 'full');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = z.object({ email: z.string().trim().toLowerCase().email().max(200), fullName: z.string().trim().min(2).max(120), role: Role }).safeParse(input);
  if (!p.success) return { ok: false, error: 'דוא״ל, שם או תפקיד לא תקינים' };
  const existing = await db.user.findUnique({ where: { email: p.data.email }, select: { id: true, opsRole: true, passwordHash: true } });
  if (existing?.opsRole && existing.passwordHash) return { ok: false, error: 'לחשבון הזה כבר יש תפקיד צוות וסיסמה. שנו את התפקיד ברשימה.' };
  const token = randomToken(24);
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const target = existing
    ? await db.user.update({ where: { id: existing.id }, data: { opsRole: p.data.role as OpsRole, fullName: p.data.fullName }, select: { id: true } })
    : await db.user.create({ data: { email: p.data.email, fullName: p.data.fullName, opsRole: p.data.role as OpsRole }, select: { id: true } });
  await db.auditLog.create({ data: { actorId: user.id, action: 'staff_invite', subjectType: 'user', subjectId: target.id, meta: { email: p.data.email, role: p.data.role, tokenHash, expiresAt: expiresAt.toISOString(), existing: !!existing } } });
  revalidatePath('/ops/team');
  return { ok: true, link: `${siteUrl()}/ops/setup?token=${token}`, expires: expiresAt.toISOString(), existing: !!existing };
}

export async function setStaffRoleAction(input: { userId: string; role: string | null }): Promise<{ ok: true } | Err> {
  const user = await areaUserOrNull('team', 'full');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = z.object({ userId: z.string().uuid(), role: Role.nullable() }).safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  if (p.data.userId === user.id) return { ok: false, error: 'אי אפשר לשנות את התפקיד של עצמך' };
  const target = await db.user.findUnique({ where: { id: p.data.userId }, select: { id: true, opsRole: true } });
  if (!target?.opsRole) return { ok: false, error: 'החשבון לא נמצא או אינו איש צוות' };
  if (target.opsRole === p.data.role) return { ok: true };
  await db.$transaction([
    db.user.update({ where: { id: target.id }, data: { opsRole: p.data.role as OpsRole | null } }),
    db.auditLog.create({ data: { actorId: user.id, action: p.data.role ? 'staff_role_change' : 'staff_role_remove', subjectType: 'user', subjectId: target.id, meta: { from: target.opsRole, to: p.data.role } } }),
    // A removed or demoted role takes effect now: their open admin sessions end.
    db.session.deleteMany({ where: { userId: target.id } }),
  ]);
  revalidatePath('/ops/team');
  return { ok: true };
}

export async function setPermissionAction(input: { role: string; areas: string[]; level: string }): Promise<{ ok: true; level: Level } | Err> {
  const user = await areaUserOrNull('team', 'full');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = z.object({ role: Role, areas: z.array(z.enum(AREAS as [Area, ...Area[]])).min(1).max(AREAS.length), level: z.enum(LEVELS as [Level, ...Level[]]) }).safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  if (p.data.role === 'ops') return { ok: false, error: 'מנהל־על תמיד מלא' };
  const cur = await platformSettings();
  const forRole: Partial<Record<Area, Level>> = { ...(cur.rolePermissions[p.data.role] ?? {}) };
  for (const a of p.data.areas) forRole[a] = p.data.level;
  await savePlatformSettings(user.id, { rolePermissions: { ...cur.rolePermissions, [p.data.role]: forRole } });
  await db.auditLog.create({ data: { actorId: user.id, action: 'permissions_change', subjectType: 'platform_settings', subjectId: user.id, meta: { role: p.data.role, areas: p.data.areas, level: p.data.level } } });
  revalidatePath('/ops/team');
  revalidatePath('/ops');
  return { ok: true, level: p.data.level };
}
