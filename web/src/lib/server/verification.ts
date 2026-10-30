import 'server-only';
import type { OpsRole, Prisma, VerificationStatus } from '@prisma/client';
import { withPrimary } from '../category';
import { PLAN_MONTHLY_NIS } from '../pricing';
import { syncBillingSafe } from './billing';
import { db } from './db';
import { messaging } from '../vendors/messaging';

// Verification decisions (03-states.md "Verification request").
// open → awaiting_document (SLA paused) → open · open → approved | rejected.
// approved | rejected → open ("revise"): staff undo a decision with a reason. Undoing an approval takes back its
// effect (the business leaves the site, the license is unchecked); an approved ownership claim cannot be undone here.
// Every decision is an append-only Decision row; the request status is derived state.

export type VerifyAction = 'approve' | 'reject' | 'request_document' | 'reopen' | 'revise';

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
  if ((opts.action === 'reject' || opts.action === 'request_document' || opts.action === 'revise') && !reason) return { ok: false, error: 'reason_required' };

  const result = await db.$transaction(async tx => {
    const req = await tx.verificationRequest.findUnique({ where: { id: opts.requestId } });
    if (!req) return { ok: false, error: 'not_found' } as const;
    const closed = req.status === 'approved' || req.status === 'rejected';
    if (closed !== (opts.action === 'revise')) return { ok: false, error: closed ? 'closed' : 'invalid' } as const;

    let status: VerificationStatus;
    switch (opts.action) {
      case 'revise': {
        const effect = req.status === 'approved' ? await onRevokeApproval(tx, req) : null;
        if (effect) return { ok: false, error: effect } as const;
        status = 'open';
        break;
      }
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
  // A business that just went live starts its Stripe subscription if a card is already saved.
  if (result.status === 'approved' && result.req.kind === 'business' && result.req.businessId) await syncBillingSafe(result.req.businessId);
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
      // Approved businesses go live only once a card is on file: until then the listing is hidden and marked
      // awaitingPayment, the owner gets the activation email (automations.ts), and the first successful charge
      // puts it live (billing/index.ts applyStripeSubscription).
      const [cur, sub] = await Promise.all([
        tx.business.findUnique({ where: { id: req.businessId }, select: { settings: true } }),
        tx.subscription.findUnique({ where: { businessId: req.businessId }, select: { id: true, status: true, stripeSubscriptionId: true } }),
      ]);
      const unpaid = !sub?.stripeSubscriptionId;
      const settings = (cur?.settings && typeof cur.settings === 'object' && !Array.isArray(cur.settings) ? cur.settings : {}) as Record<string, unknown>;
      const biz = await tx.business.update({
        where: { id: req.businessId },
        data: unpaid
          ? { status: 'hidden', settings: { ...settings, awaitingPayment: true, awaitingPaymentSince: new Date().toISOString() } as Prisma.InputJsonValue }
          : { status: 'live' },
      });
      if (unpaid && sub && sub.status === 'active') await tx.subscription.update({ where: { id: sub.id }, data: { status: 'incomplete' } });
      // Listed through Onboarding by its owner, so ownership is verified along with the listing.
      await tx.branch.updateMany({ where: { businessId: req.businessId, status: 'draft' }, data: { status: 'live', isClaimed: biz.ownerUserId !== null } });
      return null;
    }
    case 'claim': {
      if (!req.branchId || !req.submittedById) return 'invalid';
      const branch = await tx.branch.findUnique({ where: { id: req.branchId }, include: { business: true, categories: { select: { categorySlug: true, isPrimary: true } } } });
      if (!branch) return 'invalid';
      if (branch.isClaimed || branch.business.ownerUserId) return 'already_owned';
      const user = await tx.user.findUnique({ where: { id: req.submittedById } });
      if (!user) return 'invalid';

      const d = obj(sub.details as Prisma.JsonValue);
      const cats = Array.isArray(d.categories) ? d.categories.filter((c): c is string => typeof c === 'string') : [];
      const known = cats.length ? await tx.category.findMany({ where: { OR: [{ slug: { in: cats } }, { name: { in: cats } }] } }) : [];

      // A chain: the branches the owner also claimed join this account; the other live branches of the
      // business move to a business of their own, so they stay public and claimable by someone else.
      const extraIds = (Array.isArray(sub.extraBranches) ? (sub.extraBranches as Prisma.JsonValue[]).map(v => str(obj(v).id)) : []).filter((x): x is string => !!x);
      const siblings = await tx.branch.findMany({ where: { businessId: branch.businessId, id: { not: branch.id }, isClaimed: false }, select: { id: true } });
      const claimedExtra = siblings.filter(x => extraIds.includes(x.id)).map(x => x.id);
      const leftOut = siblings.filter(x => !extraIds.includes(x.id)).map(x => x.id);
      if (leftOut.length) {
        const rest = await tx.business.create({ data: { status: branch.business.status, type: branch.business.type, chainKey: branch.business.chainKey } });
        await tx.branch.updateMany({ where: { id: { in: leftOut } }, data: { businessId: rest.id } });
      }
      if (claimedExtra.length) await tx.branch.updateMany({ where: { id: { in: claimedExtra } }, data: { isClaimed: true } });

      await tx.business.update({ where: { id: branch.businessId }, data: { ownerUserId: user.id } });
      await tx.staffMember.create({
        data: {
          businessId: branch.businessId, userId: user.id, displayName: user.fullName ?? str(d.name) ?? branch.name,
          profession: 'management', isOwner: true, preset: 'owner', branchIds: [branch.id, ...claimedExtra],
        },
      });
      await tx.branch.update({
        where: { id: branch.id },
        data: {
          isClaimed: true,
          name: str(d.name) ?? branch.name,
          address: str(d.address) ?? branch.address,
          ...(str(d.address) && str(d.address) !== branch.address ? { addressSource: 'owner' } : {}),
          phone: str(d.phone) ?? branch.phone,
          whatsapp: str(d.whatsapp) ?? branch.whatsapp,
          ...(Array.isArray(d.hours) && d.hours.length === 7 ? { hours: d.hours as Prisma.InputJsonValue } : {}),
          ...(known.length
            ? { categories: { deleteMany: {}, create: withPrimary(known.map(k => k.slug), branch.categories.find(c => c.isPrimary)?.categorySlug) } }
            : {}),
        },
      });
      // The plan the claimant picked becomes the business's subscription. It stays incomplete, and the backend read
      // only (src/lib/server/access.ts), until Stripe's webhook reports the first payment.
      const plan = sub.plan === 'advanced' ? 'advanced' : 'basic';
      const existing = await tx.subscription.findUnique({ where: { businessId: branch.businessId }, select: { id: true, status: true, stripeSubscriptionId: true } });
      if (!existing) {
        await tx.subscription.create({ data: { businessId: branch.businessId, plan, cycle: 'monthly', pricePerBranchAgorot: PLAN_MONTHLY_NIS[plan] * 100, status: 'incomplete' } });
      } else if (!existing.stripeSubscriptionId && existing.status !== 'active' && existing.status !== 'past_due') {
        await tx.subscription.update({ where: { id: existing.id }, data: { plan, cycle: 'monthly', pricePerBranchAgorot: PLAN_MONTHLY_NIS[plan] * 100, status: 'incomplete' } });
      }

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

/** Takes back what an approval did. The request goes back to the queue; approving again redoes it. */
async function onRevokeApproval(tx: Tx, req: Req): Promise<'invalid' | null> {
  const sub = obj(req.submitted);
  switch (req.kind) {
    case 'claim':
      // Ownership was transferred and the claimant's details written to the listing: not reversible from here.
      return 'invalid';
    case 'business': {
      if (!req.businessId) return 'invalid';
      const cur = await tx.business.findUnique({ where: { id: req.businessId }, select: { settings: true } });
      const st = obj(cur?.settings ?? null);
      const { awaitingPayment: _a, awaitingPaymentSince: _b, ...rest } = st;
      await tx.business.update({ where: { id: req.businessId }, data: { status: 'pending', settings: rest as Prisma.InputJsonValue } });
      await tx.scheduledMessage.updateMany({ where: { key: { startsWith: `ACT:${req.businessId}:` }, status: 'pending' }, data: { status: 'cancelled', note: 'האישור בוטל' } });
      return null;
    }
    case 'license':
    case 'cert': {
      const licenseId = str(sub.licenseId);
      if (!licenseId) return 'invalid';
      await tx.license.update({ where: { id: licenseId }, data: { status: 'pending', verifiedAt: null } });
      // A listing with medical treatments needs a verified doctor: if this was its doctor's license, it leaves the site.
      if (req.kind === 'license' && req.businessId) {
        const medical = await tx.branch.count({
          where: { businessId: req.businessId, medicalResponsible: { license: { id: licenseId } }, categories: { some: { category: { isMedical: true } } } },
        });
        if (medical) await tx.business.updateMany({ where: { id: req.businessId, status: { in: ['live', 'hidden', 'past_due'] } }, data: { status: 'pending' } });
      }
      return null;
    }
  }
  return null;
}

async function onReject(tx: Tx, req: Req) {
  const licenseId = str(obj(req.submitted).licenseId);
  if ((req.kind === 'license' || req.kind === 'cert') && licenseId) {
    await tx.license.update({ where: { id: licenseId }, data: { status: 'rejected' } });
  }
}
