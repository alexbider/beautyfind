import type { Metadata } from 'next';
import { ownerGuard } from '@/components/dashboard/guard';
import { fmtDay, fmtTime } from '@/components/dashboard/leads/shared';
import { DASH_VIEWS } from '@/components/dashboard/nav';
import { TeamPanel } from '@/components/dashboard/team/TeamPanel';
import { STAFF_PRESETS, type AreaRow, type InviteDTO, type MemberDTO, type StaffPreset } from '@/components/dashboard/team/shared';
import { AREAS, effectivePerms, type Area } from '@/lib/permissions';
import { db } from '@/lib/server/db';

// Design: project/BeautyFind Dashboard.dc.html (isTeam)

export const metadata: Metadata = { title: 'צוות והרשאות' };

/** Expired invites stay listed (with resend) for this long, then drop off. */
const EXPIRED_VISIBLE_DAYS = 30;

const asStaffPreset = (v: string | null): StaffPreset =>
  (STAFF_PRESETS as readonly string[]).includes(v ?? '') ? (v as StaffPreset) : 'practitioner';

export default async function TeamPage() {
  const ctx = await ownerGuard();
  const now = new Date();

  const [members, invites] = await Promise.all([
    db.staffMember.findMany({
      where: { businessId: ctx.business.id, status: 'active' },
      include: { user: { select: { id: true, email: true, fullName: true } } },
      orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }],
    }),
    db.staffInvite.findMany({
      where: {
        businessId: ctx.business.id,
        status: { in: ['sent', 'expired'] },
        expiresAt: { gt: new Date(now.getTime() - EXPIRED_VISIBLE_DAYS * 86_400_000) },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // Last activity = the most recently refreshed session of the linked user.
  const userIds = members.map(m => m.userId).filter((v): v is string => !!v);
  const sessions = userIds.length
    ? await db.session.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _max: { updatedAt: true } })
    : [];
  const lastSeen = new Map(sessions.map(s => [s.userId, s._max.updatedAt]));
  const today = fmtDay(now);

  const lastLine = (userId: string | null): string | null => {
    if (!userId) return null;
    if (userId === ctx.user.id) return 'מחובר/ת עכשיו';
    const at = lastSeen.get(userId);
    if (!at) return null;
    return fmtDay(at) === today ? `היום · ${fmtTime(at)}` : fmtDay(at);
  };

  const memberRows: MemberDTO[] = members.map(m => ({
    id: m.id,
    name: m.displayName.trim() || m.user?.fullName?.trim() || 'ללא שם',
    email: m.user?.email ?? null,
    isOwner: m.isOwner,
    preset: m.isOwner ? null : asStaffPreset(m.preset),
    perms: effectivePerms({ isOwner: m.isOwner, preset: m.preset, stored: m.permissions }),
    last: lastLine(m.userId),
  }));

  const inviteRows: InviteDTO[] = invites.map(i => ({
    id: i.id,
    email: i.email,
    name: i.name,
    preset: asStaffPreset(i.preset),
    expires: fmtDay(i.expiresAt),
    expired: i.status === 'expired' || i.expiresAt <= now,
  }));

  const areas: AreaRow[] = AREAS.map(a => ({ key: a as Area, name: DASH_VIEWS.find(v => v.key === a)?.name ?? a }));

  return <TeamPanel members={memberRows} invites={inviteRows} areas={areas} />;
}
