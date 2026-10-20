import { validTwilioSignature } from '@/lib/vendors/twilio';
import { applyTwilioStatus, twilioCreds, twilioStatusUrl } from '@/lib/server/twilio';

// Twilio delivery reports (StatusCallback on every SMS and call made by src/lib/server/twilio.ts). Twilio POSTs a form
// with MessageSid and MessageStatus (queued, sent, delivered, undelivered, failed), or CallSid and CallStatus
// (completed, busy, no-answer, failed, canceled), and an X-Twilio-Signature
// header; requests without a valid signature are refused. The URL used for the signature is the one the site
// gave Twilio (SITE_URL + this path), so proxies in front of the function do not change it.

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const creds = await twilioCreds();
  const url = twilioStatusUrl();
  if (!creds || !url) return new Response('not configured', { status: 503 });
  const form = await req.formData().catch(() => null);
  if (!form) return new Response('bad request', { status: 400 });
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') params[k] = v;
  if (!validTwilioSignature(creds.authToken, url, params, req.headers.get('x-twilio-signature'))) return new Response('forbidden', { status: 403 });
  if (params.AccountSid && params.AccountSid !== creds.accountSid) return new Response('forbidden', { status: 403 });
  await applyTwilioStatus(params);
  return new Response(null, { status: 204 });
}
