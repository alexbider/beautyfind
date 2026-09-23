'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { isPreset } from '@/lib/permissions';
import { BIZ_COOKIES, bizContext } from '@/lib/server/biz';

/** Owner-only: preview the dashboard as another role. 'owner' clears the preview. */
export async function setPreviewRole(role: string) {
  const ctx = await bizContext();
  if (!ctx.member.isOwner || !isPreset(role)) return;
  const jar = await cookies();
  // Same path as when it was set, or the browser keeps the /biz cookie and the preview never ends.
  if (role === 'owner') jar.delete({ name: BIZ_COOKIES.preview, path: '/biz' });
  else jar.set(BIZ_COOKIES.preview, role, { httpOnly: true, sameSite: 'lax', path: '/biz', secure: process.env.NODE_ENV === 'production' });
  revalidatePath('/biz', 'layout');
}

/** Open the dashboard on another business the user is an active member of (top bar switcher). */
export async function switchBusiness(businessId: string) {
  const ctx = await bizContext();
  if (!ctx.memberships.some(m => m.businessId === businessId)) return;
  const jar = await cookies();
  jar.set(BIZ_COOKIES.business, businessId, { httpOnly: true, sameSite: 'lax', path: '/biz', secure: process.env.NODE_ENV === 'production' });
  // A role preview belongs to the business it was picked on.
  jar.delete({ name: BIZ_COOKIES.preview, path: '/biz' });
  revalidatePath('/biz', 'layout');
}
