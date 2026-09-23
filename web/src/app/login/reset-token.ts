import 'server-only';
import { db } from '@/lib/server/db';
import { hmac } from '@/lib/server/crypto';

// Password reset links (M17) reuse OtpCode: purpose password_reset, target = email,
// codeHash = hmac(token). 30 minutes, single use.

export const RESET_TTL_MIN = 30;

export const normalizeEmail = (v: string) => v.trim().toLowerCase();

/** The open, unexpired reset row for this email + token, or null. */
export async function findResetToken(email: string, token: string) {
  if (!email || !token || token.length > 200) return null;
  const row = await db.otpCode.findFirst({
    where: { target: normalizeEmail(email), purpose: 'password_reset', codeHash: hmac(token), consumedAt: null },
  });
  if (!row || row.expiresAt < new Date()) return null;
  return row;
}
