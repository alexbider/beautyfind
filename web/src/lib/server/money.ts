import 'server-only';
import type { Payment, PaymentPurpose, ProviderKind } from '@prisma/client';
import { VAT_RATE } from '../pricing';
import { invoiceAdapter } from '../vendors/invoicing/registry';
import { paymentAdapter } from '../vendors/payments/registry';
import { messaging } from '../vendors/messaging';
import { db } from './db';
import { open, seal } from './secure';
import { siteUrl } from './site';

// Clinic money flows through the clinic's OWN provider connections (docs/decisions.md).
// Amounts charged to clients are final (gross); the VAT part is derived for the clinic's tax document.

export async function connectionFor(businessId: string, kind: ProviderKind) {
  const c = await db.providerConnection.findFirst({
    where: { businessId, kind, status: 'connected' },
    orderBy: { updatedAt: 'desc' },
  });
  if (!c) return null;
  return { id: c.id, provider: c.provider, settings: c.settings as Record<string, unknown>, credentials: open<Record<string, string>>(c.credentialsEnc) };
}

export const sealCredentials = (creds: Record<string, string>) => seal(creds);

/** Can this business take payments right now (deposits, gift cards, paid consults)? */
export async function canTakePayments(businessId: string) {
  return !!(await db.providerConnection.findFirst({ where: { businessId, kind: 'payments', status: 'connected' }, select: { id: true } }));
}

const splitVat = (grossAgorot: number) => {
  const net = Math.round(grossAgorot / (1 + VAT_RATE));
  return { net, vat: grossAgorot - net };
};

export type StartPaymentResult = { ok: true; paymentId: string; checkoutUrl: string } | { ok: false; error: 'no_provider' | 'provider_error' };

/** Creates a pending Payment and a hosted checkout at the business's provider. */
export async function startPayment(opts: {
  businessId: string;
  purpose: PaymentPurpose;
  grossAgorot: number;
  description: string;
  customer: { name: string; phone?: string | null; email?: string | null };
  bookingId?: string;
  giftCardId?: string;
  returnPath: string; // relative, where the client lands after paying (success or cancel)
}): Promise<StartPaymentResult> {
  const conn = await connectionFor(opts.businessId, 'payments');
  if (!conn) return { ok: false, error: 'no_provider' };
  const { net, vat } = splitVat(opts.grossAgorot);
  const payment = await db.payment.create({
    data: {
      payee: 'business', businessId: opts.businessId, bookingId: opts.bookingId, giftCardId: opts.giftCardId,
      payerName: opts.customer.name, payerPhone: opts.customer.phone, payerEmail: opts.customer.email,
      purpose: opts.purpose, netAgorot: net, vatAgorot: vat, grossAgorot: opts.grossAgorot,
      provider: conn.provider, connectionId: conn.id,
    },
  });
  try {
    const base = siteUrl();
    const sep = opts.returnPath.includes('?') ? '&' : '?';
    const res = await paymentAdapter(conn.provider).createCheckout(conn.credentials, {
      paymentId: payment.id,
      amountAgorot: opts.grossAgorot,
      description: opts.description,
      customer: opts.customer,
      maxInstallments: Number(conn.settings.maxInstallments ?? 1),
      successUrl: `${base}${opts.returnPath}${sep}paid=1`,
      cancelUrl: `${base}${opts.returnPath}${sep}paid=0`,
      webhookUrl: `${base}/api/payments/webhook/${payment.id}`,
    });
    await db.payment.update({ where: { id: payment.id }, data: { checkoutUrl: res.checkoutUrl, providerRef: res.providerRef } });
    return { ok: true, paymentId: payment.id, checkoutUrl: res.checkoutUrl };
  } catch (e) {
    console.error('[money] checkout failed', e);
    await db.payment.update({ where: { id: payment.id }, data: { status: 'failed' } });
    return { ok: false, error: 'provider_error' };
  }
}

/** Verifies a provider webhook for one payment and applies it. Idempotent. */
export async function handleWebhook(paymentId: string, req: Request, rawBody: string) {
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment || !payment.connectionId) throw new Error('unknown payment');
  const c = await db.providerConnection.findUnique({ where: { id: payment.connectionId } });
  if (!c) throw new Error('connection gone');
  const result = await paymentAdapter(c.provider).parseWebhook(open(c.credentialsEnc), req, rawBody);
  if (result.paymentId !== paymentId) throw new Error('payment mismatch');
  return applyPaymentResult(paymentId, result);
}

export async function applyPaymentResult(
  paymentId: string,
  r: { status: 'succeeded' | 'failed'; providerRef?: string; cardBrand?: string; cardLast4?: string; installments?: number },
) {
  // Only a pending payment moves; retries of the same webhook are no-ops.
  const moved = await db.payment.updateMany({
    where: { id: paymentId, status: 'pending' },
    data: {
      status: r.status,
      providerRef: r.providerRef,
      cardBrand: r.cardBrand,
      cardLast4: r.cardLast4,
      installments: r.installments ?? 1,
      paidAt: r.status === 'succeeded' ? new Date() : null,
    },
  });
  if (moved.count === 0) return { applied: false };
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (r.status === 'succeeded') {
    await issueReceipt(payment).catch(e => console.error('[money] receipt failed', e));
    await onPaid(payment);
  } else {
    await onFailed(payment);
  }
  return { applied: true };
}

// Purpose handlers are loaded lazily to avoid import cycles (booking/gift modules import money).
async function onPaid(p: Payment) {
  if ((p.purpose === 'deposit' || p.purpose === 'consult' || p.purpose === 'treatment') && p.bookingId) {
    const { confirmPaidBooking } = await import('./booking');
    await confirmPaidBooking(p.bookingId);
  }
  if (p.purpose === 'gift_card' && p.giftCardId) {
    const { activatePaidGiftCard } = await import('./giftcards');
    await activatePaidGiftCard(p.giftCardId);
  }
}

async function onFailed(p: Payment) {
  if (p.bookingId) {
    // The hold keeps the slot for 10 minutes; a failed payment releases it now.
    await db.booking.updateMany({ where: { id: p.bookingId, status: 'pending_payment' }, data: { status: 'abandoned', holdUntil: null } });
  }
}

/** The clinic's חשבונית מס/קבלה, issued through its invoicing provider if connected. */
async function issueReceipt(p: Payment) {
  if (!p.businessId) return;
  const conn = await connectionFor(p.businessId, 'invoicing');
  if (!conn) return; // the business issues documents in its own system
  const doc = await invoiceAdapter(conn.provider).issue(conn.credentials, {
    type: 'tax_invoice_receipt',
    customer: { name: p.payerName, phone: p.payerPhone, email: p.payerEmail },
    lines: [{ description: PURPOSE_LINE[p.purpose], qty: 1, unitAgorot: p.netAgorot }],
    vatRate: VAT_RATE,
    payment: { method: 'card', last4: p.cardLast4 ?? undefined, installments: p.installments },
    sendTo: p.payerEmail,
  });
  await db.document.create({
    data: {
      issuer: 'business', businessId: p.businessId, type: 'tax_invoice_receipt', number: doc.number, paymentId: p.id,
      lines: [{ description: PURPOSE_LINE[p.purpose], qty: 1, unitAgorot: p.netAgorot }],
      netAgorot: p.netAgorot, vatAgorot: p.vatAgorot, grossAgorot: p.grossAgorot,
      provider: conn.provider, providerRef: doc.providerRef, pdfUrl: doc.pdfUrl, sentTo: p.payerEmail,
    },
  });
}

const PURPOSE_LINE: Record<PaymentPurpose, string> = {
  deposit: 'מקדמה לתור',
  treatment: 'טיפול',
  gift_card: 'שובר מתנה',
  consult: 'פגישת ייעוץ',
  subscription: 'מנוי BeautyFind',
  sponsored: 'מקום ממומן',
};

export type RefundOutcome = { ok: true; refundId: string } | { ok: false; error: 'not_refundable' | 'provider_error' };

/** Refunds (part of) a succeeded payment and issues a credit note when invoicing is connected. */
export async function refundPayment(paymentId: string, amountAgorot: number, reason: string): Promise<RefundOutcome> {
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { documents: true, refunds: true } });
  const refunded = p?.refunds.filter(r => r.status !== 'failed').reduce((n, r) => n + r.amountAgorot, 0) ?? 0;
  if (!p || !p.connectionId || !p.providerRef || (p.status !== 'succeeded' && p.status !== 'partially_refunded') || amountAgorot <= 0 || amountAgorot > p.grossAgorot - refunded) {
    return { ok: false, error: 'not_refundable' };
  }
  const c = await db.providerConnection.findUniqueOrThrow({ where: { id: p.connectionId } });
  let res;
  try {
    res = await paymentAdapter(c.provider).refund(open(c.credentialsEnc), { providerRef: p.providerRef, amountAgorot });
  } catch (e) {
    console.error('[money] refund failed', e);
    return { ok: false, error: 'provider_error' };
  }
  const expectedBy = new Date(Date.now() + 14 * 86_400_000); // 7 to 10 business days
  const refund = await db.refund.create({
    data: { paymentId, amountAgorot, reason, providerRef: res.providerRef, status: res.status === 'issued' ? 'sent_to_card' : 'failed', expectedBy },
  });
  if (res.status !== 'issued') return { ok: false, error: 'provider_error' };
  const full = refunded + amountAgorot === p.grossAgorot;
  await db.payment.update({ where: { id: paymentId }, data: { status: full ? 'refunded' : 'partially_refunded' } });

  const original = p.documents.find(d => d.type === 'tax_invoice_receipt');
  const inv = p.businessId ? await connectionFor(p.businessId, 'invoicing') : null;
  if (inv && original) {
    const { net, vat } = splitVat(amountAgorot);
    const doc = await invoiceAdapter(inv.provider).issue(inv.credentials, {
      type: 'credit_note',
      customer: { name: p.payerName, phone: p.payerPhone, email: p.payerEmail },
      lines: [{ description: `זיכוי: ${PURPOSE_LINE[p.purpose]}`, qty: 1, unitAgorot: net }],
      vatRate: VAT_RATE,
      referencesNumber: original.number,
      sendTo: p.payerEmail,
    });
    const cn = await db.document.create({
      data: {
        issuer: 'business', businessId: p.businessId, type: 'credit_note', number: doc.number, paymentId,
        referencesDocumentId: original.id, lines: [{ description: `זיכוי: ${PURPOSE_LINE[p.purpose]}`, qty: 1, unitAgorot: net }],
        netAgorot: net, vatAgorot: vat, grossAgorot: amountAgorot, provider: inv.provider, providerRef: doc.providerRef, pdfUrl: doc.pdfUrl, sentTo: p.payerEmail,
      },
    });
    await db.refund.update({ where: { id: refund.id }, data: { creditNoteId: cn.id } });
  }
  if (p.payerEmail) {
    await messaging().send({ channel: 'email', to: p.payerEmail, template: 'M11_refund', vars: { amount: String(amountAgorot / 100), reason }, kind: 'service' });
  }
  return { ok: true, refundId: refund.id };
}
