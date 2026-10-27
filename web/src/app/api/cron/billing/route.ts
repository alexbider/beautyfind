import { timingSafeEqual } from 'node:crypto';
import { runBillingCron } from '@/lib/server/billing';

// Daily billing run (vercel.json "crons"). Vercel calls it with "Authorization: Bearer <CRON_SECRET>";
// without CRON_SECRET the route refuses every call. What a run does: runBillingCron in
// src/lib/server/billing/index.ts.

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, error: 'not_configured' }, { status: 503 });
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!given || !same(given, secret)) return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
  const r = await runBillingCron();
  return Response.json({ ok: true, ...r });
}
