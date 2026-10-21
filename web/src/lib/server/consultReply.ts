import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { fromE164 } from '../format';
import { hhmm, ilDate } from '../time';
import { messaging } from '../vendors/messaging';
import { hmac } from './crypto';
import { db } from './db';
import { clinicEmail, isPaidBusiness } from './plan';
import { siteUrl } from './site';

// Client replies to a consultation request. On a paid plan, the clinic's SMS (M8 details, M9 proposed time)
// carries a signed link to /r/{token}; the client answers there, the answer is stored (consult_replies), emailed to
// the clinic and shown in the consult inbox. Without a paid plan the SMS asks the client to call the business.

export const REPLY_KINDS = ['confirm', 'other_time', 'message'] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];
const OPEN = ['new', 'awaiting_client', 'consult_scheduled'];
const MAX_REPLIES = 20;
const GAP_MS = 20_000;

const sig = (id: string) => hmac(`consult-reply:${id}`).slice(0, 32);
export const replyToken = (id: string) => `${id}.${sig(id)}`;
export const replyLink = (id: string) => `${siteUrl()}/r/${replyToken(id)}`;

export function parseReplyToken(token: string): string | null {
  const m = /^([0-9a-f-]{36})\.([0-9a-f]{32})$/i.exec(token);
  if (!m) return null;
  const want = Buffer.from(sig(m[1]));
  const got = Buffer.from(m[2].toLowerCase());
  return want.length === got.length && timingSafeEqual(want, got) ? m[1] : null;
}

/** Extra vars for M8 and M9: the reply link on a paid plan, and the business phone either way. */
export async function replyVars(req: { id: string; branch: { businessId: string; phone: string | null } }): Promise<Record<string, string>> {
  const paid = await isPaidBusiness(req.branch.businessId);
  return { ...(paid ? { reply_link: replyLink(req.id) } : {}), business_phone: req.branch.phone ? fromE164(req.branch.phone) : '' };
}

export interface ReplyView {
  id: string;
  ref: string;
  firstName: string;
  business: string;
  businessPhone: string | null;
  proposed: string | null; // "12.11.2026 בשעה 10:30"
  open: boolean;
  paid: boolean;
  replies: Array<{ kind: string; text: string; at: Date }>;
}

export async function loadReplyView(token: string): Promise<ReplyView | null> {
  const id = parseReplyToken(token);
  if (!id) return null;
  const r = await db.consultRequest.findUnique({
    where: { id },
    include: { branch: { select: { name: true, phone: true, businessId: true } }, replies: { orderBy: { createdAt: 'asc' }, take: MAX_REPLIES } },
  });
  if (!r) return null;
  return {
    id: r.id, ref: r.ref, firstName: r.clientName.trim().split(/\s+/)[0] ?? '', business: r.branch.name,
    businessPhone: r.branch.phone ? fromE164(r.branch.phone) : null,
    proposed: r.proposedSlot ? `${ilDate(r.proposedSlot)} בשעה ${hhmm(r.proposedSlot)}` : null,
    open: OPEN.includes(r.status), paid: await isPaidBusiness(r.branch.businessId),
    replies: r.replies.map(x => ({ kind: x.kind, text: x.text, at: x.createdAt })),
  };
}

export type ReplyResult = { ok: true; emailed: boolean } | { ok: false; error: 'not_found' | 'closed' | 'not_paid' | 'invalid' | 'too_fast' | 'too_many' };

const KIND_TEXT: Record<ReplyKind, string> = { confirm: 'מאשר/ת את המועד שהוצע', other_time: 'מבקש/ת מועד אחר', message: 'הודעה' };

export async function submitReply(token: string, kindRaw: string, textRaw: string): Promise<ReplyResult> {
  const id = parseReplyToken(token);
  if (!id) return { ok: false, error: 'not_found' };
  const kind = (REPLY_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as ReplyKind) : null;
  const text = (textRaw ?? '').trim().slice(0, 1000);
  if (!kind || (kind !== 'confirm' && text.length < 2)) return { ok: false, error: 'invalid' };
  const r = await db.consultRequest.findUnique({ where: { id }, include: { branch: { select: { id: true, name: true, businessId: true } }, replies: { orderBy: { createdAt: 'desc' }, take: 1 } } });
  if (!r) return { ok: false, error: 'not_found' };
  if (!OPEN.includes(r.status)) return { ok: false, error: 'closed' };
  if (kind === 'confirm' && !r.proposedSlot) return { ok: false, error: 'invalid' };
  if (!(await isPaidBusiness(r.branch.businessId))) return { ok: false, error: 'not_paid' };
  if (r.replies[0] && Date.now() - r.replies[0].createdAt.getTime() < GAP_MS) return { ok: false, error: 'too_fast' };
  if ((await db.consultReply.count({ where: { consultRequestId: r.id } })) >= MAX_REPLIES) return { ok: false, error: 'too_many' };

  const reply = await db.consultReply.create({ data: { consultRequestId: r.id, kind, text } });
  const to = await clinicEmail(r.branch.id);
  if (!to) return { ok: true, emailed: false };
  const sent = await messaging().send({
    channel: 'email', to, template: 'M_consult_reply', kind: 'service',
    vars: {
      business: r.branch.name, name: r.clientName, phone: fromE164(r.clientPhone), ref: r.ref,
      answer: KIND_TEXT[kind], text, proposed: r.proposedSlot ? `${ilDate(r.proposedSlot)} בשעה ${hhmm(r.proposedSlot)}` : '',
      link: `${siteUrl()}/clinic/consults`,
    },
  }).catch(() => ({ id: 'failed', channel: undefined }));
  // Only a provider send names its channel; the log adapter does not, and a failed send says 'failed'.
  const emailed = sent.id !== 'failed' && sent.channel === 'email';
  if (emailed) await db.consultReply.update({ where: { id: reply.id }, data: { emailedAt: new Date() } });
  return { ok: true, emailed };
}
