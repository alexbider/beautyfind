import 'server-only';
import { MessaggioError } from '../vendors/messaggio';
import type { OutgoingMessage } from '../vendors/messaging';
import { TwilioError } from '../vendors/twilio';
import { messaggioAttempt, messaggioReady, verificationText } from './messaggio';
import { twilioAttempt, twilioReady } from './twilio';

// Where a verification code goes (sign-in, sign-up, ownership claims, staff invites):
//   SMS       → Twilio when it is on; otherwise Messaggio's SMS when that is on.
//   WhatsApp  → Messaggio's WhatsApp when it is on and has a sender; a refused send is retried once as SMS
//               (the SMS route above) when "גיבוי ב־SMS" is on. With no WhatsApp route the code goes by SMS.
// Nothing configured: null, and the caller keeps MESSAGING_ADAPTER (the log). All attempts fail: throws.

/** The templates that are verification codes. Other messages never come here. */
export const VERIFY_TEMPLATES = new Set(['M16_otp']);

type Attempt = { provider: 'twilio' | 'messaggio'; run: () => Promise<{ id: string }> };

export async function sendVerification(msg: OutgoingMessage): Promise<{ id: string } | null> {
  if ((msg.channel !== 'sms' && msg.channel !== 'whatsapp') || !VERIFY_TEMPLATES.has(msg.template)) return null;
  const [mg, tw] = await Promise.all([messaggioReady(), twilioReady()]);
  const text = verificationText(msg.template, msg.vars);
  const sms = (fallbackFrom?: string): Attempt | null =>
    tw ? { provider: 'twilio', run: () => twilioAttempt(tw, msg, text, { fallbackFrom }) }
      : mg?.sms ? { provider: 'messaggio', run: () => messaggioAttempt(mg.cfg, 'sms', msg, text, { fallbackFrom }) }
        : null;

  const attempts: Attempt[] = [];
  if (msg.channel === 'whatsapp' && mg?.whatsapp) {
    attempts.push({ provider: 'messaggio', run: () => messaggioAttempt(mg.cfg, 'whatsapp', msg, text) });
    const fb = mg.fallbackToSms ? sms('whatsapp') : null;
    if (fb) attempts.push(fb);
  } else {
    const a = sms(msg.channel === 'whatsapp' ? 'whatsapp' : undefined);
    if (a) attempts.push(a);
  }
  if (!attempts.length) return null;

  let last: unknown = null;
  const refused = new Set<string>();
  for (const a of attempts) {
    if (refused.has(a.provider)) continue; // a provider that rejected the credentials is not asked again
    try {
      return await a.run();
    } catch (e) {
      last = e;
      const status = e instanceof MessaggioError || e instanceof TwilioError ? e.status : 0;
      if (status === 401 || status === 403) refused.add(a.provider);
    }
  }
  throw last instanceof Error ? last : new Error('verification code not sent');
}
