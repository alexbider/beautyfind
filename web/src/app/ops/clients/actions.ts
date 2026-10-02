'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/access';
import { db } from '@/lib/server/db';

// Staff actions on client accounts: block or unblock (sign-in refused while blocked, records stay),
// and privacy requests under the Privacy Protection Law: a deletion is carried out as anonymisation
// (name, phone, email and consents removed, sessions ended; bookings and declarations stay with the
// clinics as their clinical records), an access or correction message is closed when answered.
// Everything is an audit row; deletions are also an append-only decision that closes the request.

type Result = { ok: true } | { ok: false; error: 'forbidden' | 'invalid' | 'not_found' };

const BlockInput = z.object({ id: z.string().uuid(), block: z.boolean(), reason: z.string().trim().max(300).optional() });

export async function blockClientAction(input: z.input<typeof BlockInput>): Promise<Result> {
  const user = await areaUserOrNull('clients', 'edit');
  if (!user) return { ok: false, error: 'forbidden' };
  const p = BlockInput.safeParse(input);
  if (!p.success) return { ok: false, error: 'invalid' };
  const c = await db.user.findUnique({ where: { id: p.data.id }, select: { id: true, kind: true, opsRole: true } });
  if (!c || c.kind !== 'client' || c.opsRole) return { ok: false, error: 'not_found' };
  await db.$transaction([
    db.user.update({ where: { id: c.id }, data: p.data.block ? { blockedAt: new Date(), blockedReason: p.data.reason || null } : { blockedAt: null, blockedReason: null } }),
    ...(p.data.block ? [db.session.deleteMany({ where: { userId: c.id } })] : []),
    db.auditLog.create({ data: { actorId: user.id, action: p.data.block ? 'client_block' : 'client_unblock', subjectType: 'user', subjectId: c.id, meta: { note: p.data.reason || null } } }),
  ]);
  revalidatePath('/ops/clients');
  return { ok: true };
}

const PrivacyInput = z.object({ kind: z.enum(['delete', 'access', 'correction']), id: z.string().uuid(), outcome: z.enum(['done', 'rejected']), note: z.string().trim().max(300).optional() });

export async function completePrivacyRequestAction(input: z.input<typeof PrivacyInput>): Promise<Result> {
  const user = await areaUserOrNull('clients', 'edit');
  if (!user) return { ok: false, error: 'forbidden' };
  const p = PrivacyInput.safeParse(input);
  if (!p.success) return { ok: false, error: 'invalid' };

  if (p.data.kind !== 'delete') {
    const m = await db.contactMessage.findUnique({ where: { id: p.data.id }, select: { id: true, ref: true } });
    if (!m) return { ok: false, error: 'not_found' };
    await db.$transaction([
      db.contactMessage.update({ where: { id: m.id }, data: { status: 'closed' } }),
      db.auditLog.create({ data: { actorId: user.id, action: 'privacy_request_done', subjectType: 'contact_message', subjectId: m.id, meta: { ref: m.ref, kind: p.data.kind, outcome: p.data.outcome, note: p.data.note || null } } }),
    ]);
    revalidatePath('/ops/clients');
    return { ok: true };
  }

  const req = await db.decision.findUnique({ where: { id: p.data.id } });
  if (!req || req.action !== 'delete_request') return { ok: false, error: 'not_found' };
  const already = await db.decision.findFirst({ where: { subjectId: req.subjectId, action: { in: ['delete_done', 'delete_rejected'] }, createdAt: { gt: req.createdAt } } });
  if (already) return { ok: true };
  if (p.data.outcome === 'rejected') {
    await db.$transaction([
      db.decision.create({ data: { actorId: user.id, actorRole: user.opsRole ?? 'ops', subjectType: 'user', subjectId: req.subjectId, action: 'delete_rejected', reason: p.data.note || null, supersedesDecisionId: req.id } }),
      db.auditLog.create({ data: { actorId: user.id, action: 'privacy_request_done', subjectType: 'user', subjectId: req.subjectId, meta: { kind: 'delete', outcome: 'rejected', note: p.data.note || null } } }),
    ]);
    revalidatePath('/ops/clients');
    return { ok: true };
  }
  const c = await db.user.findUnique({ where: { id: req.subjectId }, select: { id: true, kind: true, opsRole: true } });
  if (c && c.kind === 'client' && !c.opsRole) {
    await db.$transaction([
      db.session.deleteMany({ where: { userId: c.id } }),
      db.messageConsent.deleteMany({ where: { userId: c.id } }),
      db.savedClinic.deleteMany({ where: { userId: c.id } }),
      db.user.update({ where: { id: c.id }, data: { fullName: null, email: null, phone: null, passwordHash: null, marketingOptIn: false, phoneVerifiedAt: null, emailVerifiedAt: null, blockedAt: new Date(), blockedReason: 'account deleted at the client\'s request' } }),
      db.auditLog.create({ data: { actorId: user.id, action: 'privacy_anonymize', subjectType: 'user', subjectId: c.id, meta: { note: p.data.note || null } } }),
    ]);
  }
  await db.decision.create({ data: { actorId: user.id, actorRole: user.opsRole ?? 'ops', subjectType: 'user', subjectId: req.subjectId, action: 'delete_done', reason: p.data.note || null, supersedesDecisionId: req.id } });
  revalidatePath('/ops/clients');
  return { ok: true };
}
