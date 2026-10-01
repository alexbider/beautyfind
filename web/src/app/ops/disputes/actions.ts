'use server';

import type { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import { nextRef } from '@/lib/server/refs';
import { depositFacts, giftCardFacts } from './data';

// Opening a dispute pulls the facts from the booking or the gift card; deciding it records the
// recommendation as an append-only decision. The clinic refunds (or not) through its own provider;
// nothing here moves money.

type Result = { ok: true; ref?: string } | { ok: false; error: string };

const OpenInput = z.object({ kind: z.enum(['deposit', 'gift_card']), ref: z.string().trim().min(3).max(40), claim: z.string().trim().min(5).max(1500) });

export async function openDisputeAction(input: z.input<typeof OpenInput>): Promise<Result> {
  const user = await areaUserOrNull('disputes', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = OpenInput.safeParse(input);
  if (!p.success) return { ok: false, error: 'חסר מספר תור או שובר, או טענה קצרה מדי' };
  const facts = p.data.kind === 'deposit' ? await depositFacts(p.data.ref) : await giftCardFacts(p.data.ref);
  if (!facts.ok) return { ok: false, error: facts.error };
  const ref = await nextRef('D', 2);
  await db.$transaction([
    db.dispute.create({
      data: {
        ref, kind: p.data.kind, bookingId: 'bookingId' in facts ? facts.bookingId : null, giftCardId: 'giftCardId' in facts ? facts.giftCardId : null,
        businessId: facts.businessId, branchId: facts.branchId, clientName: facts.clientName, clientPhone: facts.clientPhone, amountAgorot: facts.amountAgorot,
        claim: p.data.claim, systemFacts: facts.facts as unknown as Prisma.InputJsonValue, policyShown: { line: facts.policyLine, snapshot: facts.policy ?? null } as Prisma.InputJsonValue, openedById: user.id,
      },
    }),
    db.auditLog.create({ data: { actorId: user.id, action: 'dispute_open', subjectType: 'dispute', subjectId: user.id, businessId: facts.businessId, meta: { ref, kind: p.data.kind, source: p.data.ref } } }),
  ]);
  revalidatePath('/ops/disputes');
  revalidatePath('/ops');
  return { ok: true, ref };
}

const DecideInput = z.object({ id: z.string().uuid(), status: z.enum(['recommended_refund', 'closed_policy_upheld', 'escalated_legal']), note: z.string().trim().max(600).optional() });

export async function decideDisputeAction(input: z.input<typeof DecideInput>): Promise<Result> {
  const user = await areaUserOrNull('disputes', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = DecideInput.safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  const d = await db.dispute.findUnique({ where: { id: p.data.id } });
  if (!d) return { ok: false, error: 'מחלוקת לא נמצאה' };
  if (d.status !== 'open' && p.data.status !== 'escalated_legal') return { ok: false, error: 'המחלוקת כבר הוכרעה' };
  const recommendation = p.data.status === 'recommended_refund' ? 'המלצה לקליניקה: להחזיר' : p.data.status === 'closed_policy_upheld' ? 'המדיניות נאכפה כנדרש' : 'הועבר ליועמ״ש';
  await db.$transaction([
    db.dispute.update({ where: { id: d.id }, data: { status: p.data.status, recommendation: p.data.note ? `${recommendation}. ${p.data.note}` : recommendation, decidedById: user.id, decidedAt: new Date() } }),
    db.decision.create({ data: { actorId: user.id, actorRole: user.opsRole ?? 'ops', subjectType: 'dispute', subjectId: d.id, action: p.data.status, reason: p.data.note || null } }),
    db.auditLog.create({ data: { actorId: user.id, action: 'dispute_decide', subjectType: 'dispute', subjectId: d.id, businessId: d.businessId, meta: { ref: d.ref, status: p.data.status, note: p.data.note || null } } }),
  ]);
  revalidatePath('/ops/disputes');
  revalidatePath('/ops');
  return { ok: true };
}
