'use server';

import type { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import { saveUpload } from '@/lib/server/media';
import { parseBankCsv, reconcile, type BankLine } from './data';

// Accounting actions: expenses (with a private receipt file), subscription status and retry
// scheduling, manual platform documents (invoice or credit note, no Israeli VAT: Israfind Group,
// docs/decisions.md) and a stateless bank reconciliation of an uploaded statement.

type Result = { ok: true; id?: string; number?: string } | { ok: false; error: string };

const ExpenseInput = z.object({
  date: z.string().min(8), vendor: z.string().trim().min(1).max(120), description: z.string().trim().max(300).optional(), category: z.string().trim().min(1).max(40),
  netNis: z.coerce.number().min(0).max(10_000_000), vatNis: z.coerce.number().min(0).max(10_000_000).default(0), receiptUrl: z.string().trim().max(500).optional(),
});

export async function createExpenseAction(form: FormData): Promise<Result> {
  const user = await areaUserOrNull('accounting', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = ExpenseInput.safeParse(Object.fromEntries(['date', 'vendor', 'description', 'category', 'netNis', 'vatNis', 'receiptUrl'].map(k => [k, form.get(k) ?? undefined])));
  if (!p.success) return { ok: false, error: 'חסרים תאריך, ספק, קטגוריה או סכום' };
  const date = new Date(p.data.date);
  if (Number.isNaN(date.getTime())) return { ok: false, error: 'תאריך לא תקין' };
  let receiptUrl = p.data.receiptUrl || null;
  const file = form.get('receipt');
  if (file instanceof File && file.size > 0) {
    const up = await saveUpload(file, { ownerId: user.id, isPrivate: true, alt: `receipt ${p.data.vendor}` });
    if (!up.ok) return { ok: false, error: up.error === 'type' ? 'הקבלה חייבת להיות PDF או תמונה' : up.error === 'size' ? 'הקובץ גדול מ־8MB' : 'הקובץ ריק' };
    receiptUrl = up.url;
  }
  const e = await db.expense.create({ data: { date, vendor: p.data.vendor, description: p.data.description || null, category: p.data.category, netAgorot: Math.round(p.data.netNis * 100), vatAgorot: Math.round(p.data.vatNis * 100), receiptUrl, createdById: user.id } });
  await db.auditLog.create({ data: { actorId: user.id, action: 'expense_create', subjectType: 'expense', subjectId: e.id, meta: { label: `${p.data.vendor} · ₪${p.data.netNis}` } } });
  revalidatePath('/ops/accounting');
  revalidatePath('/ops');
  return { ok: true, id: e.id };
}

export async function deleteExpenseAction(id: string): Promise<Result> {
  const user = await areaUserOrNull('accounting', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const e = await db.expense.findUnique({ where: { id } });
  if (!e) return { ok: false, error: 'לא נמצא' };
  await db.$transaction([db.expense.delete({ where: { id } }), db.auditLog.create({ data: { actorId: user.id, action: 'expense_delete', subjectType: 'expense', subjectId: id, meta: { label: `${e.vendor} · ${e.netAgorot / 100}` } } })]);
  revalidatePath('/ops/accounting');
  return { ok: true };
}

const SubInput = z.object({ id: z.string().uuid(), status: z.enum(['active', 'past_due', 'hidden', 'cancelled']).optional(), retryInDays: z.coerce.number().int().min(0).max(60).optional(), note: z.string().trim().max(300).optional() });

export async function updateSubscriptionAction(input: z.input<typeof SubInput>): Promise<Result> {
  const user = await areaUserOrNull('accounting', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = SubInput.safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  const sub = await db.subscription.findUnique({ where: { id: p.data.id }, select: { id: true, status: true, retry: true, businessId: true } });
  if (!sub) return { ok: false, error: 'מנוי לא נמצא' };
  const retry = (sub.retry ?? {}) as { attempts?: number; next_at?: string };
  const data: Prisma.SubscriptionUpdateInput = {};
  if (p.data.status) data.status = p.data.status;
  if (p.data.retryInDays != null) data.retry = { attempts: (retry.attempts ?? 0) + 1, next_at: new Date(Date.now() + p.data.retryInDays * 86_400_000).toISOString() } as Prisma.InputJsonValue;
  const ops: Prisma.PrismaPromise<unknown>[] = [db.subscription.update({ where: { id: sub.id }, data })];
  // The business follows its subscription: a hidden subscription hides the profile, a settled one returns it.
  if (p.data.status === 'hidden') ops.push(db.business.update({ where: { id: sub.businessId }, data: { status: 'hidden' } }));
  if (p.data.status === 'past_due') ops.push(db.business.update({ where: { id: sub.businessId }, data: { status: 'past_due' } }));
  if (p.data.status === 'active') ops.push(db.business.updateMany({ where: { id: sub.businessId, status: { in: ['past_due', 'hidden'] } }, data: { status: 'live' } }));
  ops.push(db.auditLog.create({ data: { actorId: user.id, action: 'subscription_update', subjectType: 'subscription', subjectId: sub.id, businessId: sub.businessId, meta: { from: sub.status, to: p.data.status ?? sub.status, retryInDays: p.data.retryInDays ?? null, note: p.data.note || null } } }));
  await db.$transaction(ops);
  revalidatePath('/ops/accounting');
  revalidatePath('/ops/businesses');
  revalidatePath('/');
  return { ok: true };
}

const Line = z.object({ description: z.string().trim().min(1).max(200), qty: z.coerce.number().min(0.01).max(10_000), unitNis: z.coerce.number().min(-1_000_000).max(1_000_000) });
const DocInput = z.object({ businessId: z.string().uuid().optional(), type: z.enum(['platform_invoice', 'credit_note']), referencesNumber: z.string().trim().max(40).optional(), sentTo: z.string().trim().email().optional().or(z.literal('')), lines: z.array(Line).min(1).max(20) });

/** Next sequential number for platform documents: invoices from 10001, credit notes from 90001. */
async function nextDocumentNumber(tx: Prisma.TransactionClient, type: 'platform_invoice' | 'credit_note') {
  const prefix = type === 'credit_note' ? 'platform_credit' : 'platform_invoice';
  const row = await tx.refCounter.upsert({ where: { prefix }, create: { prefix, value: 1 }, update: { value: { increment: 1 } } });
  return String((type === 'credit_note' ? 90000 : 10000) + row.value);
}

export async function issueDocumentAction(input: z.input<typeof DocInput>): Promise<Result> {
  const user = await areaUserOrNull('accounting', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = DocInput.safeParse(input);
  if (!p.success) return { ok: false, error: 'נדרשת לפחות שורה אחת עם תיאור, כמות ומחיר' };
  let referencesDocumentId: string | null = null;
  if (p.data.type === 'credit_note') {
    if (!p.data.referencesNumber) return { ok: false, error: 'חשבונית זיכוי חייבת להפנות למספר חשבונית' };
    const orig = await db.document.findFirst({ where: { issuer: 'platform', number: p.data.referencesNumber } });
    if (!orig) return { ok: false, error: 'החשבונית המקורית לא נמצאה' };
    referencesDocumentId = orig.id;
  }
  let sentTo = p.data.sentTo || null;
  if (p.data.businessId && !sentTo) {
    const b = await db.business.findUnique({ where: { id: p.data.businessId }, select: { invoiceEmail: true, owner: { select: { email: true } } } });
    sentTo = b?.invoiceEmail ?? b?.owner?.email ?? null;
  }
  const sign = p.data.type === 'credit_note' ? -1 : 1;
  const net = Math.round(p.data.lines.reduce((a, l) => a + l.qty * l.unitNis * 100, 0)) * sign;
  const number = await db.$transaction(async tx => {
    const n = await nextDocumentNumber(tx, p.data.type);
    const d = await tx.document.create({
      data: {
        issuer: 'platform', businessId: p.data.businessId ?? null, type: p.data.type, number: n, referencesDocumentId,
        lines: p.data.lines.map(l => ({ description: l.description, qty: l.qty, unitAgorot: Math.round(l.unitNis * 100) * sign })) as unknown as Prisma.InputJsonValue,
        netAgorot: net, vatAgorot: 0, grossAgorot: net, provider: 'platform', sentTo,
      },
    });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'platform_invoice', subjectType: 'document', subjectId: d.id, businessId: p.data.businessId ?? null, meta: { ref: n, type: p.data.type, gross: net / 100 } } });
    return n;
  });
  revalidatePath('/ops/accounting');
  revalidatePath('/ops');
  return { ok: true, number };
}

export type ReconcileResult = { ok: true; matched: Array<{ date: string; amountAgorot: number; text: string; paymentRef: string; payer: string }>; unmatchedLines: Array<{ date: string; amountAgorot: number; text: string }>; unmatchedPayments: Array<{ ref: string; payer: string; at: string | null; amountAgorot: number }> } | { ok: false; error: string };

export async function reconcileBankAction(csv: string): Promise<ReconcileResult> {
  const user = await areaUserOrNull('accounting', 'view');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const lines: BankLine[] = parseBankCsv(csv.slice(0, 500_000));
  if (!lines.length) return { ok: false, error: 'לא זוהו שורות עם תאריך וסכום בקובץ' };
  const r = await reconcile(lines);
  return {
    ok: true,
    matched: r.matched.map(m => ({ date: m.line.date.toISOString(), amountAgorot: m.line.amountAgorot, text: m.line.text, paymentRef: m.paymentRef, payer: m.payer })),
    unmatchedLines: r.unmatchedLines.map(l => ({ date: l.date.toISOString(), amountAgorot: l.amountAgorot, text: l.text })),
    unmatchedPayments: r.unmatchedPayments.map(p => ({ ...p, at: p.at ? p.at.toISOString() : null })),
  };
}
