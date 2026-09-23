'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ROUTES } from '@/lib/routes';
import { BIZ_COOKIES } from '@/lib/server/biz';
import { createSession, currentUser, destroySession } from '@/lib/server/session';
import {
  acceptInviteCore,
  declineInviteCore,
  requestNewInviteCore,
  sendInviteCodeCore,
  type Accepted,
  type CodeSent,
  type Fail,
} from './invite';
import { PROFS, TOKEN_RE, invitePath, type InviteForm } from './shared';

// Server Actions for /invite/[token]. Inputs are parsed with zod, then invite.ts
// re-validates the invite, the account and every form rule on each call.

const token = z.string().regex(TOKEN_RE);
const form = z.object({
  name: z.string().max(120),
  phone: z.string().max(24),
  password: z.string().max(200),
  profession: z.union([z.enum(PROFS.map(p => p.key) as [string, ...string[]]), z.literal('')]),
  license: z.string().max(24),
  specialty: z.string().max(120),
  cert: z.string().max(24),
});

const bad: Fail = { ok: false, error: 'invalid_input' };

export async function sendInviteCode(input: { token: string; form: InviteForm }): Promise<CodeSent | Fail> {
  const p = z.object({ token, form }).safeParse(input);
  if (!p.success) return bad;
  return sendInviteCodeCore(p.data.token, p.data.form as InviteForm, await currentUser());
}

export type AcceptResult = Omit<Accepted, 'userId' | 'businessId'> | Fail;

export async function acceptInvite(input: { token: string; form: InviteForm; code: string | null }): Promise<AcceptResult> {
  const p = z.object({ token, form, code: z.string().max(12).nullable() }).safeParse(input);
  if (!p.success) return bad;
  const current = await currentUser();
  const res = await acceptInviteCore(p.data.token, p.data.form as InviteForm, p.data.code?.replace(/\D/g, '') ?? null, current);
  if (!res.ok) return res;

  if (current?.id !== res.userId) await createSession(res.userId, true);
  // Open the dashboard on the business they just joined.
  (await cookies()).set(BIZ_COOKIES.business, res.businessId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/biz',
    secure: process.env.NODE_ENV === 'production',
  });
  const { userId: _u, businessId: _b, ...out } = res;
  return out;
}

export async function declineInvite(input: { token: string }): Promise<{ ok: true } | Fail> {
  const p = z.object({ token }).safeParse(input);
  if (!p.success) return bad;
  return declineInviteCore(p.data.token);
}

export async function requestNewInvite(input: { token: string }): Promise<{ ok: true } | Fail> {
  const p = z.object({ token }).safeParse(input);
  if (!p.success) return bad;
  return requestNewInviteCore(p.data.token);
}

/** Signs out the current account, then back to the invite or on to sign-in (form action). */
export async function switchAccount(formData: FormData) {
  const t = formData.get('token');
  await destroySession();
  if (typeof t !== 'string' || !TOKEN_RE.test(t)) redirect(ROUTES.home);
  redirect(formData.get('then') === 'login' ? `${ROUTES.bizLogin}&next=${encodeURIComponent(invitePath(t))}` : invitePath(t));
}
