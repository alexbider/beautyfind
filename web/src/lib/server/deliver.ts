import 'server-only';
import { renderMessage } from '../messages/render';
import type { Channel, OutgoingMessage } from '../vendors/messaging';
import { emailReady, sendTemplateEmail } from './email';
import { siteUrl } from './site';
import { twilioAttempt, twilioReady } from './twilio';
import { VERIFY_TEMPLATES, sendVerification } from './verificationSend';

// Where every outgoing message goes:
//   Verification codes by SMS, WhatsApp or voice → sendVerification (Twilio, Messaggio).
//   Email (codes included)                       → Resend, when it is on.
//   Service notices by WhatsApp or SMS           → Twilio SMS with the same text, until WhatsApp templates are
//                                                  approved; logged with fallback_from = whatsapp.
//   Marketing, unknown templates, or no provider → null: the caller keeps MESSAGING_ADAPTER (the log).
// A verification code that cannot be sent throws (the code is dropped and the person can ask again). Any other
// message that fails is logged in message_sends and does not throw, so a booking or a form never fails on it.

export async function deliver(msg: OutgoingMessage): Promise<{ id: string; channel: Channel } | null> {
  const isCode = VERIFY_TEMPLATES.has(msg.template);
  if (isCode && msg.channel !== 'email') return sendVerification(msg);
  if (msg.kind !== 'service' && !msg.cleared) return null;
  try {
    if (msg.channel === 'email') {
      const cfg = await emailReady();
      if (!cfg) return null;
      const r = await sendTemplateEmail(cfg, msg);
      return r ? { ...r, channel: 'email' } : null;
    }
    if (msg.channel === 'whatsapp' || msg.channel === 'sms') {
      const rendered = renderMessage(msg.template, msg.vars, siteUrl());
      const tw = rendered ? await twilioReady() : null;
      if (!rendered || !tw) return null;
      const r = await twilioAttempt(tw, msg, rendered.sms, { fallbackFrom: msg.channel === 'whatsapp' ? 'whatsapp' : undefined });
      return { ...r, channel: 'sms' };
    }
    return null;
  } catch (e) {
    if (isCode) throw e;
    console.error('[deliver] not sent', msg.template, msg.channel, e instanceof Error ? e.message : String(e));
    return { id: 'failed', channel: msg.channel };
  }
}
