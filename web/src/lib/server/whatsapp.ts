import 'server-only';
import { TEMPLATES } from '../../app/ops/messages/catalog';
import { renderMessage } from '../messages/render';
import { SAMPLES } from '../messages/samples';
import type { OutgoingMessage } from '../vendors/messaging';
import {
  TwilioError, isPhone, twilioCreateContent, twilioSendWhatsApp, twilioSubmitWhatsApp, twilioWhatsAppApproval, twilioWhatsAppSenders,
  type TwilioConfig,
} from '../vendors/twilio';
import { db } from './db';
import { platformSettings, savePlatformSettings, type PlatformSettings } from './platformSettings';
import { open, seal } from './secure';
import { siteUrl } from './site';
import { twilioAttempt, twilioConfig, twilioCreds, twilioReady } from './twilio';

// WhatsApp through Twilio for service notices (booking confirmations, reminders, review requests, …).
//
// Meta only lets a business start a conversation with an approved template, so every message the site sends becomes
// a Twilio Content template once: its SMS text, rendered with the template's sample vars, where each var that is
// plain interpolation becomes {{1}}, {{2}}, … (the "skeleton"). A send uses WhatsApp only when the message renders
// to exactly that skeleton (same lines, same fixed wording) and the template is approved; anything else goes by SMS.
// When WhatsApp accepts the message but cannot deliver it (no WhatsApp on that number, blocked), Twilio's status
// callback triggers the same text by SMS once. The SMS text waits sealed on the send row and is wiped on the first
// final status.

const MARK = (k: string) => `⟦${k}⟧`;
const MARK_RE = /⟦([A-Za-z0-9_]+)⟧/g;
const FOOTER = '\n\nצוות BeautyFind';

type Entry = PlatformSettings['twilio']['whatsappTemplates'][string];

/** The vars of a template that are plain interpolation (their value shows up as is, nothing else changes). */
function placeholderVars(template: string, vars: Record<string, string>): string[] {
  const site = siteUrl();
  const real = renderMessage(template, vars, site)?.sms;
  if (!real) return [];
  return Object.keys(vars).filter(k => {
    const val = (vars[k] ?? '').trim();
    if (!val) return false;
    const marked = renderMessage(template, { ...vars, [k]: MARK(k) }, site)?.sms;
    return !!marked && marked.includes(MARK(k)) && marked.split(MARK(k)).join(val) === real;
  });
}

/** The template body with {{n}} placeholders and the var name behind each number, for these vars. */
export function skeletonOf(template: string, vars: Record<string, string>): { body: string; vars: string[] } | null {
  const keys = placeholderVars(template, vars);
  const marked = renderMessage(template, { ...vars, ...Object.fromEntries(keys.map(k => [k, MARK(k)])) }, siteUrl())?.sms;
  if (!marked) return null;
  const order: string[] = [];
  const body = marked.replace(MARK_RE, (_, k: string) => { order.push(k); return `{{${order.length}}}`; });
  // Meta refuses a body that starts or ends with a variable; the sender name closes every message.
  return { body: `${/^\{\{/.test(body) ? 'BeautyFind: ' : ''}${body}${FOOTER}`, vars: order };
}

/** Codes go by the verification route, and a body that is mostly variables would be rejected by Meta. */
const NOT_TEMPLATED = new Set(['M16_otp']);
function templatable(id: string, body: string): boolean {
  if (NOT_TEMPLATED.has(id)) return false;
  const fixed = body.replace(/\{\{\d+\}\}/g, ' ').replace(/BeautyFind:?/g, ' ').replace(/צוות/g, ' ').split(/\s+/).filter(w => /[\u0590-\u05FFA-Za-z]{2,}/.test(w));
  return fixed.length >= 3;
}

/** A variable's value as WhatsApp accepts it: no line breaks, tabs or runs of spaces. */
const clean = (v: string) => v.replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim() || '-';

const templateName = (id: string, n = 1) => `bf_${id.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}${n > 1 ? `_v${n}` : ''}`.slice(0, 60);
const categoryOf = (id: string): 'UTILITY' | 'MARKETING' => (TEMPLATES.find(t => t.codeIds.includes(id))?.type === 'M' ? 'MARKETING' : 'UTILITY');

export interface WhatsAppReady { cfg: TwilioConfig; from: string; forSms: boolean; templates: Record<string, Entry> }

/** WhatsApp is used when it is on, Twilio has credentials, and a WhatsApp sender number is set. */
export async function whatsappReady(): Promise<WhatsAppReady | null> {
  const [s, c] = await Promise.all([platformSettings(), twilioCreds()]);
  const t = s.twilio;
  if (!c || !t.whatsappEnabled || !isPhone(t.whatsappFrom)) return null;
  return { cfg: twilioConfig(c, t), from: t.whatsappFrom, forSms: t.whatsappForSms, templates: t.whatsappTemplates };
}

/** The approved template and its variables for this message, or null when it has to go by SMS. */
export function whatsappContent(w: WhatsAppReady, msg: Pick<OutgoingMessage, 'template' | 'vars'>): { sid: string; variables: Record<string, string> } | null {
  const e = w.templates[msg.template];
  if (!e || e.status !== 'approved') return null;
  const sk = skeletonOf(msg.template, msg.vars);
  if (!sk || sk.body !== e.skeleton) return null;
  return { sid: e.sid, variables: Object.fromEntries(e.vars.map((k, i) => [String(i + 1), clean(msg.vars[k] ?? '')])) };
}

const maskPhone = (p: string) => p.replace(/\d(?=\d{3})/g, '•');

/**
 * One WhatsApp message, logged with its SMS fallback sealed. A send WhatsApp refuses right away goes by SMS now;
 * one that fails later goes by SMS from the status callback.
 */
export async function whatsappAttempt(w: WhatsAppReady, msg: OutgoingMessage, content: { sid: string; variables: Record<string, string> }, smsText: string): Promise<{ id: string; channel: 'whatsapp' | 'sms' }> {
  try {
    const r = await twilioSendWhatsApp(w.cfg, w.from, msg.to, content.sid, content.variables);
    await db.messageSend.create({
      data: {
        provider: 'twilio', channel: 'whatsapp', template: msg.template, toMasked: maskPhone(msg.to), status: 'sent', providerId: r.id, deliveryStatus: r.status,
        fallbackEnc: seal({ to: msg.to, text: smsText, template: msg.template }),
      },
    }).catch(() => undefined);
    return { id: r.id, channel: 'whatsapp' };
  } catch (e) {
    await db.messageSend.create({
      data: { provider: 'twilio', channel: 'whatsapp', template: msg.template, toMasked: maskPhone(msg.to), status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 300) },
    }).catch(() => undefined);
    const tw = await twilioReady();
    if (!tw || (e instanceof TwilioError && (e.status === 401 || e.status === 403))) throw e;
    const r = await twilioAttempt(tw, msg, smsText, { fallbackFrom: 'whatsapp' });
    return { id: r.id, channel: 'sms' };
  }
}

const FINAL_OK = new Set(['delivered', 'read']);
const FINAL_BAD = new Set(['failed', 'undelivered']);

/** Status callback for a WhatsApp send: on failure send the SMS once; on any final status wipe the sealed text. */
export async function whatsappStatus(sid: string, status: string): Promise<'fallback' | 'cleared' | null> {
  if (!FINAL_OK.has(status) && !FINAL_BAD.has(status)) return null;
  const row = await db.messageSend.findFirst({ where: { provider: 'twilio', channel: 'whatsapp', providerId: sid, fallbackEnc: { not: null } }, select: { id: true, fallbackEnc: true } });
  if (!row?.fallbackEnc) return null;
  // Claim it: only one callback (Twilio may report twice) gets to send the SMS.
  const claimed = await db.messageSend.updateMany({ where: { id: row.id, fallbackEnc: { not: null } }, data: { fallbackEnc: null } });
  if (!claimed.count || FINAL_OK.has(status)) return 'cleared';
  let p: { to: string; text: string; template: string } | null = null;
  try { p = open<{ to: string; text: string; template: string }>(row.fallbackEnc); } catch { p = null; }
  const tw = p ? await twilioReady() : null;
  if (!p || !tw) return 'cleared';
  await twilioAttempt(tw, { to: p.to, template: p.template }, p.text, { fallbackFrom: 'whatsapp' }).catch(e => console.error('[whatsapp] SMS fallback failed', e instanceof Error ? e.message : String(e)));
  return 'fallback';
}

// ---------- Templates ----------

export interface TemplateRow { id: string; label: string; name: string | null; sid: string | null; status: string; reason: string | null; body: string | null }

/** Every message that can go by WhatsApp, with its template state. */
export async function whatsappTemplates(): Promise<TemplateRow[]> {
  const s = await platformSettings();
  return SAMPLES.filter(x => { const sk = skeletonOf(x.id, x.vars); return !!sk && templatable(x.id, sk.body); }).map(x => {
    const e = s.twilio.whatsappTemplates[x.id];
    return { id: x.id, label: x.label, name: e?.name ?? null, sid: e?.sid ?? null, status: e?.status ?? 'missing', reason: e?.reason ?? null, body: e?.skeleton ?? skeletonOf(x.id, x.vars)?.body ?? null };
  });
}

/**
 * Creates the missing templates (and new versions of rejected or outdated ones), submits them to Meta, and
 * refreshes every status. Idempotent; run it again to pick up approvals.
 */
export async function syncWhatsAppTemplates(actorId: string): Promise<{ ok: true; created: number; submitted: number; approved: number; pending: number; rejected: number; errors: string[] } | { ok: false; error: string }> {
  const [s, c] = await Promise.all([platformSettings(), twilioCreds()]);
  if (!c) return { ok: false, error: 'חסרים פרטי חשבון Twilio' };
  const cfg = twilioConfig(c, s.twilio);
  const templates: Record<string, Entry> = { ...s.twilio.whatsappTemplates };
  const errors: string[] = [];
  let created = 0;
  let submitted = 0;
  for (const sample of SAMPLES) {
    const sk = skeletonOf(sample.id, sample.vars);
    if (!sk || !templatable(sample.id, sk.body)) continue;
    const cur = templates[sample.id];
    try {
      if (cur && (cur.status === 'rejected' || cur.skeleton !== sk.body) || !cur) {
        // A new template (or a new version when the text changed or Meta rejected it).
        const version = cur ? Number(cur.name.match(/_v(\d+)$/)?.[1] ?? 1) + 1 : 1;
        const name = templateName(sample.id, version);
        const samples = Object.fromEntries(sk.vars.map((k, i) => [String(i + 1), clean(sample.vars[k] ?? '')]));
        const sid = await twilioCreateContent(cfg, { friendlyName: name, language: 'he', body: sk.body, samples });
        created++;
        await twilioSubmitWhatsApp(cfg, sid, name, categoryOf(sample.id));
        submitted++;
        templates[sample.id] = { sid, name, vars: sk.vars, skeleton: sk.body, status: 'pending' };
      } else if (cur.status !== 'approved') {
        const a = await twilioWhatsAppApproval(cfg, cur.sid);
        if (a.status === 'unsubmitted') { await twilioSubmitWhatsApp(cfg, cur.sid, cur.name, categoryOf(sample.id)); submitted++; }
        templates[sample.id] = { ...cur, status: a.status === 'unsubmitted' ? 'pending' : a.status, ...(a.reason ? { reason: a.reason.slice(0, 300) } : {}) };
      }
    } catch (e) {
      errors.push(`${sample.id}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
      if (e instanceof TwilioError && (e.status === 401 || e.status === 403)) break;
    }
  }
  await savePlatformSettings(actorId, { twilio: { ...s.twilio, whatsappTemplates: templates } });
  const st = Object.values(templates).map(t => t.status);
  return { ok: true, created, submitted, approved: st.filter(x => x === 'approved').length, pending: st.filter(x => x === 'pending' || x === 'received').length, rejected: st.filter(x => x === 'rejected').length, errors };
}

/** The account's WhatsApp senders, for picking the number on /ops/messages. */
export async function whatsappSenders(): Promise<{ ok: true; senders: Array<{ phone: string; status: string; name: string | null }> } | { ok: false; error: string }> {
  const [s, c] = await Promise.all([platformSettings(), twilioCreds()]);
  if (!c) return { ok: false, error: 'חסרים פרטי חשבון Twilio' };
  try {
    return { ok: true, senders: await twilioWhatsAppSenders(twilioConfig(c, s.twilio)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface WhatsAppStatus { enabled: boolean; from: string; forSms: boolean; ready: boolean; approved: number; total: number; sent24h: number; failed24h: number; read24h: number; fallback24h: number }

export async function whatsappStatusSummary(): Promise<WhatsAppStatus> {
  const since = new Date(Date.now() - 86_400_000);
  const w = (x: object) => db.messageSend.count({ where: { provider: 'twilio', channel: 'whatsapp', test: false, createdAt: { gte: since }, ...x } });
  const [s, c, sent24h, failed24h, read24h, fallback24h] = await Promise.all([
    platformSettings(), twilioCreds(), w({ status: 'sent' }), w({ OR: [{ status: 'failed' }, { deliveryStatus: { in: ['failed', 'undelivered'] } }] }), w({ deliveryStatus: 'read' }),
    db.messageSend.count({ where: { provider: 'twilio', channel: 'sms', fallbackFrom: 'whatsapp', createdAt: { gte: since } } }),
  ]);
  const t = s.twilio;
  const total = Object.keys(t.whatsappTemplates).length;
  const approved = Object.values(t.whatsappTemplates).filter(x => x.status === 'approved').length;
  return { enabled: t.whatsappEnabled, from: t.whatsappFrom, forSms: t.whatsappForSms, ready: !!c && t.whatsappEnabled && isPhone(t.whatsappFrom), approved, total, sent24h, failed24h, read24h, fallback24h };
}

/** Admin test: one approved template to the number entered, with its sample data. */
export async function whatsappTestSend(to: string, templateId?: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const w = await whatsappReady();
  if (!w) return { ok: false, error: 'WhatsApp כבוי או שלא נבחר מספר שולח' };
  const id = templateId ?? Object.entries(w.templates).find(([, e]) => e.status === 'approved')?.[0];
  const sample = SAMPLES.find(x => x.id === id);
  if (!id || !sample) return { ok: false, error: 'אין עדיין תבנית מאושרת לשליחה' };
  const content = whatsappContent(w, { template: id, vars: sample.vars });
  if (!content) return { ok: false, error: 'התבנית לא מאושרת עדיין' };
  try {
    const r = await twilioSendWhatsApp(w.cfg, w.from, to, content.sid, content.variables);
    await db.messageSend.create({ data: { provider: 'twilio', channel: 'whatsapp', template: id, toMasked: maskPhone(to), status: 'sent', providerId: r.id, deliveryStatus: r.status, test: true } }).catch(() => undefined);
    return { ok: true, id: r.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
