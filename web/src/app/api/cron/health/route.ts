import { timingSafeEqual } from 'node:crypto';
import { runHealthCheck } from '@/lib/server/alerts';

// Daily health check (vercel.json "crons"). Vercel calls it with "Authorization: Bearer <CRON_SECRET>".
// Problems found are sent by SMS to OPS_ALERT_PHONES (src/lib/server/alerts.ts).

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, error: 'not_configured' }, { status: 503 });
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!given || !same(given, secret)) return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
  const r = await runHealthCheck();
  return Response.json({ ok: true, ...r });
}
