import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { effectivePerms, isPreset, type Area, type Perms, type Preset, DEFAULT_PERMS } from '../permissions';
import { ROUTES } from '../routes';
import { db } from './db';
import { currentUser } from './session';

const BIZ_COOKIE = 'bf_biz';
const PREVIEW_COOKIE = 'bf_preview_role';

/**
 * The signed-in user's business context for /biz. Redirects to login if needed.
 * Owners may preview another role's view (design: "מחובר/ת כ־"), which only narrows permissions.
 */
export const bizContext = cache(async () => {
  const user = await currentUser();
  if (!user || user.kind !== 'business') redirect(`${ROUTES.bizLogin}&next=${encodeURIComponent(ROUTES.dashboard)}`);

  const memberships = await db.staffMember.findMany({
    where: { userId: user.id, status: 'active' },
    include: { business: { include: { branches: { orderBy: { createdAt: 'asc' } }, subscription: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (memberships.length === 0) redirect(ROUTES.join);

  const jar = await cookies();
  const wanted = jar.get(BIZ_COOKIE)?.value;
  const member = memberships.find(m => m.businessId === wanted) ?? memberships[0];
  const business = member.business;
  const branch = business.branches[0] ?? null;

  const realPreset: Preset = member.isOwner ? 'owner' : isPreset(member.preset) ? member.preset : 'practitioner';
  const previewRaw = jar.get(PREVIEW_COOKIE)?.value;
  const preview: Preset | null = member.isOwner && isPreset(previewRaw) && previewRaw !== 'owner' ? previewRaw : null;
  const perms: Perms = preview
    ? DEFAULT_PERMS[preview]
    : effectivePerms({ isOwner: member.isOwner, preset: member.preset, stored: member.permissions });

  return { user, member, business, branch, memberships, realPreset, preview, role: preview ?? realPreset, perms };
});

export type BizContext = Awaited<ReturnType<typeof bizContext>>;

/** For server actions: re-checks the session and the area level. Never trust the client. */
export async function requireArea(area: Area, level: 'view' | 'edit') {
  const ctx = await bizContext();
  const have = ctx.perms[area];
  const ok = level === 'view' ? have !== 'none' : have === 'edit';
  if (!ok) throw new Error(`forbidden: ${area}:${level}`);
  return ctx;
}

export async function requireOwner() {
  const ctx = await bizContext();
  if (!ctx.member.isOwner || ctx.preview) throw new Error('forbidden: owner only');
  return ctx;
}

export const BIZ_COOKIES = { business: BIZ_COOKIE, preview: PREVIEW_COOKIE };
