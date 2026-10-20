import 'server-only';

// Everything sends through this interface. Verification codes by SMS and WhatsApp go through Messaggio when
// it is configured on /ops/messages; the other messages (WhatsApp templates, email) have no provider yet and
// go to MESSAGING_ADAPTER, whose console adapter logs instead of sending so flows are testable end to end.

export type Channel = 'whatsapp' | 'sms' | 'voice' | 'email';

export interface OutgoingMessage {
  channel: Channel;
  to: string; // E.164 or email
  template: string; // e.g. M16 otp
  vars: Record<string, string>;
  /** service messages ignore marketing consent */
  kind: 'service' | 'marketing';
}

export interface MessagingAdapter {
  send(msg: OutgoingMessage): Promise<{ id: string }>;
}

const consoleAdapter: MessagingAdapter = {
  async send(msg) {
    const id = 'dev-' + Math.random().toString(36).slice(2, 10);
    console.info(`[messaging:${msg.channel}] ${msg.template} → ${msg.to}`, msg.vars);
    return { id };
  },
};

/**
 * The adapter every caller uses. Verification codes by SMS or WhatsApp go to Messaggio when it is switched on
 * and has a key (src/lib/server/messaggio.ts); everything else, and codes while Messaggio is off, goes to the
 * MESSAGING_ADAPTER below exactly as before.
 */
export function messaging(): MessagingAdapter {
  return {
    async send(msg) {
      if (msg.channel === 'sms' || msg.channel === 'whatsapp') {
        const { sendViaMessaggio } = await import('../server/messaggio');
        const r = await sendViaMessaggio(msg);
        if (r) return r;
      }
      return baseAdapter().send(msg);
    },
  };
}

function baseAdapter(): MessagingAdapter {
  const name = process.env.MESSAGING_ADAPTER ?? 'console';
  switch (name) {
    case 'console':
      // It prints OTP codes and invite links to the log, so it must never run in production.
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_CONSOLE_MESSAGING !== '1') {
        throw new Error('MESSAGING_ADAPTER=console is not allowed in production');
      }
      return consoleAdapter;
    default:
      throw new Error(`Unknown MESSAGING_ADAPTER "${name}"`);
  }
}
