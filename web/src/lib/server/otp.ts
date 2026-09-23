import 'server-only';
import type { OtpChannel, OtpPurpose, Prisma } from '@prisma/client';
import { db } from './db';
import { hmac, randomDigits } from './crypto';
import { messaging } from '../vendors/messaging';

const TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_S = 30;

export type OtpSendResult = { ok: true; cooldownSeconds: number } | { ok: false; error: 'cooldown'; retryInSeconds: number };

/** Sends a 6-digit code (M16). Only an HMAC of the code is stored. */
export async function sendOtp(opts: {
  target: string;
  channel: OtpChannel;
  purpose: OtpPurpose;
  context?: Prisma.InputJsonValue;
}): Promise<OtpSendResult> {
  const last = await db.otpCode.findFirst({
    where: { target: opts.target, purpose: opts.purpose },
    orderBy: { createdAt: 'desc' },
  });
  if (last) {
    const age = (Date.now() - last.createdAt.getTime()) / 1000;
    if (age < RESEND_COOLDOWN_S) return { ok: false, error: 'cooldown', retryInSeconds: Math.ceil(RESEND_COOLDOWN_S - age) };
  }
  const code = process.env.NODE_ENV !== 'production' && process.env.DEV_FIXED_OTP ? process.env.DEV_FIXED_OTP : randomDigits(6);
  await db.otpCode.create({
    data: {
      target: opts.target,
      channel: opts.channel,
      purpose: opts.purpose,
      codeHash: hmac(`${opts.target}:${opts.purpose}:${code}`),
      expiresAt: new Date(Date.now() + TTL_MIN * 60_000),
      context: opts.context,
    },
  });
  await messaging().send({
    channel: opts.channel,
    to: opts.target,
    template: 'M16_otp',
    vars: { code, minutes: String(TTL_MIN) },
    kind: 'service',
  });
  return { ok: true, cooldownSeconds: RESEND_COOLDOWN_S };
}

export type OtpVerifyResult =
  | { ok: true; context: Prisma.JsonValue | null }
  | { ok: false; error: 'invalid' | 'expired' | 'too_many_attempts' };

/** Checks the latest open code for target + purpose and consumes it on success. */
export async function verifyOtp(opts: { target: string; purpose: OtpPurpose; code: string }): Promise<OtpVerifyResult> {
  const row = await db.otpCode.findFirst({
    where: { target: opts.target, purpose: opts.purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return { ok: false, error: 'invalid' };
  if (row.expiresAt < new Date()) return { ok: false, error: 'expired' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'too_many_attempts' };
  if (row.codeHash !== hmac(`${opts.target}:${opts.purpose}:${opts.code.trim()}`)) {
    await db.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, error: 'invalid' };
  }
  await db.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  return { ok: true, context: row.context };
}
