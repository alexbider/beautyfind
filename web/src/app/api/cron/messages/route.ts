import { timingSafeEqual } from 'node:crypto';
import { planAutomations } from '@/lib/server/automations';
import { runQueue } from '@/lib/server/scheduler';

// The message scheduler (vercel.json "crons", several times a day inside Israeli daytime). First the automations
// queue whatever became due (each message once, by key), then the queue sends what is due inside the sending
// window. Vercel calls it with "Authorization: Bearer <CRON_SECRET>".

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, error: 'not_configured' }, { status: 503 });
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!given || !same(given, secret)) return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
  const planned = await planAutomations();
  const sent = await runQueue(new Date(), 40_000);
  return Response.json({ ok: true, planned, sent });
}
