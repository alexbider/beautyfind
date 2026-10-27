import type Stripe from 'stripe';
import { handleStripeEvent } from '@/lib/server/billing/webhook';
import { stripe, stripeConfigured } from '@/lib/server/billing/stripe';

// Stripe webhook for BeautyFind's own billing (plans, sponsored weeks).
// Authenticity: with STRIPE_WEBHOOK_SECRET set, the signature is checked. Without it, the event is read
// back from Stripe by id with our secret key, so a forged body can only name a real event of this account.
// A handler error returns 500 so Stripe retries; handlers are idempotent.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!stripeConfigured()) return Response.json({ ok: false, error: 'not_configured' }, { status: 503 });
  const body = await req.text();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;
  try {
    if (secret) {
      const sig = req.headers.get('stripe-signature') ?? '';
      event = await stripe().webhooks.constructEventAsync(body, sig, secret);
    } else {
      const parsed = JSON.parse(body) as { id?: unknown };
      if (typeof parsed.id !== 'string' || !parsed.id.startsWith('evt_')) return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
      event = await stripe().events.retrieve(parsed.id);
    }
  } catch (e) {
    console.warn('[stripe webhook] rejected', (e as Error).message);
    return Response.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event);
    return Response.json({ ok: true, result });
  } catch (e) {
    console.error('[stripe webhook] failed', event.type, event.id, e);
    return Response.json({ ok: false, error: 'handler_failed' }, { status: 500 });
  }
}
