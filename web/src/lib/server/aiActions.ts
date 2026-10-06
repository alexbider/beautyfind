import 'server-only';
import type { BusinessStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { db } from './db';
import { nextRef } from './refs';

// The approvals queue behind the AI assistant (and a future MCP server): every write the model wants
// is a proposal row, and a person approves or rejects it. Approving runs a small, fixed set of actions
// here, with the same decision and audit rows a staff member leaves when doing it by hand. Nothing
// here charges, credits or messages anyone: those need a person in the matching area.

export const AI_ACTIONS = ['hide_business', 'restore_business', 'note', 'publish_article'] as const;
export type AiActionKind = (typeof AI_ACTIONS)[number];
export const AI_ACTION_NAMES: Record<string, string> = {
  hide_business: 'הסתרת עסק מהמדריך',
  suspend_business: 'השעיית עסק',
  restore_business: 'החזרת עסק לאוויר',
  note: 'הערה בתיק העסק',
  publish_article: 'פרסום מאמר במגזין',
};

export interface ProposalInput {
  source: string; // assistant | mcp:claude | mcp:chatgpt | service
  action: string;
  businessId?: string | null;
  /** Non-business subjects (publish_article: the article). Defaults to the business. */
  subjectType?: string;
  subjectId?: string | null;
  subjectLabel?: string | null;
  reason: string;
  params?: Record<string, unknown>;
}

/** Creates a proposal (status proposed) and returns its ref. The business, when given, must exist. */
export async function proposeAiAction(input: ProposalInput): Promise<{ ok: true; ref: string; id: string } | { ok: false; error: string }> {
  if (!AI_ACTIONS.includes(input.action as AiActionKind) && input.action !== 'suspend_business') return { ok: false, error: `unknown action: ${input.action}` };
  let label: string | null = input.subjectLabel ?? null;
  let subjectType = input.subjectType ?? 'business';
  let subjectId = input.subjectId ?? input.businessId ?? null;
  if (input.action === 'publish_article') {
    if (!subjectId) return { ok: false, error: 'article id is required' };
    subjectType = 'article';
    const a = await db.article.findFirst({ where: { id: subjectId, deletedAt: null }, select: { title: true } });
    if (!a) return { ok: false, error: 'article not found' };
    label = a.title;
  } else if (input.businessId) {
    label = await businessLabel(input.businessId);
    if (label === null) return { ok: false, error: 'business not found' };
    subjectType = 'business';
    subjectId = input.businessId;
  } else if (input.action !== 'note') return { ok: false, error: 'business_id is required for this action' };
  const ref = await nextRef('Q', 3);
  const row = await db.aiAction.create({
    data: {
      ref, source: input.source, action: input.action, subjectType, subjectId, subjectLabel: label,
      params: (input.params ?? {}) as object, reason: input.reason.slice(0, 1000),
    },
    select: { id: true },
  });
  return { ok: true, ref, id: row.id };
}

/** The name staff know a business by: its first branch, else its legal name. Null when it does not exist. */
export async function businessLabel(id: string): Promise<string | null> {
  const b = await db.business.findUnique({ where: { id }, select: { legalName: true, branches: { select: { name: true }, orderBy: { createdAt: 'asc' }, take: 1 } } });
  if (!b) return null;
  return b.branches[0]?.name ?? b.legalName ?? 'עסק ללא שם';
}

type Actor = { id: string; opsRole: string | null };

/** Approve or reject a proposal; approving executes it inside one transaction. Idempotent on status. */
export async function decideAiAction(actor: Actor, id: string, decision: 'approve' | 'reject', note?: string | null): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  const row = await db.aiAction.findUnique({ where: { id } });
  if (!row) return { ok: false, error: 'not_found' };
  if (row.status !== 'proposed') return { ok: false, error: 'already_decided' };
  const now = new Date();
  const businessId = row.subjectType === 'business' ? row.subjectId : null;
  if (decision === 'reject') {
    await db.$transaction([
      db.aiAction.update({ where: { id }, data: { status: 'rejected', decidedById: actor.id, decidedAt: now, result: note?.trim() || null } }),
      db.auditLog.create({ data: { actorId: actor.id, action: 'ai_action_decide', subjectType: 'ai_action', subjectId: id, businessId, meta: { ref: row.ref, decision: 'reject', action: row.action, note: note?.trim() || null } } }),
    ]);
    return { ok: true, result: 'נדחה' };
  }
  const outcome = await db.$transaction(async tx => {
    const audit = (action: string, meta: object, subjectType = 'ai_action', subjectId = id) =>
      tx.auditLog.create({ data: { actorId: actor.id, action, subjectType, subjectId, businessId, meta } });
    await audit('ai_action_decide', { ref: row.ref, decision: 'approve', action: row.action, note: note?.trim() || null });
    const kind = row.action === 'suspend_business' ? 'hide_business' : row.action;
    let result = '';
    let paths: string[] = [];
    if (kind === 'hide_business' || kind === 'restore_business') {
      if (!row.subjectId) throw new Error('no_business');
      const b = await tx.business.findUnique({ where: { id: row.subjectId }, select: { id: true, status: true, branches: { select: { regionSlug: true } } } });
      if (!b) throw new Error('business_missing');
      const to: BusinessStatus = kind === 'hide_business' ? 'hidden' : 'live';
      if (b.status !== to) {
        await tx.business.update({ where: { id: b.id }, data: { status: to } });
        await tx.decision.create({ data: { actorId: actor.id, actorRole: actor.opsRole ?? 'ops', subjectType: 'business', subjectId: b.id, action: `status_${to}`, reason: `${row.ref}: ${row.reason ?? ''}`.slice(0, 500) } });
        await audit('business_status', { from: b.status, to, note: `אושר מתור ה־AI ${row.ref}` }, 'business', b.id);
      }
      result = b.status === to ? `המצב כבר היה ${to}` : `מצב העסק: ${b.status} ← ${to}`;
      paths = ['/', '/search', `/ops/businesses/${b.id}`, '/ops/businesses', ...b.branches.map(br => `/${br.regionSlug}`)];
    } else if (kind === 'note') {
      if (row.subjectId) {
        await tx.decision.create({ data: { actorId: actor.id, actorRole: actor.opsRole ?? 'ops', subjectType: 'business', subjectId: row.subjectId, action: 'note', reason: `${row.ref}: ${row.reason ?? ''}`.slice(0, 500) } });
        paths = [`/ops/businesses/${row.subjectId}`];
      }
      result = 'ההערה נרשמה בתיק';
    } else if (kind === 'publish_article') {
      if (!row.subjectId) throw new Error('no_article');
      const { applyPublish } = await import('./articles');
      const a = await applyPublish(tx, actor, row.subjectId, `אושר מתור ה־AI ${row.ref}`);
      result = `המאמר פורסם: /magazine/${a.slug}`;
      paths = [`/magazine/${a.slug}`, '/magazine', '/sitemap.xml', '/ops/magazine', ...(a.parentPagePath ? [a.parentPagePath] : [])];
    } else {
      throw new Error(`unsupported:${row.action}`);
    }
    await tx.aiAction.update({ where: { id }, data: { status: 'executed', decidedById: actor.id, decidedAt: now, result } });
    await audit('ai_action_execute', { ref: row.ref, action: row.action, result });
    return { result, paths };
  }).catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    await db.aiAction.update({ where: { id }, data: { status: 'failed', decidedById: actor.id, decidedAt: now, result: msg.slice(0, 300) } }).catch(() => {});
    return { error: msg };
  });
  if ('error' in outcome) return { ok: false, error: outcome.error };
  for (const p of outcome.paths) {
    try { revalidatePath(p); } catch { /* outside a request (tests): nothing to refresh */ }
  }
  return { ok: true, result: outcome.result };
}
