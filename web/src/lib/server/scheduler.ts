import 'server-only';
import type { ScheduledMessage } from '@prisma/client';
import { nextSendable } from '../sendWindow';
import type { Channel } from '../vendors/messaging';
import { db } from './db';
import { deliver } from './deliver';
import { emailReady } from './email';
import { platformSettings, type PlatformSettings } from './platformSettings';
import { open, seal } from './secure';

export { nextSendable };
import { twilioReady } from './twilio';

// The message scheduler. Automations enqueue messages with a stable key (so the same message is never queued
// twice) and the cron at /api/cron/messages sends what is due. Before each send:
//   1. the automation's switch on /ops/automations must be on (off holds the message, it is not dropped);
//   2. the message must still be useful (staleAt), and still make sense (the automation's own check, for example
//      no review request once the client already wrote one);
//   3. it must be inside the sending window: 08:00 to 21:00 Israel time for everything, and for marketing
//      also not on Shabbat, holidays or memorial days (05-messages.md);
//   4. marketing goes only to contacts who did not opt out (message_consents), with an unsubscribe link;
//   5. a provider must be connected for the channel. An email waits for Resend, or goes by SMS when the
//      message has a phone fallback. Nothing is marked sent unless a provider took it.

export type Automation = 'review_request' | 'gift_delivery' | 'gift_expiry' | 'payment_failed' | 'sponsored' | 'onboarding' | 'claim_invite';
export type SendChannel = 'email' | 'whatsapp' | 'sms';

export const AUTOMATION_SWITCH: Record<Automation, keyof PlatformSettings['automations']> = {
  review_request: 'reviewRequest',
  gift_delivery: 'giftDelivery',
  gift_expiry: 'giftExpiry',
  payment_failed: 'paymentFailed',
  sponsored: 'sponsored',
  onboarding: 'onboarding',
  claim_invite: 'claimInvites',
};

export interface EnqueueInput {
  key: string;
  automation: Automation;
  template: string;
  channel: SendChannel;
  to: string;
  /** A phone to use by SMS while the main channel (email) has no provider. */
  fallbackPhone?: string | null;
  vars: Record<string, string>;
  kind?: 'service' | 'marketing';
  scope?: string | null;
  businessId?: string | null;
  refId?: string | null;
  dueAt: Date;
  staleAt?: Date | null;
  createdById?: string | null;
}

export function maskContact(c: string): string {
  if (c.includes('@')) return c.replace(/^(.{0,2})[^@]*/, '$1••');
  return c.length > 4 ? '•••' + c.slice(-3) : '•••';
}

/** Queues one message. Returns false when a message with this key already exists (sent or not). */
export async function enqueue(m: EnqueueInput): Promise<boolean> {
  const to = m.to.trim();
  if (!to) return false;
  const r = await db.scheduledMessage.createMany({
    data: [{
      key: m.key, automation: m.automation, template: m.template, channel: m.channel,
      toSealed: seal(to), toMasked: maskContact(to), fallbackSealed: m.fallbackPhone ? seal(m.fallbackPhone) : null,
      varsSealed: seal(m.vars), kind: m.kind ?? 'service', scope: m.scope ?? null, businessId: m.businessId ?? null,
      refId: m.refId ?? null, dueAt: m.dueAt, staleAt: m.staleAt ?? null, createdById: m.createdById ?? null,
    }],
    skipDuplicates: true,
  });
  return r.count > 0;
}

/** Never throws: an automation must not break the flow that triggered it. */
export async function enqueueSafe(m: EnqueueInput): Promise<boolean> {
  try {
    return await enqueue(m);
  } catch (e) {
    console.error('[scheduler] enqueue failed', m.key, e instanceof Error ? e.message : e);
    return false;
  }
}

/** Cancels pending messages whose key starts with the prefix (for example every step of a payment follow-up). */
export async function cancelPending(keyPrefix: string, note = 'בוטל'): Promise<number> {
  const r = await db.scheduledMessage.updateMany({ where: { key: { startsWith: keyPrefix }, status: 'pending' }, data: { status: 'cancelled', note } });
  return r.count;
}

// ---------- Automation checks ----------

export type Check = { send: true; vars?: Record<string, string> } | { send: false; reason: string };
type Guard = (row: ScheduledMessage, vars: Record<string, string>) => Promise<Check>;
type AfterSend = (row: ScheduledMessage) => Promise<void>;

const guards = new Map<string, Guard>();
const afterSends = new Map<string, AfterSend>();

/** An automation registers the check that runs right before each of its messages is sent. */
export function registerGuard(automation: Automation, guard: Guard, after?: AfterSend) {
  guards.set(automation, guard);
  if (after) afterSends.set(automation, after);
}

// ---------- Sending ----------

const BATCH = 150;
const consentChannel = (c: SendChannel) => (c === 'email' ? 'email' : c === 'sms' ? 'sms' : 'wa');

async function optedOut(contact: string, scope: string | null, channel: SendChannel): Promise<boolean> {
  const scopes = scope && scope !== 'all' ? [scope, 'all'] : ['all'];
  const n = await db.messageConsent.count({ where: { contact: contact.toLowerCase().trim(), scope: { in: scopes }, channel: consentChannel(channel), marketing: false } });
  if (n) return true;
  if (contact !== contact.toLowerCase()) return false;
  return (await db.messageConsent.count({ where: { contact, scope: { in: scopes }, channel: consentChannel(channel), marketing: false } })) > 0;
}

export interface QueueRun { due: number; sent: number; postponed: number; waiting: number; skipped: number; expired: number; failed: number; held: number }

export async function runQueue(now = new Date(), deadlineMs = 45_000): Promise<QueueRun> {
  // Import the automations so their guards are registered before anything is sent.
  await import('./automations');
  const started = Date.now();
  const settings = await platformSettings();
  const on = (Object.keys(AUTOMATION_SWITCH) as Automation[]).filter(a => settings.automations[AUTOMATION_SWITCH[a]]);
  const run: QueueRun = { due: 0, sent: 0, postponed: 0, waiting: 0, skipped: 0, expired: 0, failed: 0, held: 0 };
  run.held = await db.scheduledMessage.count({ where: { status: 'pending', dueAt: { lte: now }, automation: { notIn: on } } });

  // A send that crashed mid-way is retried after 15 minutes (the provider may or may not have taken it: at most once more).
  await db.scheduledMessage.updateMany({ where: { status: 'sending', updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) } }, data: { status: 'pending' } });

  const rows = await db.scheduledMessage.findMany({ where: { status: 'pending', dueAt: { lte: now }, automation: { in: on } }, orderBy: { dueAt: 'asc' }, take: BATCH });
  run.due = rows.length;
  const [emailOn, smsOn] = await Promise.all([emailReady().then(Boolean), twilioReady().then(Boolean)]);

  for (const row of rows) {
    if (Date.now() - started > deadlineMs) break;
    try {
      const outcome = await sendOne(row, now, { emailOn, smsOn });
      run[outcome]++;
    } catch (e) {
      console.error('[scheduler] send failed', row.key, e instanceof Error ? e.message : e);
      await db.scheduledMessage.update({ where: { id: row.id }, data: { status: row.attempts + 1 >= 3 ? 'failed' : 'pending', attempts: { increment: 1 }, dueAt: new Date(now.getTime() + 3600_000), note: 'שגיאה בשליחה' } }).catch(() => undefined);
      run.failed++;
    }
  }
  return run;
}

type Outcome = 'sent' | 'postponed' | 'waiting' | 'skipped' | 'expired' | 'failed';

async function sendOne(row: ScheduledMessage, now: Date, ready: { emailOn: boolean; smsOn: boolean }): Promise<Outcome> {
  const done = (status: string, note: string) => db.scheduledMessage.update({ where: { id: row.id }, data: { status, note } });
  if (row.staleAt && row.staleAt < now) { await done('expired', 'עבר הזמן שבו ההודעה רלוונטית'); return 'expired'; }

  const kind = row.kind === 'marketing' ? 'marketing' : 'service';
  const allowed = nextSendable(now, kind);
  if (allowed.getTime() > now.getTime()) {
    await db.scheduledMessage.update({ where: { id: row.id }, data: { dueAt: allowed } });
    return 'postponed';
  }

  let vars = open<Record<string, string>>(row.varsSealed);
  const guard = guards.get(row.automation);
  if (guard) {
    const c = await guard(row, vars);
    if (!c.send) { await done('skipped', c.reason); return 'skipped'; }
    if (c.vars) vars = c.vars;
  }

  // Route: the main channel when its provider is on, else the phone fallback by SMS, else wait.
  const primary = row.channel as SendChannel;
  const primaryOn = primary === 'email' ? ready.emailOn : ready.smsOn;
  let channel: SendChannel = primary;
  let to = open<string>(row.toSealed);
  if (!primaryOn) {
    if (row.fallbackSealed && ready.smsOn) { channel = 'sms'; to = open<string>(row.fallbackSealed); }
    else {
      await db.scheduledMessage.update({ where: { id: row.id }, data: { dueAt: new Date(now.getTime() + 6 * 3600_000), note: primary === 'email' ? 'ממתין לחיבור אימייל (Resend)' : 'ממתין לחיבור SMS (Twilio)' } });
      return 'waiting';
    }
  }

  if (kind === 'marketing') {
    if (await optedOut(to, row.scope, channel)) { await done('skipped', 'הנמען הוסר מדיוור'); return 'skipped'; }
    // The unsubscribe link must match the channel that actually carries the message.
    const unsub = vars[`unsub_${consentChannel(channel)}`];
    if (!unsub) { await done('skipped', 'אין קישור הסרה לערוץ הזה'); return 'skipped'; }
    vars = { ...vars, unsubscribe: unsub };
  }

  const claimed = await db.scheduledMessage.updateMany({ where: { id: row.id, status: 'pending' }, data: { status: 'sending', attempts: { increment: 1 } } });
  if (!claimed.count) return 'skipped';

  const r = await deliver({ channel: channel as Channel, to, template: row.template, vars, kind, cleared: true });
  if (!r) {
    await db.scheduledMessage.update({ where: { id: row.id }, data: { status: 'pending', attempts: { decrement: 1 }, dueAt: new Date(now.getTime() + 6 * 3600_000), note: 'אין ספק זמין לערוץ' } });
    return 'waiting';
  }
  if (r.id === 'failed') {
    const last = row.attempts + 1 >= 3;
    await db.scheduledMessage.update({ where: { id: row.id }, data: { status: last ? 'failed' : 'pending', dueAt: new Date(now.getTime() + 2 * 3600_000), note: 'הספק דחה את ההודעה' } });
    return 'failed';
  }
  await db.scheduledMessage.update({ where: { id: row.id }, data: { status: 'sent', sentAt: new Date(), sentChannel: r.channel, note: null } });
  const after = afterSends.get(row.automation);
  if (after) await after(row).catch(e => console.error('[scheduler] after-send failed', row.key, e instanceof Error ? e.message : e));
  return 'sent';
}

/** Puts a failed or skipped message back in the queue (from /ops/automations). */
export async function retryMessage(id: string): Promise<boolean> {
  const r = await db.scheduledMessage.updateMany({ where: { id, status: { in: ['failed', 'skipped', 'expired', 'cancelled'] } }, data: { status: 'pending', attempts: 0, dueAt: new Date(), staleAt: null, note: 'הוחזר לתור ידנית' } });
  return r.count > 0;
}
