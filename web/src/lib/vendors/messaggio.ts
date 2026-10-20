import 'server-only';

// Messaggio (messaggio.com): SMS and WhatsApp for verification codes. The request shape lives only here, so a
// difference from Messaggio's current API is a change to this file and its test, nothing else.
//
// POST {baseUrl}/send with the header "Messaggio-Login: <API login>" and a JSON body naming the recipients,
// the channel and the channel's content. The answer lists one message per recipient with its message_uid.
// Phones are sent as international digits without "+".

export interface MessaggioConfig {
  login: string;
  baseUrl: string;
  smsSender: string;
  whatsappSender: string;
  whatsappTemplate: string;
}

export type MessaggioChannel = 'sms' | 'whatsapp';

export class MessaggioError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** International digits without "+" (Messaggio's phone format). Null for anything that is not a phone. */
export function messaggioPhone(e164: string): string | null {
  const digits = e164.replace(/[^\d]/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

/** "+972541234567" becomes "+97254•••4567": enough to recognise a test send, not enough to contact anyone. */
export function maskPhone(e164: string): string {
  const d = e164.replace(/[^\d+]/g, '');
  return d.length > 7 ? `${d.slice(0, 6)}•••${d.slice(-4)}` : '•••';
}

/** The request body for one message on one channel. */
export function messaggioBody(cfg: MessaggioConfig, channel: MessaggioChannel, phone: string, text: string, vars: Record<string, string> = {}): object {
  const content = channel === 'whatsapp' && cfg.whatsappTemplate
    ? [{ type: 'template', template: { name: cfg.whatsappTemplate, params: vars.code ? [vars.code] : [] } }]
    : [{ type: 'text', text }];
  return {
    recipients: [{ phone }],
    channels: [channel],
    [channel]: { from: channel === 'sms' ? cfg.smsSender : cfg.whatsappSender, content },
  };
}

/** Sends one message. Returns Messaggio's message id; throws MessaggioError with Messaggio's own reason. */
export async function messaggioSend(cfg: MessaggioConfig, channel: MessaggioChannel, to: string, text: string, vars: Record<string, string> = {}): Promise<{ id: string }> {
  const phone = messaggioPhone(to);
  if (!phone) throw new MessaggioError('invalid phone number', 400);
  if (channel === 'whatsapp' && !cfg.whatsappSender) throw new MessaggioError('no WhatsApp sender configured', 400);
  const r = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/send`, {
    method: 'POST',
    headers: { 'Messaggio-Login': cfg.login, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(messaggioBody(cfg, channel, phone, text, vars)),
    signal: AbortSignal.timeout(15_000),
  }).catch(e => { throw new MessaggioError(`network: ${e instanceof Error ? e.message : String(e)}`, 0); });
  const raw = await r.text();
  let j: Record<string, unknown> = {};
  try { j = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}; } catch { /* not JSON */ }
  if (!r.ok) {
    const detail = j.detail ?? j.message ?? j.error ?? (Array.isArray(j.errors) ? JSON.stringify(j.errors) : null) ?? raw.slice(0, 200);
    throw new MessaggioError(`HTTP ${r.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`.slice(0, 300), r.status);
  }
  const first = (Array.isArray(j.messages) ? j.messages[0] : j) as Record<string, unknown> | undefined;
  const id = first?.message_uid ?? first?.messageUid ?? first?.uid ?? first?.id;
  return { id: typeof id === 'string' || typeof id === 'number' ? String(id) : 'accepted' };
}
