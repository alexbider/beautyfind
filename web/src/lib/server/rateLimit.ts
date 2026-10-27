import 'server-only';
import { headers } from 'next/headers';
import { db } from './db';

// Shared rate limits, stored in Postgres so every server instance counts the same requests.
// A fixed window per key: the first hit in a new window resets the count. One atomic upsert per check.
// Keys look like "login:ip:203.0.113.5" or "otp:target:+972501234567".

/** The caller's IP on Vercel (x-vercel-forwarded-for, then x-forwarded-for). "unknown" outside a request. */
export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return (h.get('x-vercel-forwarded-for') ?? h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '').split(',')[0].trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface Limit {
  /** Requests allowed per window. */
  max: number;
  /** Window length in seconds. */
  windowS: number;
}

/**
 * Counts one hit for `key` and says whether it is within the limit. Fails open (allows) if the database
 * call fails, so an outage of the limiter never blocks sign-in or booking.
 */
export async function hit(key: string, limit: Limit): Promise<{ ok: boolean; retryInSeconds: number }> {
  const now = Date.now();
  const start = new Date(Math.floor(now / (limit.windowS * 1000)) * limit.windowS * 1000);
  try {
    const rows = await db.$queryRaw<Array<{ count: number }>>`
      INSERT INTO rate_limits (key, window_start, count) VALUES (${key.slice(0, 200)}, ${start}, 1)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limits.window_start = EXCLUDED.window_start THEN rate_limits.count + 1 ELSE 1 END,
        window_start = EXCLUDED.window_start
      RETURNING count`;
    const count = Number(rows[0]?.count ?? 1);
    // Now and then, clear counters from windows long gone.
    if (Math.random() < 0.01) void db.$executeRaw`DELETE FROM rate_limits WHERE window_start < ${new Date(now - 2 * 86_400_000)}`.catch(() => undefined);
    const retry = Math.max(1, Math.ceil((start.getTime() + limit.windowS * 1000 - now) / 1000));
    return { ok: count <= limit.max, retryInSeconds: retry };
  } catch (e) {
    console.error('[rate-limit] check failed, allowing', key.split(':')[0], e instanceof Error ? e.message : e);
    return { ok: true, retryInSeconds: 0 };
  }
}

/** All limits must pass. Every key is counted, so a blocked attempt still uses up the budget. */
export async function hitAll(checks: Array<[string, Limit]>): Promise<{ ok: boolean; retryInSeconds: number }> {
  const results = await Promise.all(checks.map(([k, l]) => hit(k, l)));
  const bad = results.filter(r => !r.ok);
  return bad.length ? { ok: false, retryInSeconds: Math.max(...bad.map(r => r.retryInSeconds)) } : { ok: true, retryInSeconds: 0 };
}

const M = 60;
const H = 3600;
/** The limits used across the site, in one place. */
export const LIMITS = {
  passwordIp: { max: 20, windowS: 15 * M },
  passwordAccount: { max: 10, windowS: 15 * M },
  codeIp: { max: 10, windowS: H }, // codes requested from one network
  codeTarget: { max: 6, windowS: H }, // codes sent to one phone or email
  codeTargetDay: { max: 15, windowS: 24 * H },
  resetIp: { max: 10, windowS: H },
  staffIp: { max: 15, windowS: 15 * M },
  staffAccountIp: { max: 5, windowS: 15 * M }, // wrong passwords for one staff account from one network
  formIp: { max: 20, windowS: H }, // bookings, consults, gift purchases from one network
  giftLookupIp: { max: 10, windowS: 10 * M },
} satisfies Record<string, Limit>;
