import { validSvix } from '@/lib/vendors/resend';
import { applyResendEvent, resendWebhookSecret } from '@/lib/server/email';

// Resend delivery events (Webhooks in the Resend dashboard, pointed at SITE_URL/api/resend/webhook): sent,
// delivered, delayed, bounced, complained, failed. Each request is checked against the signing secret (Svix
// headers); unsigned or wrongly signed requests are refused. The event updates the matching message_sends row.

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const hook = await resendWebhookSecret();
  if (!hook) return new Response('not configured', { status: 503 });
  const body = await req.text();
  const ok = validSvix(hook.secret, { id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature') }, body);
  if (!ok) return new Response('forbidden', { status: 403 });
  let event: { type?: unknown; data?: unknown };
  try { event = JSON.parse(body); } catch { return new Response('bad request', { status: 400 }); }
  await applyResendEvent(event);
  return new Response(null, { status: 204 });
}
