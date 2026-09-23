import 'server-only';

// Messaging vendors (WhatsApp BSP, SMS gateway, transactional email) are not chosen yet
// (see 08-open-decisions.md §B). Everything sends through this interface; the console
// adapter logs instead of sending so flows are testable end to end.

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

export function messaging(): MessagingAdapter {
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
