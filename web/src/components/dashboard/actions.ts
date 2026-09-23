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
  if (role === 'owner') jar.delete(BIZ_COOKIES.preview);
  else jar.set(BIZ_COOKIES.preview, role, { httpOnly: true, sameSite: 'lax', path: '/biz', secure: process.env.NODE_ENV === 'production' });
  revalidatePath('/biz', 'layout');
}
