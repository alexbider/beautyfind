import { validSvix } from '@/lib/vendors/resend';
import { applyResendEvent, resendWebhookSecret } from '@/lib/server/email';

// Resend events (Webhooks in the Resend dashboard, pointed at SITE_URL/api/resend/webhook): sent, opened, clicked,
// received (replies on the reply domain, src/lib/server/emailTracking.ts),
// delivered, delayed, bounced, complained, failed. Each request is checked against the signing secret (Svix
// headers); unsigned or wrongly signed requests are refused. The event updates the matching message_sends row.

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const hook = await resendWebhookSecret();
  if (!hook) { console.warn('[resend-hook] no signing secret stored'); return new Response('not configured', { status: 503 }); }
  const body = await req.text();
  const ok = validSvix(hook.secret, { id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature') }, body);
  if (!ok) { console.warn(`[resend-hook] refused: bad signature (svix-id ${req.headers.get('svix-id') ?? 'none'})`); return new Response('forbidden', { status: 403 }); }
  let event: { type?: unknown; data?: unknown };
  try { event = JSON.parse(body); } catch { return new Response('bad request', { status: 400 }); }
  const applied = await applyResendEvent(event, req.headers.get('svix-id'));
  const d = (event.data && typeof event.data === 'object' ? event.data : {}) as Record<string, unknown>;
  console.info(`[resend-hook] ${String(event.type)} ${String(d.email_id ?? '')} ${applied ? 'applied' : 'no change'}`);
  return new Response(null, { status: 204 });
}
