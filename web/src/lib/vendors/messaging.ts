import 'server-only';

// Everything sends through this interface. src/lib/server/deliver.ts routes each message to the provider configured
// on /ops/messages: codes to Twilio and Messaggio, email to Resend, service notices to Twilio SMS. What no provider
// carries goes to MESSAGING_ADAPTER, whose console adapter logs instead of sending so flows are testable end to end.

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
  /** `channel` is the channel that carried the message when it differs from the one asked (a WhatsApp code sent by SMS). */
  send(msg: OutgoingMessage): Promise<{ id: string; channel?: Channel }>;
}

const consoleAdapter: MessagingAdapter = {
  async send(msg) {
    const id = 'dev-' + Math.random().toString(36).slice(2, 10);
    console.info(`[messaging:${msg.channel}] ${msg.template} → ${msg.to}`, msg.vars);
    return { id };
  },
};

/** The adapter every caller uses: the configured providers first (src/lib/server/deliver.ts), then MESSAGING_ADAPTER. */
export function messaging(): MessagingAdapter {
  return {
    async send(msg) {
      const { deliver } = await import('../server/deliver');
      const r = await deliver(msg);
      if (r) return r;
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
