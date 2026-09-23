import 'server-only';
import type { OpsRole, Prisma, VerificationStatus } from '@prisma/client';
import { db } from './db';
import { messaging } from '../vendors/messaging';

// Verification decisions (03-states.md "Verification request").
// open → awaiting_document (SLA paused) → open · open → approved | rejected.
// Every decision is an append-only Decision row; the request status is derived state.

export type VerifyAction = 'approve' | 'reject' | 'request_document' | 'reopen';

export type DecideResult =
  | { ok: true; status: VerificationStatus }
  | { ok: false; error: 'not_found' | 'forbidden' | 'closed' | 'reason_required' | 'license_pending' | 'already_owned' | 'invalid' };

const RECHECK_DAYS = 90;
const VERIFIER_ROLES: OpsRole[] = ['verifier', 'ops'];

type Json = Record<string, unknown>;
const obj = (v: Prisma.JsonValue | null | undefined): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : null);

export async function decide(opts: {
  requestId: string;
  actor: { id: string; opsRole: OpsRole | null };
  action: VerifyAction;
  reason?: string;
}): Promise<DecideResult> {
  if (!opts.actor.opsRole || !VERIFIER_ROLES.includes(opts.actor.opsRole)) return { ok: false, error: 'forbidden' };
  const reason = opts.reason?.trim() || null;
  if ((opts.action === 'reject' || opts.action === 'request_document') && !reason) return { ok: false, error: 'reason_required' };

  const result = await db.$transaction(async tx => {
    const req = await tx.verificationRequest.findUnique({ where: { id: opts.requestId } });
    if (!req) return { ok: false, error: 'not_found' } as const;
    if (req.status === 'approved' || req.status === 'rejected') return { ok: false, error: 'closed' } as const;

    let status: VerificationStatus;
    switch (opts.action) {
      case 'request_document':
        status = 'awaiting_document';
        break;
      case 'reopen':
        if (req.status !== 'awaiting_document') return { ok: false, error: 'invalid' } as const;
        status = 'open';
        break;
      case 'reject':
        status = 'rejected';
        await onReject(tx, req);
        break;
      case 'approve': {
        const effect = await onApprove(tx, req);
        if (effect) return { ok: false, error: effect } as const;
        status = 'approved';
        break;
      }
    }

    await tx.verificationRequest.update({
      where: { id: req.id },
      // SLA is paused while waiting for a document and restarts (24h) when reopened.
      data: { status, ...(status === 'open' ? { slaDueAt: new Date(Date.now() + 86_400_000) } : {}) },
    });
    await tx.decision.create({
      data: {
        actorId: opts.actor.id,
        actorRole: opts.actor.opsRole!,
        subjectType: 'verification_request',
        subjectId: req.id,
        action: opts.action,
        reason,
      },
    });
    return { ok: true, status, req } as const;
  });

  if (!result.ok) return result;
  // M19 / M20 outcome message. Service message; sent after commit.
  if (result.status !== 'open' && result.req.submittedById) {
    const user = await db.user.findUnique({ where: { id: result.req.submittedById } });
    if (user?.email) {
      await messaging().send({
        channel: 'email',
        to: user.email,
        template: result.req.kind === 'claim' ? 'M20_claim_outcome' : 'M19_verification_outcome',
        vars: { ref: result.req.ref, status: result.status, reason: reason ?? '' },
        kind: 'service',
      });
    }
  }
  return { ok: true, status: result.status };
}

type Tx = Prisma.TransactionClient;
type Req = Prisma.VerificationRequestGetPayload<object>;

async function onApprove(tx: Tx, req: Req): Promise<'license_pending' | 'already_owned' | 'invalid' | null> {
  const sub = obj(req.submitted);
  switch (req.kind) {
    case 'license':
    case 'cert': {
      const licenseId = str(sub.licenseId);
      if (!licenseId) return 'invalid';
      const now = new Date();
      await tx.license.update({
        where: { id: licenseId },
        data: { status: 'verified', verifiedAt: now, nextCheckAt: new Date(now.getTime() + RECHECK_DAYS * 86_400_000) },
      });
      return null;
    }
    case 'business': {
      if (!req.businessId) return 'invalid';
      // A branch offering medical categories can't go live until its doctor's license is verified.
      const branches = await tx.branch.findMany({
        where: { businessId: req.businessId },
        include: { categories: { include: { category: true } }, medicalResponsible: { include: { license: true } } },
      });
      for (const b of branches) {
        const medical = b.categories.some(c => c.category.isMedical);
        if (medical && b.medicalResponsible?.license?.status !== 'verified') return 'license_pending';
      }
      await tx.business.update({ where: { id: req.businessId }, data: { status: 'live' } });
      await tx.branch.updateMany({ where: { businessId: req.businessId, status: 'draft' }, data: { status: 'live' } });
      return null;
    }
    case 'claim': {
      if (!req.branchId || !req.submittedById) return 'invalid';
      const branch = await tx.branch.findUnique({ where: { id: req.branchId }, include: { business: true } });
      if (!branch) return 'invalid';
      if (branch.isClaimed || branch.business.ownerUserId) return 'already_owned';
      const user = await tx.user.findUnique({ where: { id: req.submittedById } });
      if (!user) return 'invalid';

      const d = obj(sub.details as Prisma.JsonValue);
      const cats = Array.isArray(d.categories) ? d.categories.filter((c): c is string => typeof c === 'string') : [];
      const known = cats.length ? await tx.category.findMany({ where: { OR: [{ slug: { in: cats } }, { name: { in: cats } }] } }) : [];

      await tx.business.update({ where: { id: branch.businessId }, data: { ownerUserId: user.id } });
      await tx.staffMember.create({
        data: {
          businessId: branch.businessId, userId: user.id, displayName: user.fullName ?? str(d.name) ?? branch.name,
          profession: 'management', isOwner: true, preset: 'owner', branchIds: [branch.id],
        },
      });
      await tx.branch.update({
        where: { id: branch.id },
        data: {
          isClaimed: true,
          name: str(d.name) ?? branch.name,
          address: str(d.address) ?? branch.address,
          phone: str(d.phone) ?? branch.phone,
          whatsapp: str(d.whatsapp) ?? branch.whatsapp,
          ...(Array.isArray(d.hours) && d.hours.length === 7 ? { hours: d.hours as Prisma.InputJsonValue } : {}),
          ...(known.length
            ? { categories: { deleteMany: {}, create: known.map(k => ({ categorySlug: k.slug })) } }
            : {}),
        },
      });
      // Other open claims on the same listing can no longer succeed; each gets its own system decision.
      const rivals = await tx.verificationRequest.findMany({
        where: { kind: 'claim', branchId: branch.id, id: { not: req.id }, status: { in: ['open', 'awaiting_document'] } },
        select: { id: true },
      });
      for (const r of rivals) {
        await tx.verificationRequest.update({ where: { id: r.id }, data: { status: 'rejected' } });
        await tx.decision.create({
          data: { actorRole: 'system', subjectType: 'verification_request', subjectId: r.id, action: 'reject', reason: 'לעסק יש בעלים מאומת/ת', supersedesDecisionId: null },
        });
      }
      return null;
    }
  }
}

async function onReject(tx: Tx, req: Req) {
  const licenseId = str(obj(req.submitted).licenseId);
  if ((req.kind === 'license' || req.kind === 'cert') && licenseId) {
    await tx.license.update({ where: { id: licenseId }, data: { status: 'rejected' } });
  }
}
