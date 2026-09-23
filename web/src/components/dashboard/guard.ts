import 'server-only';
import { notFound } from 'next/navigation';
import { PRESET_NAMES, type Area } from '@/lib/permissions';
import { bizContext } from '@/lib/server/biz';

/**
 * Use at the top of every /biz tab page. Areas with `none` are hidden from the nav and 404 here.
 * Returns the context plus `canEdit` and the role name for <ReadOnlyBanner>.
 */
export async function tabGuard(area: Area) {
  const ctx = await bizContext();
  if (ctx.perms[area] === 'none') notFound();
  return { ...ctx, canEdit: ctx.perms[area] === 'edit', roleName: PRESET_NAMES[ctx.role].name };
}

export async function ownerGuard() {
  const ctx = await bizContext();
  if (!ctx.member.isOwner || ctx.preview) notFound();
  return ctx;
}
