'use server';

import { siteUrl } from '@/lib/server/site';
import { Prisma, type AccountKind } from '@prisma/client';
import { z } from 'zod';
import { EMAIL_RE, toE164 } from '@/lib/format';
import { hashPassword, hmac, randomToken, verifyPassword } from '@/lib/server/crypto';
import { db } from '@/lib/server/db';
import { sendOtp, verifyOtp } from '@/lib/server/otp';
import { createSession } from '@/lib/server/session';
import { messaging } from '@/lib/vendors/messaging';
import { ROUTES } from '@/lib/routes';
import { destinationFor } from './redirects';
import { RESET_TTL_MIN, findResetToken, normalizeEmail } from './reset-token';

// Server Actions for /login. Every action validates its input with zod and returns a
// typed result; the client screen maps error codes to the design's copy.

export type AuthError =
  | 'invalid_input'
  | 'unknown_phone'
  | 'phone_taken'
  | 'email_taken'
  | 'cooldown'
  | 'bad_credentials'
  | 'otp_invalid'
  | 'otp_expired'
  | 'otp_too_many'
  | 'reset_invalid';

export type Fail = { ok: false; error: AuthError; retryInSeconds?: number };
export type CodeSent = { ok: true; phone: string; cooldownSeconds: number };
export type SignedIn = { ok: true; kind: AccountKind; redirectTo: string };

const fail = (error: AuthError, retryInSeconds?: number): Fail => ({ ok: false, error, ...(retryInSeconds ? { retryInSeconds } : {}) });

const phone = z.string().trim().max(24).transform((v, ctx) => {
  const e164 = toE164(v);
  if (!e164) {
    ctx.addIssue({ code: 'custom', message: 'phone' });
    return z.NEVER;
  }
  return e164;
});
const email = z.string().trim().max(254).regex(EMAIL_RE).transform(normalizeEmail);
const password = z.string().min(8).max(200);
const channel = z.enum(['whatsapp', 'sms']);
const next = z.string().max(512).nullish();
const code = z.string().trim().regex(/^\d{6}$/);

const otpError = (e: 'invalid' | 'expired' | 'too_many_attempts'): Fail =>
  fail(e === 'expired' ? 'otp_expired' : e === 'too_many_attempts' ? 'otp_too_many' : 'otp_invalid');

/* ---------- Sign-in by code (clients, and businesses as an alternative) ---------- */

const signinCodeInput = z.object({ phone, channel });

export async function sendSigninCode(input: z.input<typeof signinCodeInput>): Promise<CodeSent | Fail> {
  const p = signinCodeInput.safeParse(input);
  if (!p.success) return fail('invalid_input');
  const user = await db.user.findUnique({ where: { phone: p.data.phone }, select: { id: true } });
  if (!user) return fail('unknown_phone');
  const sent = await sendOtp({ target: p.data.phone, channel: p.data.channel, purpose: 'login' });
  if (!sent.ok) return fail('cooldown', sent.retryInSeconds);
  return { ok: true, phone: p.data.phone, cooldownSeconds: sent.cooldownSeconds };
}

const verifySigninInput = z.object({ phone, code, remember: z.boolean(), next });

export async function verifySigninCode(input: z.input<typeof verifySigninInput>): Promise<SignedIn | Fail> {
  const p = verifySigninInput.safeParse(input);
  if (!p.success) return fail('otp_invalid');
  const res = await verifyOtp({ target: p.data.phone, purpose: 'login', code: p.data.code });
  if (!res.ok) return otpError(res.error);
  const user = await db.user.findUnique({ where: { phone: p.data.phone } });
  if (!user) return fail('unknown_phone');
  if (!user.phoneVerifiedAt) await db.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });
  await createSession(user.id, p.data.remember);
  return { ok: true, kind: user.kind, redirectTo: destinationFor(user.kind, p.data.next ?? null) };
}

/* ---------- Sign-in by password (businesses) ---------- */

const passwordSigninInput = z.object({ ident: z.string().trim().min(1).max(254), password: z.string().min(1).max(200), remember: z.boolean(), next });

// Compared against when no user matches, so a miss costs the same time as a hit.
let dummyHash: Promise<string> | null = null;

export async function passwordSignin(input: z.input<typeof passwordSigninInput>): Promise<SignedIn | Fail> {
  const p = passwordSigninInput.safeParse(input);
  if (!p.success) return fail('bad_credentials');
  const { ident } = p.data;
  const e164 = EMAIL_RE.test(ident) ? null : toE164(ident);
  const user = EMAIL_RE.test(ident)
    ? await db.user.findUnique({ where: { email: normalizeEmail(ident) } })
    : e164
      ? await db.user.findUnique({ where: { phone: e164 } })
      : null;
  if (!user?.passwordHash) {
    dummyHash ??= hashPassword('bf-timing-equaliser');
    await verifyPassword(p.data.password, await dummyHash);
    return fail('bad_credentials');
  }
  if (!(await verifyPassword(p.data.password, user.passwordHash))) return fail('bad_credentials');
  await createSession(user.id, p.data.remember);
  return { ok: true, kind: user.kind, redirectTo: destinationFor(user.kind, p.data.next ?? null) };
}

/* ---------- Sign-up (phone verified by code, then the account is created) ---------- */

const signupInput = z
  .object({
    role: z.enum(['client', 'biz']),
    name: z.string().trim().min(2).max(120),
    bizName: z.string().trim().max(160).optional(),
    phone,
    email: z.union([email, z.literal('')]),
    password: z.string().max(200).optional(),
    tos: z.boolean().refine(v => v),
    owner: z.boolean().optional(),
    marketing: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.role !== 'biz') return;
    if (!v.bizName || v.bizName.length < 2) ctx.addIssue({ code: 'custom', path: ['bizName'], message: 'bizName' });
    if (!v.email) ctx.addIssue({ code: 'custom', path: ['email'], message: 'email' });
    if (!password.safeParse(v.password).success) ctx.addIssue({ code: 'custom', path: ['password'], message: 'password' });
    if (v.owner !== true) ctx.addIssue({ code: 'custom', path: ['owner'], message: 'owner' });
  });

type SignupData = z.output<typeof signupInput>;

async function takenError(d: SignupData): Promise<Fail | null> {
  if (d.email && (await db.user.findUnique({ where: { email: d.email }, select: { id: true } }))) return fail('email_taken');
  if (await db.user.findUnique({ where: { phone: d.phone }, select: { id: true } })) return fail('phone_taken');
  return null;
}

const sendSignupInput = z.object({ form: signupInput, channel });

export async function sendSignupCode(input: z.input<typeof sendSignupInput>): Promise<CodeSent | Fail> {
  const p = sendSignupInput.safeParse(input);
  if (!p.success) return fail('invalid_input');
  const taken = await takenError(p.data.form);
  if (taken) return taken;
  const sent = await sendOtp({ target: p.data.form.phone, channel: p.data.channel, purpose: 'signup' });
  if (!sent.ok) return fail('cooldown', sent.retryInSeconds);
  return { ok: true, phone: p.data.form.phone, cooldownSeconds: sent.cooldownSeconds };
}

const completeSignupInput = z.object({ form: signupInput, code, remember: z.boolean(), next });

export async function completeSignup(input: z.input<typeof completeSignupInput>): Promise<SignedIn | Fail> {
  const p = completeSignupInput.safeParse(input);
  if (!p.success) return fail(p.error.issues.some(i => i.path[0] === 'code') ? 'otp_invalid' : 'invalid_input');
  const { form } = p.data;
  const taken = await takenError(form);
  if (taken) return taken;
  const res = await verifyOtp({ target: form.phone, purpose: 'signup', code: p.data.code });
  if (!res.ok) return otpError(res.error);

  const biz = form.role === 'biz';
  const now = new Date();
  let user;
  try {
    user = await db.user.create({
      data: {
        phone: form.phone,
        email: form.email || null,
        fullName: form.name,
        kind: biz ? 'business' : 'client',
        passwordHash: biz && form.password ? await hashPassword(form.password) : null,
        phoneVerifiedAt: now,
        termsAcceptedAt: now,
        marketingOptIn: form.marketing,
      },
    });
  } catch (e) {
    // Lost a race with another sign-up for the same phone or email.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = String((e.meta as { target?: unknown } | undefined)?.target ?? '');
      return fail(target.includes('email') ? 'email_taken' : 'phone_taken');
    }
    throw e;
  }
  await createSession(user.id, p.data.remember);
  return { ok: true, kind: user.kind, redirectTo: destinationFor(user.kind, p.data.next ?? null, biz ? form.bizName : undefined) };
}

/* ---------- Password reset (M17) ---------- */

const RESET_REQUEST_GAP_S = 30;

async function siteOrigin(): Promise<string> {
  // Never derive email links from request headers: a spoofed Host would send reset links to another domain.
  return siteUrl();
}

const resetRequestInput = z.object({ ident: z.string().trim().min(1).max(254) });

/** Always answers the same way, whether or not an account matched. */
export async function requestPasswordReset(input: z.input<typeof resetRequestInput>): Promise<{ ok: true }> {
  const p = resetRequestInput.safeParse(input);
  if (!p.success) return { ok: true };
  const { ident } = p.data;
  const e164 = EMAIL_RE.test(ident) ? null : toE164(ident);
  const user = EMAIL_RE.test(ident)
    ? await db.user.findUnique({ where: { email: normalizeEmail(ident) } })
    : e164
      ? await db.user.findUnique({ where: { phone: e164 } })
      : null;
  if (!user || user.kind !== 'business' || !user.email) return { ok: true };

  const target = normalizeEmail(user.email);
  const last = await db.otpCode.findFirst({ where: { target, purpose: 'password_reset' }, orderBy: { createdAt: 'desc' } });
  if (last && Date.now() - last.createdAt.getTime() < RESET_REQUEST_GAP_S * 1000) return { ok: true };

  const token = randomToken();
  // Only the newest link works.
  await db.otpCode.updateMany({ where: { target, purpose: 'password_reset', consumedAt: null }, data: { consumedAt: new Date() } });
  await db.otpCode.create({
    data: {
      target,
      channel: 'email',
      purpose: 'password_reset',
      codeHash: hmac(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60_000),
    },
  });
  const qs = new URLSearchParams({ view: 'reset', token, email: target });
  await messaging().send({
    channel: 'email',
    to: target,
    template: 'M17_reset',
    vars: { name: user.fullName ?? '', link: `${await siteOrigin()}${ROUTES.login}?${qs.toString()}`, minutes: String(RESET_TTL_MIN) },
    kind: 'service',
  });
  return { ok: true };
}

const completeResetInput = z.object({ email, token: z.string().min(10).max(200), password, next });

export async function completePasswordReset(input: z.input<typeof completeResetInput>): Promise<SignedIn | Fail> {
  const p = completeResetInput.safeParse(input);
  if (!p.success) return fail(p.error.issues.some(i => i.path[0] === 'password') ? 'invalid_input' : 'reset_invalid');
  const row = await findResetToken(p.data.email, p.data.token);
  if (!row) return fail('reset_invalid');
  const user = await db.user.findUnique({ where: { email: row.target } });
  if (!user) return fail('reset_invalid');

  const passwordHash = await hashPassword(p.data.password);
  // Consume the token only if it is still open, so two tabs cannot both use it.
  const consumed = await db.$transaction(async tx => {
    const c = await tx.otpCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (c.count !== 1) return false;
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date() } });
    // A new password signs out every other device.
    await tx.session.deleteMany({ where: { userId: user.id } });
    return true;
  });
  if (!consumed) return fail('reset_invalid');
  await createSession(user.id, true);
  return { ok: true, kind: user.kind, redirectTo: destinationFor(user.kind, p.data.next ?? null) };
}
